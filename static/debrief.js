// Debrief — cinematic scroll engine with synthesized desktop momentum.
//
// Core model:
//   - target: where the user wants to scroll (fed by wheel / keys / dot nav)
//   - current: where we've actually scrolled the page to this frame (lerped)
//   - On each rAF frame: lerp current toward target, then window.scrollTo(0, current).
//   - Drift detection: if window.scrollY diverges from current by more than a
//     threshold, adopt it (user dragged scrollbar or browser restored scroll).
//
// Desktop only. Touch devices and prefers-reduced-motion get native scroll.

(() => {
    const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
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

    // ----- Scene offsets (recomputed on resize / font-load) -----
    const sceneInfo = scenes.map(scene => ({
        el: scene,
        offsetTop: 0,
        height: 0,
    }));
    function refreshLayout() {
        sceneInfo.forEach(info => {
            const rect = info.el.getBoundingClientRect();
            info.offsetTop = rect.top + window.scrollY;
            info.height = info.el.offsetHeight;
        });
    }
    refreshLayout();

    // ----- Momentum state -----
    // A wheel tick of deltaY = 100px becomes a target-delta of ~200px. The lerp
    // then carries the scroll over ~1.3s at 60fps, producing an obvious coast.
    const DAMPING = 0.07;            // 0.07 per frame ≈ ~950ms to reach 99%
    const WHEEL_MULTIPLIER = 1.8;
    const KEY_STEP = () => window.innerHeight * 0.25;
    const PAGE_STEP = () => window.innerHeight * 0.95;
    const DRIFT_THRESHOLD = 6;       // px divergence that counts as external scroll

    let target = window.scrollY;
    let current = target;
    let maxScroll = 0;

    function recomputeMaxScroll() {
        maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    }
    recomputeMaxScroll();

    function onWheel(e) {
        if (e.ctrlKey) return;                 // let pinch-zoom through
        e.preventDefault();
        let px = e.deltaY;
        if (e.deltaMode === 1) px *= 16;
        else if (e.deltaMode === 2) px *= window.innerHeight;
        target = clamp(target + px * WHEEL_MULTIPLIER, 0, maxScroll);
    }

    function onKeydown(e) {
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
        let delta = 0;
        switch (e.key) {
            case 'ArrowDown':  delta = KEY_STEP(); break;
            case 'ArrowUp':    delta = -KEY_STEP(); break;
            case 'PageDown':   delta = PAGE_STEP(); break;
            case 'PageUp':     delta = -PAGE_STEP(); break;
            case ' ':          delta = e.shiftKey ? -PAGE_STEP() : PAGE_STEP(); break;
            case 'Home':       e.preventDefault(); target = 0; return;
            case 'End':        e.preventDefault(); target = maxScroll; return;
            default: return;
        }
        e.preventDefault();
        target = clamp(target + delta, 0, maxScroll);
    }

    // ----- Main rAF loop -----
    let clickTriggered = false;
    let lastActiveIdx = -1;

    function loop() {
        recomputeMaxScroll();

        if (useHijack) {
            // Drift detect: something other than our scrollTo moved the page
            // (scrollbar drag, find-in-page, browser restore). Adopt it.
            const drift = window.scrollY - current;
            if (Math.abs(drift) > DRIFT_THRESHOLD) {
                current = window.scrollY;
                target = window.scrollY;
            }

            const delta = target - current;
            if (Math.abs(delta) > 0.1) {
                current += delta * DAMPING;
                window.scrollTo(0, current);
            } else if (current !== target) {
                current = target;
                window.scrollTo(0, current);
            }
        } else {
            current = window.scrollY;
        }

        const vh = window.innerHeight;
        const scrollY = current;

        // Progress bar
        const pct = maxScroll > 0 ? clamp01(scrollY / maxScroll) : 0;
        if (progressBar) progressBar.style.width = (pct * 100).toFixed(2) + '%';

        let activeIdx = 0;
        sceneInfo.forEach((info, i) => {
            const top = info.offsetTop - scrollY;
            const height = info.height;
            const total = height - vh;
            let p;
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
    // Convention: fade in during pre-entry (p ∈ [-0.85, -0.1]), stay through
    // sticky. Per-item staggers span most of the sticky phase so scrolling
    // continuously reveals content.

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

        // Rows reveal quickly as the window lands — 10 emails is the beat
        rows.forEach((row, i) => {
            const per = -0.5 + (i / Math.max(rows.length, 1)) * 0.5;
            const r = range(p, per, per + 0.22);
            row.style.opacity = Math.max(r, enter * 0.65);
            row.style.transform = `translate3d(${lerp(-12, 0, r)}px, 0, 0)`;
        });

        // Annotations: callouts the user needs to read. Spread across sticky.
        const annotN = annots.length;
        annots.forEach((a, i) => {
            const start = 0.0 + (i / annotN) * 0.6;
            const r = range(p, start, start + 0.22);
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

        // Popups reveal in sequence — starts deep in pre-entry so fly-ins read
        // very early; stagger kept tight so all four land before p ≈ -0.1.
        const popN = popups.length;
        popups.forEach((pop, i) => {
            const start = -0.82 + (i / popN) * 0.36;   // 0:-0.82 … 3:-0.55
            const end = start + 0.22;                   // last finishes ~-0.33
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
        // Vertical list — lever words animate in during pre-entry (negative p)
        // so the big titles read while the scene is still approaching, not after
        // the stage locks to the viewport.
        const words = Array.from(scene.querySelectorAll('.db-psych-word'));
        const caption = scene.querySelector('.db-psych-caption');
        const eyebrow = scene.querySelector('.db-psych-eyebrow');
        const n = words.length;

        const framing = range(p, -0.88, -0.2);
        if (eyebrow) {
            eyebrow.style.opacity = framing;
            eyebrow.style.transform = `translate3d(0, ${lerp(12, 0, framing)}px, 0)`;
        }

        // Stagger across strong pre-entry; all words fully visible before p ≈ 0.
        words.forEach((w, i) => {
            const start = -0.9 + (i / n) * 0.48;   // 0:-0.90 … 4:-0.52
            const end = start + 0.2;
            const vis = range(p, start, end);
            w.style.opacity = vis;
            w.style.transform = `translate3d(0, ${lerp(28, 0, vis)}px, 0)`;
        });

        // Caption after lever words — early sticky / late pre-entry
        if (caption) {
            const capR = range(p, -0.15, 0.35);
            caption.style.opacity = capR;
            caption.style.transform = `translate3d(0, ${lerp(16, 0, capR)}px, 0)`;
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

        const signN = signs.length;
        signs.forEach((s, i) => {
            const start = -0.25 + (i / signN) * 0.7;
            const r = range(p, start, start + 0.3);
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
            const start = -0.25 + (i / ruleN) * 0.7;
            const prog = range(p, start, start + 0.3);
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

    // ----- Dot nav — feeds target so it coasts through the same system -----
    dots.forEach((d, i) => {
        d.addEventListener('click', () => {
            const info = sceneInfo[i];
            if (!info) return;
            const dest = clamp(info.offsetTop + 20, 0, maxScroll);
            if (useHijack) {
                target = dest;
            } else {
                window.scrollTo({
                    top: dest,
                    behavior: prefersReducedMotion ? 'auto' : 'smooth'
                });
            }
        });
    });

    // ----- Bindings -----
    window.addEventListener('resize', () => {
        refreshLayout();
        recomputeMaxScroll();
    }, { passive: true });

    if (useHijack) {
        document.addEventListener('wheel', onWheel, { passive: false });
        window.addEventListener('keydown', onKeydown);
    }

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            refreshLayout();
            recomputeMaxScroll();
        });
    }
    // One more refresh after layout likely settles
    window.addEventListener('load', () => {
        refreshLayout();
        recomputeMaxScroll();
    });

    requestAnimationFrame(loop);
})();
