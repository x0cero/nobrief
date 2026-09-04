/* Plate IV — Trail.
   Twenty thousand walkers. Each one smells three points ahead of itself,
   turns toward whichever of the three smells strongest, and leaves a smell
   behind it. The smell spreads a little and fades a little. That is all of it.

   The map is a grid of numbers; the walkers are three numbers each (where,
   where, which way). Everything that looks designed in here is the argument
   those two facts have with each other. */

(function () {
  const canvas = document.getElementById('trail-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: false });
  const hudEl    = document.getElementById('trail-hud');
  const statusEl = document.getElementById('trail-status');
  const restartEl = document.getElementById('trail-restart');
  const chips = Array.from(document.querySelectorAll('.chip[data-species]'));

  /* Four sets of numbers for the same four rules. Nothing else differs. */
  const SPECIES = {
    veins: { label: 'Veins', sa: 22, sd:  6, ta: 26, speed: 0.70, deposit: 0.10, decay: 0.880, diff: 0.14, wobble: 0.08, lost: 0.0018, density: 0.070 },
    lace:  { label: 'Lace',  sa: 45, sd:  9, ta: 20, speed: 0.80, deposit: 0.09, decay: 0.855, diff: 0.12, wobble: 0.06, lost: 0.0030, density: 0.100 },
    cells: { label: 'Cells', sa: 90, sd: 20, ta: 40, speed: 1.00, deposit: 0.14, decay: 0.930, diff: 0.30, wobble: 0.05, lost: 0.0010, density: 0.070 },
    drift: { label: 'Drift', sa: 12, sd: 26, ta:  8, speed: 1.30, deposit: 0.12, decay: 0.950, diff: 0.35, wobble: 0.02, lost: 0.0015, density: 0.055 },
  };
  const DEG = Math.PI / 180;

  const MIN_W = 480;      // simulation width in cells, floor and ceiling; the
  const MAX_W = 840;      // element is scaled from whatever lands in between
  const RATIO = 0.62;

  let SW = 0, SH = 0, N = 0;
  let trail = null, temp = null, agents = null;
  let image = null, pixels = null;
  let lut = new Uint32Array(256);
  let sp = SPECIES.veins;
  let key = 'veins';
  let visible = true, raf = null, steps = 0, cursor = 0;

  /* ── colour ─────────────────────────────────────────────────────── */

  function hex(name, fallback) {
    const v = getComputedStyle(document.body).getPropertyValue(name).trim();
    const m = /^#([0-9a-f]{6})$/i.exec(v || '');
    const n = m ? parseInt(m[1], 16) : fallback;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /* One lookup table instead of a colour calculation per pixel per frame.
     Concentration runs 0 upward with no ceiling, so the ramp is a curve that
     approaches full ink and never reaches it. The densest tenth picks up a
     little of the page's red, which is the only decorative decision in here. */
  function buildLut() {
    const paper  = hex('--paper-2', 0xE9E3D6);
    const ink    = hex('--ink',     0x17150F);
    const accent = hex('--accent',  0xB4442A);
    for (let i = 0; i < 256; i++) {
      const v = i / 255;                        // concentration, held between 0 and 1
      const t = Math.pow(v, 0.62);              // most of the ramp spent on faint trails
      const warm = Math.max(0, (v - 0.82) / 0.18) * 0.5;
      let r = paper[0] + (ink[0] - paper[0]) * t;
      let g = paper[1] + (ink[1] - paper[1]) * t;
      let b = paper[2] + (ink[2] - paper[2]) * t;
      r += (accent[0] - r) * warm;
      g += (accent[1] - g) * warm;
      b += (accent[2] - b) * warm;
      lut[i] = (255 << 24) | (b << 16) | (g << 8) | r;   // little endian RGBA
    }
  }

  /* ── setup ──────────────────────────────────────────────────────── */

  function resize() {
    const rect = canvas.getBoundingClientRect();
    /* A phone's plate is 350 css pixels wide, and a 350 cell sheet shows this
       structure at roughly twice the magnification of a desktop one, which
       reads as four fat roads and nothing else. The floor keeps the picture the
       same picture on a small screen, and the extra cells are free there
       because the sheet is smaller anyway. */
    SW = Math.max(MIN_W, Math.min(MAX_W, Math.round(rect.width) || MAX_W));
    SH = Math.round(SW * RATIO);
    canvas.width = SW;
    canvas.height = SH;
    trail = new Float32Array(SW * SH);
    temp  = new Float32Array(SW * SH);
    image = ctx.createImageData(SW, SH);
    pixels = new Uint32Array(image.data.buffer);
  }

  function seed() {
    trail.fill(0);
    N = Math.round(SW * SH * sp.density);
    agents = new Float32Array(N * 3);
    /* Scattered evenly, facing anywhere. There is no starting arrangement that
       hints at the shape; the sheet begins as noise every single time. */
    for (let i = 0; i < N; i++) {
      agents[i * 3]     = Math.random() * SW;
      agents[i * 3 + 1] = Math.random() * SH;
      agents[i * 3 + 2] = Math.random() * Math.PI * 2;
    }
    steps = 0;
    cursor = 0;
    food = [];
    if (statusEl) statusEl.textContent = 'foraging';
    if (hudEl) hudEl.textContent = N.toLocaleString('en-US');
  }

  /* ── the rules ──────────────────────────────────────────────────── */

  function sense(x, y, h, off) {
    const a = h + off;
    let sx = (x + Math.cos(a) * sp.sd) | 0;
    let sy = (y + Math.sin(a) * sp.sd) | 0;
    sx = ((sx % SW) + SW) % SW;               // the sheet is a torus; walking
    sy = ((sy % SH) + SH) % SH;               // off one edge arrives at the other
    return trail[sy * SW + sx];
  }

  /* Left alone, this settles: the walkers all end up on a few fat roads and the
     fine structure is gone inside a minute, which is the same dead end Plate I
     ran into. The cure is the same one. A slice of the population is picked up
     every frame and dropped somewhere random, so there is always somebody out
     in the empty part of the sheet with nothing to follow. */
  function scatterSome() {
    const k = Math.round(N * (sp.lost || 0));
    for (let j = 0; j < k; j++) {
      const i3 = (cursor % N) * 3;
      cursor++;
      agents[i3]     = Math.random() * SW;
      agents[i3 + 1] = Math.random() * SH;
      agents[i3 + 2] = Math.random() * Math.PI * 2;
    }
  }

  function walk() {
    const sa = sp.sa * DEG, ta = sp.ta * DEG, v = sp.speed, dep = sp.deposit;
    const wob = (sp.wobble || 0);
    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      let x = agents[i3], y = agents[i3 + 1], h = agents[i3 + 2];

      const c = sense(x, y, h, 0);
      const l = sense(x, y, h, -sa);
      const r = sense(x, y, h, sa);

      if (c > l && c > r) { /* straight on: it is already going the right way */ }
      else if (c < l && c < r) h += Math.random() < 0.5 ? -ta : ta;  // a valley, so commit to a side
      else if (l > r) h -= ta;
      else if (r > l) h += ta;
      h += (Math.random() - 0.5) * wob;        // never perfectly obedient

      x += Math.cos(h) * v;
      y += Math.sin(h) * v;
      if (x < 0) x += SW; else if (x >= SW) x -= SW;
      if (y < 0) y += SH; else if (y >= SH) y -= SH;

      agents[i3] = x; agents[i3 + 1] = y; agents[i3 + 2] = h;
      const at = (y | 0) * SW + (x | 0);
      const laid = trail[at] + dep;
      trail[at] = laid > 1 ? 1 : laid;              // a cell can be saturated, not more than saturated
    }
  }

  /* A three by three average, done as two one dimensional passes, which is the
     same picture for a third of the arithmetic. The fade rides along on the
     second pass so the whole map is only touched twice a frame. */
  function diffuse() {
    const d = sp.decay;
    for (let y = 0; y < SH; y++) {
      const row = y * SW;
      for (let x = 0; x < SW; x++) {
        const a = trail[row + (x === 0 ? SW - 1 : x - 1)];
        const b = trail[row + x];
        const c = trail[row + (x === SW - 1 ? 0 : x + 1)];
        temp[row + x] = (a + b + c) * 0.3333333;
      }
    }
    const last = (SH - 1) * SW;
    const k = sp.diff;
    for (let y = 0; y < SH; y++) {
      const row = y * SW;
      const up = y === 0 ? last : row - SW;
      const dn = y === SH - 1 ? 0 : row + SW;
      for (let x = 0; x < SW; x++) {
        const i = row + x;
        const blurred = (temp[up + x] + temp[i] + temp[dn + x]) * 0.3333333;
        const here = trail[i];
        trail[i] = (here + (blurred - here) * k) * d;
      }
    }
  }

  function draw() {
    const n = SW * SH;
    for (let i = 0; i < n; i++) {
      let idx = (trail[i] * 255) | 0;
      if (idx > 255) idx = 255;
      pixels[i] = lut[idx];
    }
    ctx.putImageData(image, 0, 0);
  }

  /* ── feeding ────────────────────────────────────────────────────── */

  /* Food is a place that keeps smelling of something for a while, not a blob
     dropped once. A single dose is eaten in half a second and leaves a scar;
     a source that goes on giving for a few seconds is long enough for the
     network to grow a road to it, use the road, and then let it fade. */
  const FOOD_LIFE = 420;              // frames, about seven seconds
  let food = [];

  function feed(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    food.push({
      x: Math.round((clientX - rect.left) / rect.width * SW),
      y: Math.round((clientY - rect.top) / rect.height * SH),
      life: FOOD_LIFE,
    });
    if (food.length > 8) food.shift();
    if (statusEl) statusEl.textContent = 'fed';
  }

  function feedStep() {
    if (!food.length) return;
    const R = Math.max(10, Math.round(SW * 0.030));
    for (let k = food.length - 1; k >= 0; k--) {
      const f = food[k];
      /* Held at a value rather than added to one. Adding saturates the middle
         into a flat disc within a second, and a flat disc smells the same in
         every direction, which is no use to something that navigates by
         comparing. A cone can be climbed from any side. */
      const amp = 0.92 * (f.life / FOOD_LIFE);
      for (let dy = -R; dy <= R; dy++) {
        const y = ((f.y + dy) % SH + SH) % SH;
        for (let dx = -R; dx <= R; dx++) {
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > R) continue;
          const x = ((f.x + dx) % SW + SW) % SW;
          const i = y * SW + x;
          const want = amp * (1 - d / R);
          if (trail[i] < want) trail[i] = want;
        }
      }
      if (--f.life <= 0) food.splice(k, 1);
    }
  }

  /* With a mouse, holding the button down draws food along wherever you go.
     A finger cannot do that, because a finger dragged across the plate is how
     you scroll the page, and a plate that swallows the scroll is a plate you
     get stuck in. So on touch the drag belongs to the page and only a tap,
     short and staying put, counts as feeding. */
  let feeding = false, touch = null, drift = 0;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') {
      touch = { x: e.clientX, y: e.clientY, at: performance.now() };
      drift = 0;
      return;
    }
    feeding = true;
    canvas.setPointerCapture(e.pointerId);
    feed(e.clientX, e.clientY);
    if (!visible) { advance(90); }            // reduced motion: still responds
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') {
      if (touch) drift = Math.max(drift, Math.hypot(e.clientX - touch.x, e.clientY - touch.y));
      return;
    }
    if (feeding) feed(e.clientX, e.clientY);
  });

  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') {
      if (touch && drift < 12 && performance.now() - touch.at < 600) {
        feed(e.clientX, e.clientY);
        if (!visible) { advance(90); }
      }
      touch = null;
      return;
    }
    feeding = false;
  });

  canvas.addEventListener('pointercancel', () => { feeding = false; touch = null; });

  /* ── running ────────────────────────────────────────────────────── */

  function loop() {
    raf = requestAnimationFrame(loop);
    if (!visible) return;
    feedStep();
    scatterSome();
    walk();
    diffuse();
    draw();
    steps++;
    if (steps === 140 && statusEl && statusEl.textContent === 'foraging') {
      statusEl.textContent = 'settled into something';
    }
  }

  function restart() {
    resize();
    buildLut();
    seed();
    draw();
  }

  function setSpecies(k) {
    if (!SPECIES[k]) return;
    key = k;
    sp = SPECIES[k];
    chips.forEach(c => c.setAttribute('aria-pressed', String(c.dataset.species === k)));
    restart();
    if (reduce.matches) settle();
  }

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* Run the simulation without animating it, for the reduced motion path and
     for looking at a given number of steps on purpose. */
  function advance(n) {
    for (let i = 0; i < n; i++) { feedStep(); scatterSome(); walk(); diffuse(); }
    steps += n;
    draw();
  }

  function settle() {
    advance(260);
    if (statusEl) statusEl.textContent = 'settled into something';
  }

  window.NoBrief = window.NoBrief || {};
  window.NoBrief.trail = {
    restart, setSpecies, advance,
    species: () => key,
    /* The live map, handed over as it is. Whoever wants a drawing out of this
       can do their own work; the plate's job is to keep running. */
    snapshot: () => ({ trail, SW, SH, species: key, label: sp.label }),
  };

  buildLut();
  resize();
  seed();
  draw();

  if (reduce.matches) {
    /* Settling costs most of a second of arithmetic, so it waits until the
       plate is nearly on screen rather than spending it during page load. */
    visible = false;
    const once = new IntersectionObserver((e) => {
      if (!e[0].isIntersecting) return;
      once.disconnect();
      settle();
    }, { rootMargin: '250px' });
    once.observe(canvas);
  } else {
    new IntersectionObserver((e) => { visible = e[0].isIntersecting; }, { threshold: 0.05 }).observe(canvas);
    loop();
  }

  chips.forEach(c => c.addEventListener('click', () => setSpecies(c.dataset.species)));
  restartEl && restartEl.addEventListener('click', () => { restart(); if (reduce.matches) settle(); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { buildLut(); draw(); });

  /* Width only: see the note in growth.js about the address bar. */
  let rt, lastW = Math.round(canvas.getBoundingClientRect().width);
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      const w = Math.round(canvas.getBoundingClientRect().width);
      if (w === lastW) return;
      lastW = w;
      restart();
      if (reduce.matches) settle();
    }, 220);
  });

  chips.forEach(c => c.setAttribute('aria-pressed', String(c.dataset.species === key)));
})();
