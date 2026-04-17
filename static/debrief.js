// Debrief — scroll-driven cinematic engine
// Uses rAF + sticky scenes. Each scene computes its own 0→1 progress from
// its own bounding rect so scenes are independently composable.

(() => {
    const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const progressBar = document.querySelector('.db-progress-fill');
    const scenes = Array.from(document.querySelectorAll('.db-scene'));
    const dots = Array.from(document.querySelectorAll('.db-dot'));
    const glitch = document.querySelector('.db-glitch');

    // Map scene id -> progress handler
    const handlers = {
        'intro'    : handleIntro,
        'inbox'    : handleInbox,
        'diff'     : handleDiff,
        'link'     : handleLink,
        'browser'  : handleBrowser,
        'popups'   : handlePopups,
        'psych'    : handlePsych,
        'signs'    : handleSigns,
        'playbook' : handlePlaybook,
        'cta'      : handleCta,
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

    function tick() {
        rafPending = false;

        // Global progress bar
        const docH = document.documentElement.scrollHeight - window.innerHeight;
        const pct = docH > 0 ? Math.max(0, Math.min(1, lastScrollY / docH)) : 0;
        if (progressBar) progressBar.style.width = (pct * 100).toFixed(2) + '%';

        // Scene progress
        const vh = window.innerHeight;
        let activeIdx = 0;
        scenes.forEach((scene, i) => {
            const rect = scene.getBoundingClientRect();
            // Scene progress: 0 when top of scene enters viewport top, 1 when scene has scrolled out
            const total = rect.height - vh;
            const scrolled = -rect.top;
            const p = total > 0 ? Math.max(0, Math.min(1, scrolled / total)) : (rect.top < 0 ? 1 : 0);

            // Is this scene currently centered?
            const center = rect.top + rect.height / 2;
            const vhCenter = vh / 2;
            if (rect.top <= vh * 0.5 && rect.bottom >= vh * 0.5) activeIdx = i;

            const id = scene.dataset.scene;
            const fn = handlers[id];
            if (fn) fn(scene, p);
        });

        // Dots
        dots.forEach((d, i) => d.classList.toggle('active', i === activeIdx));
    }

    // ----- Handler helpers -----
    function lerp(a, b, t) { return a + (b - a) * t; }
    function clamp01(t) { return Math.max(0, Math.min(1, t)); }
    // Ease progress windows: [start, end] -> 0→1 inside that window
    function range(p, start, end) {
        if (end === start) return p >= end ? 1 : 0;
        return clamp01((p - start) / (end - start));
    }

    function setOpacity(el, v) { if (el) el.style.opacity = v; }
    function setTransform(el, t) { if (el) el.style.transform = t; }

    // ----- Scene handlers -----

    function handleIntro(scene, p) {
        const display = scene.querySelector('.db-display');
        const sub = scene.querySelector('.db-intro-sub');
        const hint = scene.querySelector('.db-scroll-hint');
        const eyebrow = scene.querySelector('.db-eyebrow');
        // First 60% of scroll: fade content out as user leaves
        const fade = 1 - range(p, 0.5, 1);
        const lift = -p * 60;
        [eyebrow, display, sub].forEach(el => {
            if (!el) return;
            el.style.opacity = fade;
            el.style.transform = `translateY(${lift}px)`;
        });
        if (hint) hint.style.opacity = 1 - range(p, 0, 0.2);
    }

    function handleInbox(scene, p) {
        const win = scene.querySelector('.db-inbox-window');
        const rows = Array.from(scene.querySelectorAll('.db-mail-row'));
        const annots = Array.from(scene.querySelectorAll('.db-annot'));
        const heading = scene.querySelector('.db-scene-heading');

        // Window slides up and rotates as it enters
        const enter = range(p, 0, 0.25);
        const exit = range(p, 0.8, 1);
        if (win) {
            const rx = lerp(18, 4, enter);
            const ry = lerp(-10, -2, enter);
            const ty = lerp(80, 0, enter) + exit * -40;
            const sc = lerp(0.9, 1, enter) * (1 - exit * 0.05);
            const op = enter * (1 - exit);
            win.style.transform = `translateY(${ty}px) rotateX(${rx}deg) rotateY(${ry}deg) scale(${sc})`;
            win.style.opacity = op;
        }
        if (heading) {
            heading.style.opacity = enter * (1 - exit);
            heading.style.transform = `translateY(${lerp(20, 0, enter)}px)`;
        }

        // Rows cascade as scroll progresses (0.2 → 0.6)
        const rowStart = 0.15;
        const rowEnd = 0.55;
        rows.forEach((row, i) => {
            const per = rowStart + (i / rows.length) * (rowEnd - rowStart);
            const r = range(p, per, per + 0.08);
            row.style.opacity = r * (1 - exit);
            row.style.transform = `translateX(${lerp(-20, 0, r)}px)`;
        });

        // Annotations pop in sequentially after rows
        annots.forEach((a, i) => {
            const per = 0.6 + i * 0.06;
            const r = range(p, per, per + 0.08);
            a.style.opacity = r * (1 - exit);
            a.style.transform = `translateY(${lerp(10, 0, r)}px)`;
        });
    }

    function handleDiff(scene, p) {
        const safe = scene.querySelector('.db-diff-card.safe');
        const danger = scene.querySelector('.db-diff-card.danger');
        const vs = scene.querySelector('.db-diff-vs');
        const heading = scene.querySelector('.db-scene-heading');

        const enter = range(p, 0, 0.3);
        const exit  = range(p, 0.75, 1);

        if (heading) {
            heading.style.opacity = enter * (1 - exit);
            heading.style.transform = `translateY(${lerp(20, 0, enter)}px)`;
        }
        if (safe) {
            const r = range(p, 0.1, 0.4);
            safe.style.opacity = r * (1 - exit);
            safe.style.transform = `translateX(${lerp(-40, 0, r)}px)`;
        }
        if (danger) {
            const r = range(p, 0.25, 0.55);
            danger.style.opacity = r * (1 - exit);
            danger.style.transform = `translateX(${lerp(40, 0, r)}px)`;
        }
        if (vs) {
            const r = range(p, 0.45, 0.6);
            vs.style.opacity = r * (1 - exit);
            vs.style.transform = `scale(${lerp(0.6, 1, r)})`;
        }
    }

    function handleLink(scene, p) {
        const preview = scene.querySelector('.db-link-preview');
        const actualWrap = scene.querySelector('.db-link-actual-wrap');
        const cursor = scene.querySelector('.db-cursor');
        const heading = scene.querySelector('.db-scene-heading');

        const enter = range(p, 0, 0.25);
        const exit = range(p, 0.8, 1);

        if (heading) {
            heading.style.opacity = enter * (1 - exit);
            heading.style.transform = `translateY(${lerp(20, 0, enter)}px)`;
        }
        if (preview) {
            preview.style.opacity = enter * (1 - exit);
            preview.style.transform = `translateY(${lerp(20, 0, enter)}px) scale(${lerp(0.95, 1, enter)})`;
        }

        // Cursor moves from outside into the link over 0.25 → 0.45
        if (cursor) {
            const cr = range(p, 0.25, 0.45);
            cursor.style.opacity = cr;
            const x = lerp(-160, 40, cr);
            const y = lerp(120, 0, cr);
            cursor.style.transform = `translate(${x}px, ${y}px)`;
        }

        // Actual URL reveals at 0.45 → 0.6
        if (actualWrap) {
            const ar = range(p, 0.45, 0.62);
            actualWrap.style.opacity = ar;
            actualWrap.style.transform = `translate(-50%, ${lerp(-10, 0, ar)}px)`;
        }

        // Glitch at 0.7
        if (p > 0.7 && !clickTriggered && !prefersReducedMotion) {
            clickTriggered = true;
            if (glitch) {
                glitch.classList.remove('on');
                // force reflow
                void glitch.offsetWidth;
                glitch.classList.add('on');
            }
            if (preview) preview.style.filter = 'blur(2px)';
        } else if (p < 0.6 && clickTriggered) {
            clickTriggered = false;
            if (preview) preview.style.filter = '';
        }
    }

    function handleBrowser(scene, p) {
        const browser = scene.querySelector('.db-browser');
        const callout = scene.querySelector('.db-browser-callout');
        const heading = scene.querySelector('.db-scene-heading');

        const enter = range(p, 0.05, 0.3);
        const exit = range(p, 0.8, 1);

        if (heading) {
            heading.style.opacity = enter * (1 - exit);
            heading.style.transform = `translateY(${lerp(20, 0, enter)}px)`;
        }
        if (browser) {
            browser.style.opacity = enter * (1 - exit);
            browser.style.transform = `translateY(${lerp(60, 0, enter) + exit * -40}px) scale(${lerp(0.92, 1, enter)})`;
        }
        if (callout) {
            const r = range(p, 0.35, 0.55);
            callout.style.opacity = r * (1 - exit);
            callout.style.transform = `translate(-50%, ${lerp(-6, -16, r)}px)`;
        }
    }

    function handlePopups(scene, p) {
        const popups = Array.from(scene.querySelectorAll('.db-popup'));
        const heading = scene.querySelector('.db-scene-heading');
        const enter = range(p, 0, 0.2);
        const exit = range(p, 0.8, 1);

        if (heading) {
            heading.style.opacity = enter * (1 - exit);
            heading.style.transform = `translateY(${lerp(20, 0, enter)}px)`;
        }

        popups.forEach((pop, i) => {
            const start = 0.12 + i * 0.1;
            const end = start + 0.14;
            const r = range(p, start, end);
            const baseX = parseFloat(pop.dataset.x || 0);
            const baseY = parseFloat(pop.dataset.y || 0);
            const baseR = parseFloat(pop.dataset.r || 0);
            const fromX = parseFloat(pop.dataset.fromX || -300);
            const fromY = parseFloat(pop.dataset.fromY || 300);
            const tx = lerp(fromX, baseX, r);
            const ty = lerp(fromY, baseY, r);
            pop.style.opacity = r * (1 - exit);
            pop.style.transform = `translate(${tx}px, ${ty}px) rotate(${baseR}deg) scale(${lerp(0.9, 1, r)})`;
        });
    }

    function handlePsych(scene, p) {
        const words = Array.from(scene.querySelectorAll('.db-psych-word'));
        const caption = scene.querySelector('.db-psych-caption');
        const exit = range(p, 0.85, 1);

        words.forEach((w, i) => {
            const start = 0.08 + i * 0.16;
            const end = start + 0.1;
            const r = range(p, start, end);
            // A word stays "active" for its window, fades before the next one hits
            const next = 0.08 + (i + 1) * 0.16;
            const fadeOut = range(p, next - 0.02, next + 0.06);
            const opacity = lerp(0.1, 1, r) * (1 - fadeOut * 0.7) * (1 - exit);
            w.style.opacity = opacity;
            w.classList.toggle('active', r > 0.5 && fadeOut < 0.5);
            w.style.transform = `translateY(${lerp(30, 0, r)}px) scale(${lerp(0.9, 1, r)})`;
        });

        if (caption) {
            const r = range(p, 0.05, 0.18);
            caption.style.opacity = r * (1 - exit);
            caption.style.transform = `translate(-50%, ${lerp(10, 0, r)}px)`;
        }
    }

    function handleSigns(scene, p) {
        const signs = Array.from(scene.querySelectorAll('.db-sign'));
        const heading = scene.querySelector('.db-scene-heading');
        const enter = range(p, 0, 0.2);
        const exit = range(p, 0.85, 1);

        if (heading) {
            heading.style.opacity = enter * (1 - exit);
            heading.style.transform = `translateY(${lerp(20, 0, enter)}px)`;
        }

        signs.forEach((s, i) => {
            const start = 0.15 + i * 0.1;
            const r = range(p, start, start + 0.15);
            s.style.opacity = r * (1 - exit);
            s.style.transform = `translateY(${lerp(40, 0, r)}px)`;
        });
    }

    function handlePlaybook(scene, p) {
        const rules = Array.from(scene.querySelectorAll('.db-rule'));
        const heading = scene.querySelector('.db-scene-heading');
        const enter = range(p, 0, 0.2);
        const exit = range(p, 0.85, 1);

        if (heading) {
            heading.style.opacity = enter * (1 - exit);
            heading.style.transform = `translateY(${lerp(20, 0, enter)}px)`;
        }

        rules.forEach((r, i) => {
            const start = 0.15 + i * 0.1;
            const prog = range(p, start, start + 0.12);
            r.style.opacity = prog * (1 - exit);
            r.style.transform = `translateX(${lerp(-30, 0, prog)}px)`;
        });
    }

    function handleCta(scene, p) {
        const display = scene.querySelector('.db-cta-display');
        const sub = scene.querySelector('.db-cta-sub');
        const actions = scene.querySelector('.db-cta-actions');
        const footnote = scene.querySelector('.db-cta-footnote');

        const enter = range(p, 0, 0.35);
        [display, sub, actions, footnote].forEach((el, i) => {
            if (!el) return;
            const start = 0.05 + i * 0.08;
            const r = range(p, start, start + 0.2);
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
                top: scene.offsetTop + 80,
                behavior: prefersReducedMotion ? 'auto' : 'smooth'
            });
        });
    });

    // Initial paint + listener
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    onScroll();
    // Also run once more after fonts settle
    requestAnimationFrame(() => requestAnimationFrame(tick));
})();
