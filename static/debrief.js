// Debrief — scroll-driven cinematic engine.
// Continuous rAF loop with lightly damped scroll. Each scene is a sticky stage
// with a tall scroll track. Animations use smoothstep easing for soft transitions.

(() => {
    const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    function clamp01(t) { return Math.max(0, Math.min(1, t)); }
    function smoothstep(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
    // Map p from [start, end] → [0, 1] with smoothstep easing
    function range(p, start, end) {
        if (end === start) return p >= end ? 1 : 0;
        return smoothstep(clamp01((p - start) / (end - start)));
    }

    // Pre-compute scene offsets (document-relative) so we can use smoothed scroll
    const sceneInfo = scenes.map(scene => {
        const rect = scene.getBoundingClientRect();
        return {
            el: scene,
            offsetTop: rect.top + window.scrollY,
            // recalc on resize
        };
    });
    function refreshOffsets() {
        sceneInfo.forEach((info, i) => {
            const rect = info.el.getBoundingClientRect();
            info.offsetTop = rect.top + window.scrollY;
        });
    }

    // ----- Scroll smoothing state -----
    // Actual page scroll is native and untouched. We interpolate a "visual" scrollY
    // that trails the real one. Animations read from the visual value, which makes
    // motion feel damped and cinematic without fighting the browser's scroll.
    let targetY = window.scrollY;
    let visualY = targetY;
    const DAMPING = prefersReducedMotion ? 1 : 0.18;

    // ----- Progress calc -----
    // Returns p in [-1, 1]. -1 = scene's top one viewport below (just entering from bottom).
    // 0 = scene's top at viewport top (sticky active). 1 = scene's bottom at viewport bottom.
    function computeProgress(info, visY, vh) {
        const top = info.offsetTop - visY;
        const height = info.el.offsetHeight;
        const total = height - vh;
        if (top <= 0) {
            if (total <= 0) return 1;
            return Math.min(1, Math.max(0, -top / total));
        }
        return -Math.min(1, top / vh);
    }

    let clickTriggered = false;
    let lastActiveIdx = -1;

    function loop() {
        targetY = window.scrollY;

        const delta = targetY - visualY;
        if (Math.abs(delta) < 0.3) {
            visualY = targetY;
        } else {
            visualY += delta * DAMPING;
        }

        const vh = window.innerHeight;

        // Global progress bar (based on true scroll for honesty)
        const docH = document.documentElement.scrollHeight - vh;
        const pct = docH > 0 ? Math.max(0, Math.min(1, targetY / docH)) : 0;
        if (progressBar) progressBar.style.width = (pct * 100).toFixed(2) + '%';

        let activeIdx = 0;

        sceneInfo.forEach((info, i) => {
            const p = computeProgress(info, visualY, vh);
            const top = info.offsetTop - visualY;
            if (top <= vh * 0.5 && (top + info.el.offsetHeight) >= vh * 0.5) activeIdx = i;

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
    // Convention: content fades in during pre-entry (p ∈ [-0.7, -0.15]), stays fully
    // visible through sticky (p ∈ [0, 1]). No exit fade — the scene's sticky release
    // and the next scene's stage slide handle the handoff.

    function handleIntro(scene, p) {
        const display = scene.querySelector('.db-display');
        const sub = scene.querySelector('.db-intro-sub');
        const hint = scene.querySelector('.db-scroll-hint');
        const eyebrow = scene.querySelector('.db-eyebrow');
        // Always visible at p=0 (page load). Gentle lift as user scrolls through.
        const lift = -Math.max(0, p) * 40;
        [eyebrow, display, sub].forEach(el => {
            if (!el) return;
            el.style.opacity = 1;
            el.style.transform = `translate3d(0, ${lift}px, 0)`;
        });
        if (hint) hint.style.opacity = 1 - range(p, 0.1, 0.45);
    }

    function handleInbox(scene, p) {
        const win = scene.querySelector('.db-inbox-window');
        const rows = Array.from(scene.querySelectorAll('.db-mail-row'));
        const annots = Array.from(scene.querySelectorAll('.db-annot'));
        const heading = scene.querySelector('.db-scene-heading');

        const enter = range(p, -0.75, -0.15);
        const parallax = -Math.max(0, p) * 40;

        if (heading) {
            heading.style.opacity = enter;
            heading.style.transform = `translate3d(0, ${lerp(20, 0, enter) + parallax * 0.5}px, 0)`;
        }
        if (win) {
            const rx = lerp(10, 2, enter);
            const ry = lerp(-6, -1.5, enter);
            const ty = lerp(40, 0, enter) + parallax;
            const sc = lerp(0.96, 1, enter);
            win.style.transform = `translate3d(0, ${ty}px, 0) rotateX(${rx}deg) rotateY(${ry}deg) scale(${sc})`;
            win.style.opacity = enter;
        }

        rows.forEach((row, i) => {
            const per = -0.4 + (i / Math.max(rows.length, 1)) * 0.35;
            const r = range(p, per, per + 0.18);
            row.style.opacity = Math.max(r, enter * 0.65);
            row.style.transform = `translate3d(${lerp(-14, 0, r)}px, 0, 0)`;
        });

        annots.forEach((a, i) => {
            const per = 0.15 + i * 0.08;
            const r = range(p, per, per + 0.18);
            a.style.opacity = r;
            a.style.transform = `translate3d(0, ${lerp(10, 0, r)}px, 0)`;
        });
    }

    function handleDiff(scene, p) {
        const safe = scene.querySelector('.db-diff-card.safe');
        const danger = scene.querySelector('.db-diff-card.danger');
        const vs = scene.querySelector('.db-diff-vs');
        const heading = scene.querySelector('.db-scene-heading');

        const enter = range(p, -0.75, -0.15);
        const parallax = -Math.max(0, p) * 30;

        if (heading) {
            heading.style.opacity = enter;
            heading.style.transform = `translate3d(0, ${lerp(20, 0, enter) + parallax * 0.5}px, 0)`;
        }
        if (safe) {
            const r = range(p, -0.6, -0.15);
            safe.style.opacity = r;
            safe.style.transform = `translate3d(${lerp(-24, 0, r)}px, ${parallax}px, 0)`;
        }
        if (danger) {
            const r = range(p, -0.4, 0.05);
            danger.style.opacity = r;
            danger.style.transform = `translate3d(${lerp(24, 0, r)}px, ${parallax}px, 0)`;
        }
        if (vs) {
            const r = range(p, -0.2, 0.15);
            vs.style.opacity = r;
            vs.style.transform = `scale(${lerp(0.7, 1, r)})`;
        }
    }

    function handleLink(scene, p) {
        const preview = scene.querySelector('.db-link-preview');
        const actualWrap = scene.querySelector('.db-link-actual-wrap');
        const cursor = scene.querySelector('.db-cursor');
        const heading = scene.querySelector('.db-scene-heading');

        const enter = range(p, -0.75, -0.15);
        const parallax = -Math.max(0, p) * 30;

        if (heading) {
            heading.style.opacity = enter;
            heading.style.transform = `translate3d(0, ${lerp(20, 0, enter) + parallax * 0.5}px, 0)`;
        }
        if (preview) {
            preview.style.opacity = enter;
            preview.style.transform = `translate3d(0, ${lerp(16, 0, enter) + parallax}px, 0) scale(${lerp(0.97, 1, enter)})`;
            preview.style.filter = '';
        }
        if (cursor) {
            const cr = range(p, -0.1, 0.3);
            cursor.style.opacity = cr;
            const x = lerp(-140, 40, cr);
            const y = lerp(100, 0, cr);
            cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        }
        if (actualWrap) {
            const ar = range(p, 0.05, 0.4);
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

        const enter = range(p, -0.75, -0.15);
        const parallax = -Math.max(0, p) * 40;

        if (heading) {
            heading.style.opacity = enter;
            heading.style.transform = `translate3d(0, ${lerp(20, 0, enter) + parallax * 0.5}px, 0)`;
        }
        if (browser) {
            browser.style.opacity = enter;
            browser.style.transform = `translate3d(0, ${lerp(40, 0, enter) + parallax}px, 0) scale(${lerp(0.96, 1, enter)})`;
        }
        if (callout) {
            const r = range(p, -0.05, 0.25);
            callout.style.opacity = r;
            callout.style.transform = `translate(-50%, ${lerp(-6, -16, r)}px)`;
        }
    }

    function handlePopups(scene, p) {
        const popups = Array.from(scene.querySelectorAll('.db-popup'));
        const heading = scene.querySelector('.db-scene-heading');
        const enter = range(p, -0.7, -0.15);
        const parallax = -Math.max(0, p) * 30;

        if (heading) {
            heading.style.opacity = enter;
            heading.style.transform = `translate3d(0, ${lerp(20, 0, enter) + parallax * 0.5}px, 0)`;
        }

        popups.forEach((pop, i) => {
            const start = -0.5 + i * 0.1;
            const end = start + 0.28;
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

        // Crossfade windows: each word's full-visibility moment peaks at its center.
        // Windows overlap slightly so one fades out while the next fades in.
        // Words cycle during p ∈ [0.08, 0.92] (within the sticky phase).
        const startP = 0.05;
        const endP = 0.92;
        const span = endP - startP;
        const slot = span / n;
        const halfWidth = slot * 0.75; // overlap factor

        words.forEach((w, i) => {
            const peak = startP + (i + 0.5) * slot;
            const distance = Math.abs(p - peak);
            const raw = clamp01(1 - distance / halfWidth);
            const vis = smoothstep(raw);
            const scale = lerp(0.88, 1, vis);
            const ty = lerp(18, 0, vis);
            w.style.opacity = vis;
            w.style.transform = `translate3d(0, ${ty}px, 0) scale(${scale})`;
        });

        // Eyebrow and caption: fade in during pre-entry, stay throughout.
        const framing = range(p, -0.6, -0.1);
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
        const enter = range(p, -0.75, -0.15);
        const parallax = -Math.max(0, p) * 30;

        if (heading) {
            heading.style.opacity = enter;
            heading.style.transform = `translate3d(0, ${lerp(20, 0, enter) + parallax * 0.5}px, 0)`;
        }

        signs.forEach((s, i) => {
            const start = -0.55 + i * 0.1;
            const r = range(p, start, start + 0.25);
            s.style.opacity = r;
            s.style.transform = `translate3d(0, ${lerp(30, 0, r) + parallax * 0.3}px, 0)`;
        });
    }

    function handlePlaybook(scene, p) {
        const rules = Array.from(scene.querySelectorAll('.db-rule'));
        const heading = scene.querySelector('.db-scene-heading');
        const enter = range(p, -0.75, -0.15);
        const parallax = -Math.max(0, p) * 30;

        if (heading) {
            heading.style.opacity = enter;
            heading.style.transform = `translate3d(0, ${lerp(20, 0, enter) + parallax * 0.5}px, 0)`;
        }

        rules.forEach((r, i) => {
            const start = -0.55 + i * 0.1;
            const prog = range(p, start, start + 0.25);
            r.style.opacity = prog;
            r.style.transform = `translate3d(${lerp(-20, 0, prog)}px, ${parallax * 0.3}px, 0)`;
        });
    }

    function handleCta(scene, p) {
        const display = scene.querySelector('.db-cta-display');
        const sub = scene.querySelector('.db-cta-sub');
        const actions = scene.querySelector('.db-cta-actions');
        const footnote = scene.querySelector('.db-cta-footnote');

        [display, sub, actions, footnote].forEach((el, i) => {
            if (!el) return;
            const start = -0.55 + i * 0.08;
            const r = range(p, start, start + 0.3);
            el.style.opacity = r;
            el.style.transform = `translate3d(0, ${lerp(26, 0, r)}px, 0)`;
        });
    }

    // ----- Navigation -----
    dots.forEach((d, i) => {
        d.addEventListener('click', () => {
            const info = sceneInfo[i];
            if (!info) return;
            window.scrollTo({
                top: info.offsetTop + 20,
                behavior: prefersReducedMotion ? 'auto' : 'smooth'
            });
        });
    });

    window.addEventListener('resize', refreshOffsets, { passive: true });
    // refresh once fonts settle (layout shifts can move offsets)
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(refreshOffsets);
    }

    // Kick off the continuous rAF loop
    requestAnimationFrame(loop);
})();
