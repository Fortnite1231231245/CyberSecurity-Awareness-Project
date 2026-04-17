// Debrief — scroll-driven cinematic engine.
// Each scene is a sticky stage with a tall scroll track. Content appears as the
// scene approaches (pre-entry), stays fully visible while sticky, and scrolls
// naturally out the top as the next scene's stage slides in.

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

    let rafPending = false;
    let lastScrollY = 0;
    let clickTriggered = false;

    function onScroll() {
        lastScrollY = window.scrollY;
        if (!rafPending) {
            rafPending = true;
            requestAnimationFrame(tick);
        }
    }

    // Progress range: -1 (scene's top one viewport below = just entering bottom)
    // 0 (scene's top at viewport top = sticky just activated)
    // 1 (scene's bottom at viewport bottom = about to unstick)
    function computeProgress(scene, vh) {
        const rect = scene.getBoundingClientRect();
        const total = rect.height - vh;
        if (rect.top <= 0) {
            if (total <= 0) return 1;
            return Math.min(1, Math.max(0, -rect.top / total));
        }
        // Pre-entry: rect.top in (0, vh]
        return -Math.min(1, rect.top / vh);
    }

    function tick() {
        rafPending = false;

        const docH = document.documentElement.scrollHeight - window.innerHeight;
        const pct = docH > 0 ? Math.max(0, Math.min(1, lastScrollY / docH)) : 0;
        if (progressBar) progressBar.style.width = (pct * 100).toFixed(2) + '%';

        const vh = window.innerHeight;
        let activeIdx = 0;

        scenes.forEach((scene, i) => {
            const p = computeProgress(scene, vh);
            const rect = scene.getBoundingClientRect();
            if (rect.top <= vh * 0.5 && rect.bottom >= vh * 0.5) activeIdx = i;

            const fn = handlers[scene.dataset.scene];
            if (fn) fn(scene, p);
        });

        dots.forEach((d, i) => d.classList.toggle('active', i === activeIdx));
    }

    // ----- Utilities -----
    function lerp(a, b, t) { return a + (b - a) * t; }
    function clamp01(t) { return Math.max(0, Math.min(1, t)); }
    // Map p from [start, end] to [0, 1], clamped.
    function range(p, start, end) {
        if (end === start) return p >= end ? 1 : 0;
        return clamp01((p - start) / (end - start));
    }

    // ----- Scene handlers -----
    // Convention: content fades IN during p ∈ [-0.4, 0] (pre-entry into sticky).
    // Content stays fully visible for p ∈ [0, 1]. No exit fade — the scene's
    // sticky release + next scene's stage handle the transition naturally.

    function handleIntro(scene, p) {
        const display = scene.querySelector('.db-display');
        const sub = scene.querySelector('.db-intro-sub');
        const hint = scene.querySelector('.db-scroll-hint');
        const eyebrow = scene.querySelector('.db-eyebrow');
        // Intro is visible immediately on page load (p = 0). Just lift gently.
        const travel = -Math.max(0, p) * 30;
        [eyebrow, display, sub].forEach(el => {
            if (!el) return;
            el.style.opacity = 1;
            el.style.transform = `translateY(${travel}px)`;
        });
        if (hint) hint.style.opacity = 1 - range(p, 0.15, 0.5);
    }

    function handleInbox(scene, p) {
        const win = scene.querySelector('.db-inbox-window');
        const rows = Array.from(scene.querySelectorAll('.db-mail-row'));
        const annots = Array.from(scene.querySelectorAll('.db-annot'));
        const heading = scene.querySelector('.db-scene-heading');

        const enter = range(p, -0.7, -0.15);
        if (heading) {
            heading.style.opacity = enter;
            heading.style.transform = `translateY(${lerp(20, 0, enter)}px)`;
        }
        if (win) {
            const rx = lerp(14, 3, enter);
            const ry = lerp(-8, -2, enter);
            const ty = lerp(60, 0, enter);
            const sc = lerp(0.92, 1, enter);
            win.style.transform = `translateY(${ty}px) rotateX(${rx}deg) rotateY(${ry}deg) scale(${sc})`;
            win.style.opacity = enter;
        }

        // Rows cascade with a baseline from the window's enter (never fully invisible)
        rows.forEach((row, i) => {
            const per = -0.4 + (i / Math.max(rows.length, 1)) * 0.35;
            const r = range(p, per, per + 0.14);
            row.style.opacity = Math.max(r, enter * 0.6);
            row.style.transform = `translateX(${lerp(-20, 0, r)}px)`;
        });

        // Annotations pop during sticky after rows settle
        annots.forEach((a, i) => {
            const per = 0.15 + i * 0.08;
            const r = range(p, per, per + 0.14);
            a.style.opacity = r;
            a.style.transform = `translateY(${lerp(10, 0, r)}px)`;
        });
    }

    function handleDiff(scene, p) {
        const safe = scene.querySelector('.db-diff-card.safe');
        const danger = scene.querySelector('.db-diff-card.danger');
        const vs = scene.querySelector('.db-diff-vs');
        const heading = scene.querySelector('.db-scene-heading');

        const enter = range(p, -0.7, -0.15);
        if (heading) {
            heading.style.opacity = enter;
            heading.style.transform = `translateY(${lerp(20, 0, enter)}px)`;
        }
        if (safe) {
            const r = range(p, -0.55, -0.1);
            safe.style.opacity = r;
            safe.style.transform = `translateX(${lerp(-40, 0, r)}px)`;
        }
        if (danger) {
            const r = range(p, -0.35, 0.1);
            danger.style.opacity = r;
            danger.style.transform = `translateX(${lerp(40, 0, r)}px)`;
        }
        if (vs) {
            const r = range(p, -0.2, 0.15);
            vs.style.opacity = r;
            vs.style.transform = `scale(${lerp(0.6, 1, r)})`;
        }
    }

    function handleLink(scene, p) {
        const preview = scene.querySelector('.db-link-preview');
        const actualWrap = scene.querySelector('.db-link-actual-wrap');
        const cursor = scene.querySelector('.db-cursor');
        const heading = scene.querySelector('.db-scene-heading');

        const enter = range(p, -0.7, -0.15);
        if (heading) {
            heading.style.opacity = enter;
            heading.style.transform = `translateY(${lerp(20, 0, enter)}px)`;
        }
        if (preview) {
            preview.style.opacity = enter;
            preview.style.transform = `translateY(${lerp(20, 0, enter)}px) scale(${lerp(0.96, 1, enter)})`;
            preview.style.filter = '';
        }
        if (cursor) {
            const cr = range(p, -0.1, 0.25);
            cursor.style.opacity = cr;
            const x = lerp(-160, 40, cr);
            const y = lerp(120, 0, cr);
            cursor.style.transform = `translate(${x}px, ${y}px)`;
        }
        if (actualWrap) {
            const ar = range(p, 0.1, 0.45);
            actualWrap.style.opacity = ar;
            actualWrap.style.transform = `translate(-50%, ${lerp(-10, 0, ar)}px)`;
        }
        // One-shot glitch past the click moment
        if (p > 0.65 && !clickTriggered && !prefersReducedMotion) {
            clickTriggered = true;
            if (glitch) {
                glitch.classList.remove('on');
                void glitch.offsetWidth;
                glitch.classList.add('on');
            }
        } else if (p < 0.5 && clickTriggered) {
            clickTriggered = false;
        }
    }

    function handleBrowser(scene, p) {
        const browser = scene.querySelector('.db-browser');
        const callout = scene.querySelector('.db-browser-callout');
        const heading = scene.querySelector('.db-scene-heading');

        const enter = range(p, -0.7, -0.15);
        if (heading) {
            heading.style.opacity = enter;
            heading.style.transform = `translateY(${lerp(20, 0, enter)}px)`;
        }
        if (browser) {
            browser.style.opacity = enter;
            browser.style.transform = `translateY(${lerp(60, 0, enter)}px) scale(${lerp(0.94, 1, enter)})`;
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
        const enter = range(p, -0.3, 0);

        if (heading) {
            heading.style.opacity = enter;
            heading.style.transform = `translateY(${lerp(20, 0, enter)}px)`;
        }

        popups.forEach((pop, i) => {
            const start = -0.5 + i * 0.1;
            const end = start + 0.22;
            const r = range(p, start, end);
            const baseX = parseFloat(pop.dataset.x || 0);
            const baseY = parseFloat(pop.dataset.y || 0);
            const baseR = parseFloat(pop.dataset.r || 0);
            const fromX = parseFloat(pop.dataset.fromX || -300);
            const fromY = parseFloat(pop.dataset.fromY || 300);
            const tx = lerp(fromX, baseX, r);
            const ty = lerp(fromY, baseY, r);
            pop.style.opacity = r;
            pop.style.transform = `translate(${tx}px, ${ty}px) rotate(${baseR}deg) scale(${lerp(0.92, 1, r)})`;
        });
    }

    function handlePsych(scene, p) {
        const words = Array.from(scene.querySelectorAll('.db-psych-word'));
        const caption = scene.querySelector('.db-psych-caption');

        // Words light up in sequence but all remain present (vertical stack).
        // Each word has a baseline opacity so we never see an empty viewport.
        words.forEach((w, i) => {
            const count = words.length;
            const start = 0.05 + (i / count) * 0.75;
            const end = start + 0.12;
            const peak = range(p, start, end);
            const sustain = range(p, end, end + 0.14);
            // Baseline from 0.1 (pre-enter) ramping to visible throughout
            const base = lerp(0.15, 0.4, range(p, -0.3, 0));
            const activeBoost = peak * (1 - sustain * 0.5);
            w.style.opacity = Math.max(base, activeBoost + base * 0.6);
            w.classList.toggle('active', peak > 0.5 && sustain < 0.5);
            w.style.transform = `translateY(${lerp(24, 0, Math.max(peak, range(p, -0.2, 0)))}px)`;
        });

        if (caption) {
            const r = range(p, -0.1, 0.15);
            caption.style.opacity = r;
            caption.style.transform = `translate(-50%, ${lerp(10, 0, r)}px)`;
        }
    }

    function handleSigns(scene, p) {
        const signs = Array.from(scene.querySelectorAll('.db-sign'));
        const heading = scene.querySelector('.db-scene-heading');
        const enter = range(p, -0.7, -0.15);

        if (heading) {
            heading.style.opacity = enter;
            heading.style.transform = `translateY(${lerp(20, 0, enter)}px)`;
        }

        signs.forEach((s, i) => {
            const start = -0.55 + i * 0.1;
            const r = range(p, start, start + 0.2);
            s.style.opacity = r;
            s.style.transform = `translateY(${lerp(40, 0, r)}px)`;
        });
    }

    function handlePlaybook(scene, p) {
        const rules = Array.from(scene.querySelectorAll('.db-rule'));
        const heading = scene.querySelector('.db-scene-heading');
        const enter = range(p, -0.7, -0.15);

        if (heading) {
            heading.style.opacity = enter;
            heading.style.transform = `translateY(${lerp(20, 0, enter)}px)`;
        }

        rules.forEach((r, i) => {
            const start = -0.55 + i * 0.1;
            const prog = range(p, start, start + 0.2);
            r.style.opacity = prog;
            r.style.transform = `translateX(${lerp(-30, 0, prog)}px)`;
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
            const r = range(p, start, start + 0.25);
            el.style.opacity = r;
            el.style.transform = `translateY(${lerp(30, 0, r)}px)`;
        });
    }

    // Dot navigation
    dots.forEach((d, i) => {
        d.addEventListener('click', () => {
            const scene = scenes[i];
            if (!scene) return;
            window.scrollTo({
                top: scene.offsetTop + 20,
                behavior: prefersReducedMotion ? 'auto' : 'smooth'
            });
        });
    });

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    onScroll();
    requestAnimationFrame(() => requestAnimationFrame(tick));
})();
