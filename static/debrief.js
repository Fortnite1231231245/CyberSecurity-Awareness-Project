// Debrief — cinematic scroll engine with synthesized momentum.
//
// On desktop, wheel + keyboard events feed a `targetY` scroll position. A
// continuous rAF loop lerps `currentY` toward `targetY` with low damping and
// applies it via window.scrollTo, so the real scroll coasts to a stop after
// the user releases input (Lenis-style). Native scrollbar, position: sticky,
// and keyboard accessibility all remain functional because we're still
// writing to the browser's actual scroll position.
//
// Touch devices and reduced-motion users get native scroll.

(() => {
    const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // "hover:none and pointer:coarse" is the reliable signal for touch-primary
    const isTouchPrimary = matchMedia('(hover: none) and (pointer: coarse)').matches;
    const useHijack = !prefersReducedMotion && !isTouchPrimary;

    const progressBar = document.querySelector('.db-progress-fill');
    const scenes = Array.from(document.querySelectorAll('.db-scene'));
    const dots = Array.from(document.querySelectorAll('.db-dot'));
    const glitch = document.querySelector('.db-glitch');

    const handlers = {
        'intro'   : handleIntro,
        'inbox'   : handleInbox,
        'diff'    : handleDiff,
        'link'    : handleLink,
        'browser' : handleBrowser,
        'popups'  : handlePopups,
        'psych'   : handlePsych,
        'signs'   : handleSigns,
        'playbook': handlePlaybook,
        'cta'     : handleCta,
    };

    // ----- Utilities -----
    function lerp(a, b, t) { return a + (b - a) * t; }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function clamp01(t) { return clamp(t, 0, 1); }
    function smoothstep(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
    function range(p, start, end) {
        if (end === start) return p >= end ? 1 : 0;
        return smoothstep(clamp01((p - start) / (end - start)));
    }

    // ----- Scene offsets (document coords) -----
    const sceneInfo = scenes.map(scene => ({
        el: scene,
        offsetTop: scene.getBoundingClientRect().top + window.scrollY,
    }));
    function refreshOffsets() {
        sceneInfo.forEach(info => {
            info.offsetTop = info.el.getBoundingClientRect().top + window.scrollY;
        });
    }

    // ----- Momentum-scroll state -----
    const DAMPING = 0.045;           // lower = longer coast (~1s)
    const WHEEL_MULTIPLIER = 1.4;    // scale per-tick target increment (bigger glide per tick)
    const KEY_STEP_PX = () => window.innerHeight * 0.22;
    const PAGE_STEP_PX = () => window.innerHeight * 1.0;

    let targetY = window.scrollY;
    let currentY = targetY;
    let userControlled = false;  // set true while we own the scroll position
    let maxScroll = 0;

    function recomputeMaxScroll() {
        maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    }
    recomputeMaxScroll();

    function setTarget(y, snap) {
        targetY = clamp(y, 0, maxScroll);
        if (snap) {
            currentY = targetY;
            window.scrollTo(0, currentY);
        }
    }

    function onWheel(e) {
        if (e.ctrlKey) return;          // user is zooming
        e.preventDefault();
        // Normalize deltaMode: 0 = pixels, 1 = lines (~16px), 2 = pages
        let px = e.deltaY;
        if (e.deltaMode === 1) px *= 16;
        else if (e.deltaMode === 2) px *= window.innerHeight;
        userControlled = true;
        setTarget(targetY + px * WHEEL_MULTIPLIER, false);
    }

    function onKeydown(e) {
        // Only hijack when focus isn't on an input
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
        let delta = 0;
        switch (e.key) {
            case 'ArrowDown':  delta = KEY_STEP_PX(); break;
            case 'ArrowUp':    delta = -KEY_STEP_PX(); break;
            case 'PageDown':   delta = PAGE_STEP_PX(); break;
            case 'PageUp':     delta = -PAGE_STEP_PX(); break;
            case ' ':          delta = e.shiftKey ? -PAGE_STEP_PX() : PAGE_STEP_PX(); break;
            case 'Home':       e.preventDefault(); userControlled = true; setTarget(0, false); return;
            case 'End':        e.preventDefault(); userControlled = true; setTarget(maxScroll, false); return;
            default: return;
        }
        e.preventDefault();
        userControlled = true;
        setTarget(targetY + delta, false);
    }

    // If the browser itself changes scroll (tab focus, find, scroll restoration),
    // gently adopt that position rather than snap back.
    function onNativeScroll() {
        if (!userControlled) {
            const y = window.scrollY;
            if (Math.abs(y - currentY) > 4) {
                currentY = y;
                targetY = y;
            }
        }
    }

    // ----- rAF loop -----
    let clickTriggered = false;
    let lastActiveIdx = -1;

    function loop() {
        if (useHijack) {
            const delta = targetY - currentY;
            if (Math.abs(delta) < 0.2) {
                currentY = targetY;
                if (userControlled && Math.abs(window.scrollY - currentY) > 0.5) {
                    window.scrollTo(0, currentY);
                }
                userControlled = false;
            } else {
                currentY += delta * DAMPING;
                window.scrollTo(0, currentY);
            }
        } else {
            currentY = window.scrollY;
        }

        const vh = window.innerHeight;
        const scrollY = currentY;

        // Progress bar
        const docH = maxScroll;
        const pct = docH > 0 ? clamp01(scrollY / docH) : 0;
        if (progressBar) progressBar.style.width = (pct * 100).toFixed(2) + '%';

        let activeIdx = 0;
        sceneInfo.forEach((info, i) => {
            const top = info.offsetTop - scrollY;
            const height = info.el.offsetHeight;
            let p;
            const total = height - vh;
            if (top <= 0) {
                p = total > 0 ? clamp01(-top / total) : 1;
            } else {
                p = -Math.min(1, top / vh);
            }
            if (top <= vh * 0.5 && (top + height) >= vh * 0.5) activeIdx = i;

            const fn = handlers[info.el.dataset.scene];
            if (fn) fn(info.el, p);
        });

        if (activeIdx !== lastActiveIdx) {
            dots.forEach((d, i) => d.classList.toggle('active', i === activeIdx));
            lastActiveIdx = activeIdx;
        }

        requestAnimationFrame(loop);
    }

    // ----- Scene handlers -----
    // Content fades in during pre-entry (p ∈ [-0.9, -0.1]), stays fully visible
    // through sticky phase. No exit fades — stage scroll-out handles the handoff.

    function handleIntro(scene, p) {
        const display = scene.querySelector('.db-display');
        const sub = scene.querySelector('.db-intro-sub');
        const hint = scene.querySelector('.db-scroll-hint');
        const eyebrow = scene.querySelector('.db-eyebrow');
        const lift = -Math.max(0, p) * 50;
        [eyebrow, display, sub].forEach(el => {
            if (!el) return;
            el.style.opacity = 1;
            el.style.transform = `translate3d(0, ${lift}px, 0)`;
        });
        if (hint) hint.style.opacity = 1 - range(p, 0.05, 0.4);
    }

    function handleInbox(scene, p) {
        const win = scene.querySelector('.db-inbox-window');
        const rows = Array.from(scene.querySelectorAll('.db-mail-row'));
        const annots = Array.from(scene.querySelectorAll('.db-annot'));
        const heading = scene.querySelector('.db-scene-heading');

        const enter = range(p, -0.85, -0.1);
        const parallax = -Math.max(0, p) * 50;

        if (heading) {
            heading.style.opacity = enter;
            heading.style.transform = `translate3d(0, ${lerp(20, 0, enter) + parallax * 0.5}px, 0)`;
        }
        if (win) {
            const rx = lerp(8, 1.5, enter);
            const ry = lerp(-5, -1, enter);
            const ty = lerp(40, 0, enter) + parallax;
            const sc = lerp(0.96, 1, enter);
            win.style.transform = `translate3d(0, ${ty}px, 0) rotateX(${rx}deg) rotateY(${ry}deg) scale(${sc})`;
            win.style.opacity = enter;
        }

        rows.forEach((row, i) => {
            const per = -0.5 + (i / Math.max(rows.length, 1)) * 0.5;
            const r = range(p, per, per + 0.22);
            row.style.opacity = Math.max(r, enter * 0.65);
            row.style.transform = `translate3d(${lerp(-12, 0, r)}px, 0, 0)`;
        });

        // Annotations appear one by one across the sticky phase — each is a callout
        // the user needs time to read, so we spread them out.
        const annotN = annots.length;
        annots.forEach((a, i) => {
            const per = 0.1 + (i / annotN) * 0.7;
            const r = range(p, per, per + 0.25);
            a.style.opacity = r;
            a.style.transform = `translate3d(0, ${lerp(10, 0, r)}px, 0)`;
        });
    }

    function handleDiff(scene, p) {
        const safe = scene.querySelector('.db-diff-card.safe');
        const danger = scene.querySelector('.db-diff-card.danger');
        const vs = scene.querySelector('.db-diff-vs');
        const heading = scene.querySelector('.db-scene-heading');

        const enter = range(p, -0.85, -0.1);
        const parallax = -Math.max(0, p) * 40;

        if (heading) {
            heading.style.opacity = enter;
            heading.style.transform = `translate3d(0, ${lerp(20, 0, enter) + parallax * 0.5}px, 0)`;
        }
        if (safe) {
            const r = range(p, -0.7, -0.15);
            safe.style.opacity = r;
            safe.style.transform = `translate3d(${lerp(-22, 0, r)}px, ${parallax}px, 0)`;
        }
        if (danger) {
            const r = range(p, -0.45, 0.1);
            danger.style.opacity = r;
            danger.style.transform = `translate3d(${lerp(22, 0, r)}px, ${parallax}px, 0)`;
        }
        if (vs) {
            const r = range(p, -0.25, 0.2);
            vs.style.opacity = r;
            vs.style.transform = `scale(${lerp(0.7, 1, r)})`;
        }
    }

    function handleLink(scene, p) {
        const preview = scene.querySelector('.db-link-preview');
        const actualWrap = scene.querySelector('.db-link-actual-wrap');
        const cursor = scene.querySelector('.db-cursor');
        const heading = scene.querySelector('.db-scene-heading');

        const enter = range(p, -0.85, -0.1);
        const parallax = -Math.max(0, p) * 40;

        if (heading) {
            heading.style.opacity = enter;
            heading.style.transform = `translate3d(0, ${lerp(20, 0, enter) + parallax * 0.5}px, 0)`;
        }
        if (preview) {
            preview.style.opacity = enter;
            preview.style.transform = `translate3d(0, ${lerp(14, 0, enter) + parallax}px, 0) scale(${lerp(0.97, 1, enter)})`;
            preview.style.filter = '';
        }
        if (cursor) {
            const cr = range(p, -0.15, 0.35);
            cursor.style.opacity = cr;
            const x = lerp(-140, 40, cr);
            const y = lerp(100, 0, cr);
            cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        }
        if (actualWrap) {
            const ar = range(p, 0.05, 0.5);
            actualWrap.style.opacity = ar;
            actualWrap.style.transform = `translate(-50%, ${lerp(-10, 0, ar)}px)`;
        }
        if (p > 0.6 && !clickTriggered && !prefersReducedMotion) {
            clickTriggered = true;
            if (glitch) {
                glitch.classList.remove('on');
                void glitch.offsetWidth;
                glitch.classList.add('on');
            }
        } else if (p < 0.45 && clickTriggered) {
            clickTriggered = false;
        }
    }

    function handleBrowser(scene, p) {
        const browser = scene.querySelector('.db-browser');
        const callout = scene.querySelector('.db-browser-callout');
        const heading = scene.querySelector('.db-scene-heading');

        const enter = range(p, -0.85, -0.1);
        const parallax = -Math.max(0, p) * 50;

        if (heading) {
            heading.style.opacity = enter;
            heading.style.transform = `translate3d(0, ${lerp(20, 0, enter) + parallax * 0.5}px, 0)`;
        }
        if (browser) {
            browser.style.opacity = enter;
            browser.style.transform = `translate3d(0, ${lerp(40, 0, enter) + parallax}px, 0) scale(${lerp(0.96, 1, enter)})`;
        }
        if (callout) {
            const r = range(p, -0.05, 0.3);
            callout.style.opacity = r;
            callout.style.transform = `translate(-50%, ${lerp(-6, -16, r)}px)`;
        }
    }

    function handlePopups(scene, p) {
        const popups = Array.from(scene.querySelectorAll('.db-popup'));
        const heading = scene.querySelector('.db-scene-heading');
        const enter = range(p, -0.85, -0.1);
        const parallax = -Math.max(0, p) * 40;

        if (heading) {
            heading.style.opacity = enter;
            heading.style.transform = `translate3d(0, ${lerp(20, 0, enter) + parallax * 0.5}px, 0)`;
        }

        // Stretch reveals across nearly the full sticky phase so the user
        // continuously sees new popups land as they scroll through the scene.
        const popN = popups.length;
        popups.forEach((pop, i) => {
            const start = -0.25 + (i / popN) * 0.9;   // 0: -0.25, 3: 0.425 (for n=4)
            const end = start + 0.35;
            const r = range(p, start, end);
            const baseX = parseFloat(pop.dataset.x || 0);
            const baseY = parseFloat(pop.dataset.y || 0);
            const baseR = parseFloat(pop.dataset.r || 0);
            const fromX = parseFloat(pop.dataset.fromX || -300);
            const fromY = parseFloat(pop.dataset.fromY || 300);
            const tx = lerp(fromX, baseX, r);
            const ty = lerp(fromY, baseY, r) + parallax;
            pop.style.opacity = r;
            pop.style.transform = `translate3d(${tx}px, ${ty}px, 0) rotate(${baseR}deg) scale(${lerp(0.94, 1, r)})`;
        });
    }

    function handlePsych(scene, p) {
        const words = Array.from(scene.querySelectorAll('.db-psych-word'));
        const caption = scene.querySelector('.db-psych-caption');
        const eyebrow = scene.querySelector('.db-psych-eyebrow');
        const n = words.length;

        const startP = 0.03;
        const endP = 0.95;
        const span = endP - startP;
        const slot = span / n;
        const halfWidth = slot * 0.95; // wider crossfade so words breathe

        words.forEach((w, i) => {
            const peak = startP + (i + 0.5) * slot;
            const distance = Math.abs(p - peak);
            const raw = clamp01(1 - distance / halfWidth);
            const vis = smoothstep(raw);
            const scale = lerp(0.9, 1, vis);
            const ty = lerp(14, 0, vis);
            w.style.opacity = vis;
            w.style.transform = `translate3d(0, ${ty}px, 0) scale(${scale})`;
        });

        const framing = range(p, -0.7, -0.1);
        if (eyebrow) {
            eyebrow.style.opacity = framing;
            eyebrow.style.transform = `translate3d(0, ${lerp(12, 0, framing)}px, 0)`;
        }
        if (caption) {
            caption.style.opacity = framing;
            caption.style.transform = `translate3d(0, ${lerp(12, 0, framing)}px, 0)`;
        }
    }

    function handleSigns(scene, p) {
        const signs = Array.from(scene.querySelectorAll('.db-sign'));
        const heading = scene.querySelector('.db-scene-heading');
        const enter = range(p, -0.85, -0.1);
        const parallax = -Math.max(0, p) * 40;

        if (heading) {
            heading.style.opacity = enter;
            heading.style.transform = `translate3d(0, ${lerp(20, 0, enter) + parallax * 0.5}px, 0)`;
        }

        // Stretch across the sticky phase so each sign lands as user scrolls
        const signN = signs.length;
        signs.forEach((s, i) => {
            const start = -0.3 + (i / signN) * 0.9;
            const r = range(p, start, start + 0.35);
            s.style.opacity = r;
            s.style.transform = `translate3d(0, ${lerp(30, 0, r) + parallax * 0.3}px, 0)`;
        });
    }

    function handlePlaybook(scene, p) {
        const rules = Array.from(scene.querySelectorAll('.db-rule'));
        const heading = scene.querySelector('.db-scene-heading');
        const enter = range(p, -0.85, -0.1);
        const parallax = -Math.max(0, p) * 40;

        if (heading) {
            heading.style.opacity = enter;
            heading.style.transform = `translate3d(0, ${lerp(20, 0, enter) + parallax * 0.5}px, 0)`;
        }

        const ruleN = rules.length;
        rules.forEach((r, i) => {
            const start = -0.3 + (i / ruleN) * 0.9;
            const prog = range(p, start, start + 0.35);
            r.style.opacity = prog;
            r.style.transform = `translate3d(${lerp(-18, 0, prog)}px, ${parallax * 0.3}px, 0)`;
        });
    }

    function handleCta(scene, p) {
        const display = scene.querySelector('.db-cta-display');
        const sub = scene.querySelector('.db-cta-sub');
        const actions = scene.querySelector('.db-cta-actions');
        const footnote = scene.querySelector('.db-cta-footnote');

        [display, sub, actions, footnote].forEach((el, i) => {
            if (!el) return;
            const start = -0.7 + i * 0.1;
            const r = range(p, start, start + 0.35);
            el.style.opacity = r;
            el.style.transform = `translate3d(0, ${lerp(24, 0, r)}px, 0)`;
        });
    }

    // ----- Dot nav: feed targetY so it uses the same momentum system -----
    dots.forEach((d, i) => {
        d.addEventListener('click', () => {
            const info = sceneInfo[i];
            if (!info) return;
            userControlled = true;
            if (useHijack) {
                setTarget(info.offsetTop + 20, false);
            } else {
                window.scrollTo({
                    top: info.offsetTop + 20,
                    behavior: prefersReducedMotion ? 'auto' : 'smooth'
                });
            }
        });
    });

    // ----- Bindings -----
    window.addEventListener('resize', () => {
        refreshOffsets();
        recomputeMaxScroll();
    }, { passive: true });
    window.addEventListener('scroll', onNativeScroll, { passive: true });

    if (useHijack) {
        // Attach to document — more reliable than window for preventDefault on some browsers
        document.addEventListener('wheel', onWheel, { passive: false });
        window.addEventListener('keydown', onKeydown);
    }

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            refreshOffsets();
            recomputeMaxScroll();
        });
    }

    // Kick off
    requestAnimationFrame(loop);
})();
