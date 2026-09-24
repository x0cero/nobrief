/* Plate V: Pile.
   A sheet of squares and grains of sand landing on it one at a time. A square
   holds three. When a fourth arrives it falls over and hands one grain to each
   of its four neighbours, and a grain handed over the edge of the sheet is
   gone. A new grain only lands once the last slide has completely finished.

   That last sentence is the one the whole plate depends on. Everything the
   bars underneath show comes from sand arriving slowly and leaving at the
   edges; nothing in here knows what size a slide ought to be. */

(function () {
  const canvas = document.getElementById('pile-canvas');
  if (!canvas) return;

  const W = 160, H = 99, N = W * H;   // fixed, so the numbers are the same for everybody
  const SCALE = 4;
  const RAIN = 60;                    // grains a frame while it fills, at most
  const RAIN_FULL = 2;                // and once it is full, so one slide can be told from the next,
                                      // and the quiet between slides is visible too
  const BUDGET = 30000;               // falls a frame, at most; a bigger slide carries on next frame
  const HOLD = 70;                    // frames of quiet after a visitor's grain, so its slide can be seen
  const BINS = 17;                    // 1, 2-3, 4-7 ... 65536 and up
  const BLOCK = 2000;                  // grains per check on whether the pile is full

  const hudEl    = document.getElementById('pile-hud');
  const statusEl = document.getElementById('pile-status');
  const readEl   = document.getElementById('pile-read');
  const yoursEl  = document.getElementById('pile-yours');
  const shelfEl  = document.getElementById('pile-shelf');
  const axisEl   = document.getElementById('pile-axis');
  const closeEl  = document.getElementById('pile-closed');
  const restartEl = document.getElementById('pile-restart');

  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d', { alpha: false });
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const octx = off.getContext('2d');
  const image = octx.createImageData(W, H);
  const pixels = new Uint32Array(image.data.buffer);

  const h = new Uint8Array(N);
  const heat = new Float32Array(N);
  const stamp = new Int32Array(N);    // which slide last knocked a square over
  const stack = new Int32Array(N);    // a square is on it only while it holds four or more

  let sp = 0, closed = false;
  let landed = 0, fell = 0, largest = 0, still = 0, counted = 0;
  let hist = new Float64Array(BINS);
  let active = false, cur = 0, squares = 0, slideId = 0, mine = false, countable = true;
  let queue = [], hold = 0, dropped = 0;
  let blockIn = 0, blockOut = 0, full = false, fellThis = 0, fullAt = 0;
  let yours = null;
  let visible = true, frames = 0;

  let seed = 20260924;
  function rand() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  /* ── the rule ───────────────────────────────────────────────────── */

  function start(i, byVisitor) {
    h[i]++;
    landed++;
    blockIn++;
    active = true;
    cur = 0; squares = 0; fellThis = 0;
    slideId++;
    mine = byVisitor;
    countable = !closed;
    if (h[i] >= 4) stack[sp++] = i;
  }

  function give(j) {
    h[j]++;
    if (h[j] === 4) stack[sp++] = j;
  }

  /* One square falls over. A grain sent past an open edge is simply lost;
     past a closed one it stays where it was, which is the only difference
     between the two versions of this plate. */
  function topple(c) {
    h[c] -= 4;
    if (h[c] >= 4) stack[sp++] = c;
    const x = c % W, y = (c - x) / W;
    let lost = 0;
    if (x > 0)     give(c - 1); else lost++;
    if (x < W - 1) give(c + 1); else lost++;
    if (y > 0)     give(c - W); else lost++;
    if (y < H - 1) give(c + W); else lost++;
    if (lost) {
      if (closed) { for (let k = 0; k < lost; k++) give(c); }
      else { fell += lost; fellThis += lost; }
    }
    heat[c] = 1;
    if (stamp[c] !== slideId) { stamp[c] = slideId; squares++; }
    cur++;
  }

  function relax(limit) {
    let n = 0;
    while (sp && n < limit) {
      const c = stack[--sp];
      if (h[c] < 4) continue;
      topple(c);
      n++;
    }
    return n;
  }

  function finish() {
    active = false;
    blockOut += fellThis;
    /* Only a full pile goes on the shelf. While it is filling, almost every
       grain lands on room to spare, and counting those would be measuring the
       filling rather than the pile. */
    if (countable && !closed && full) {
      counted++;
      if (cur === 0) still++;
      else hist[Math.min(BINS - 1, Math.floor(Math.log2(cur)))]++;
      if (cur > largest) largest = cur;
    }
    if (mine) {
      yours = { falls: cur, squares, bin: cur ? Math.min(BINS - 1, Math.floor(Math.log2(cur))) : -1, counted: countable && !closed && full };
      hold = HOLD;
      tellYours();
    }
    /* Full means as much sand is leaving over the edges as is landing on top.
       It is measured, not assumed: a block of grains in, a count of grains out. */
    if (blockIn >= BLOCK) {
      if (!full && blockOut >= blockIn * 0.8) { full = true; fullAt = landed; say(); }
      blockIn = 0; blockOut = 0;
    }
  }

  /* One frame of weather: up to RAIN grains, up to BUDGET falls. A slide
     bigger than the budget is left half finished and picked up next frame,
     so the large ones can be watched spreading instead of just appearing. */
  function step() {
    let spent = 0;
    dropped = 0;
    for (;;) {
      if (!active) {
        if (queue.length) start(queue.shift(), true);
        else if (hold > 0 || dropped >= (full ? RAIN_FULL : RAIN)) break;
        else { start((rand() * N) | 0, false); dropped++; }
      }
      spent += relax(BUDGET - spent);
      if (sp === 0) finish();
      else break;
      if (spent >= BUDGET) break;
    }
    if (hold > 0) hold--;
    frames++;
  }

  /* ── colour ─────────────────────────────────────────────────────── */

  function hex(name, fallback) {
    const v = getComputedStyle(document.body).getPropertyValue(name).trim();
    const m = /^#([0-9a-f]{6})$/i.exec(v || '');
    const n = m ? parseInt(m[1], 16) : fallback;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  const SHADE = [0, 0.16, 0.36, 0.62];   // how much ink for 0, 1, 2 and 3 grains
  let base = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], accent = [0, 0, 0];

  function buildColours() {
    const paper = hex('--paper-2', 0xE9E3D6);
    const ink   = hex('--ink',     0x17150F);
    accent      = hex('--accent',  0xB4442A);
    base = SHADE.map(t => paper.map((p, k) => p + (ink[k] - p) * t));
  }

  function draw() {
    for (let i = 0; i < N; i++) {
      const b = base[h[i] > 3 ? 3 : h[i]];
      let r = b[0], g = b[1], bl = b[2];
      const q = heat[i];
      if (q > 0.02) {
        const t = q * 0.78;
        r += (accent[0] - r) * t; g += (accent[1] - g) * t; bl += (accent[2] - bl) * t;
      }
      pixels[i] = (255 << 24) | ((bl | 0) << 16) | ((g | 0) << 8) | (r | 0);
    }
    octx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  }

  function cool(k) {
    for (let i = 0; i < N; i++) if (heat[i] > 0) heat[i] *= k;
  }

  /* ── the shelf ──────────────────────────────────────────────────── */

  let bars = [];
  function buildShelf() {
    if (!shelfEl) return;
    const frag = document.createDocumentFragment();
    const labels = document.createDocumentFragment();
    for (let b = 0; b < BINS; b++) {
      const bar = document.createElement('div');
      bar.className = 'shelf__bar';
      const lo = 2 ** b, hi = 2 ** (b + 1) - 1;
      bar.title = b === 0 ? 'Slides of exactly one fall' : `Slides of ${fmt(lo)} to ${fmt(hi)} falls`;
      bar.appendChild(document.createElement('i'));
      frag.appendChild(bar);
      bars.push(bar);
      const lab = document.createElement('span');
      lab.textContent = b % 2 === 0 ? short(lo) : '';
      labels.appendChild(lab);
    }
    shelfEl.innerHTML = '';
    shelfEl.appendChild(frag);
    if (axisEl) { axisEl.innerHTML = ''; axisEl.appendChild(labels); }
  }

  function short(n) {
    if (n >= 1024) return Math.round(n / 1024) + 'k';
    return String(n);
  }
  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }

  function shelf() {
    let max = 0;
    for (let b = 0; b < BINS; b++) if (hist[b] > max) max = hist[b];
    for (let b = 0; b < BINS; b++) {
      const pct = max ? (hist[b] / max) * 100 : 0;
      bars[b].firstChild.style.height = (hist[b] ? Math.max(pct, 1.5) : 0) + '%';
      bars[b].classList.toggle('is-yours', !!yours && yours.counted && yours.bin === b);
    }
    if (readEl) {
      const d = (landed - fell) / N;
      const none = counted ? Math.round(still / counted * 100) : 0;
      readEl.innerHTML =
        `<b>${fmt(landed)}</b> grains landed · <b>${d.toFixed(2)}</b> a square · ` +
        (counted ? `<b>${none}%</b> moved nothing · largest slide <b>${fmt(largest)}</b> falls`
                 : 'the shelf starts counting once as much is leaving as landing');
    }
  }

  function tellYours() {
    if (!yoursEl || !yours) return;
    if (!yours.falls) yoursEl.textContent = 'Your grain: nothing moved.';
    else if (yours.falls === 1) yoursEl.textContent = 'Your grain: one square fell over.';
    else yoursEl.textContent = `Your grain: ${fmt(yours.falls)} falls, across ${fmt(yours.squares)} squares.`;
  }

  function say() {
    if (!statusEl) return;
    if (closed && active && cur > 2000000) statusEl.textContent = 'this one will not stop';
    else if (closed) statusEl.textContent = 'edges closed';
    else statusEl.textContent = full ? 'full: as much leaving as landing' : 'filling';
  }

  function hud() {
    if (!hudEl) return;
    hudEl.textContent = (active && cur > BUDGET)
      ? `one slide, ${fmt(cur)} falls`
      : `${fmt(landed)} grains`;
  }

  /* ── visitors ───────────────────────────────────────────────────── */

  function dropAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(W - 1, Math.max(0, Math.floor((clientX - rect.left) / rect.width * W)));
    const y = Math.min(H - 1, Math.max(0, Math.floor((clientY - rect.top) / rect.height * H)));
    drop(x, y);
  }

  function drop(x, y) {
    if (queue.length < 6) queue.push(y * W + x);
    if (yoursEl) yoursEl.textContent = 'Your grain: falling…';
    if (!running) advance(HOLD);
  }

  /* Same arrangement as Plate IV: a mouse click drops a grain, a finger only
     does when it taps and stays put, so dragging up the plate still scrolls. */
  let touch = null, drift = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') {
      touch = { x: e.clientX, y: e.clientY, at: performance.now() };
      drift = 0;
      return;
    }
    dropAt(e.clientX, e.clientY);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' && touch) drift = Math.max(drift, Math.hypot(e.clientX - touch.x, e.clientY - touch.y));
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch') return;
    if (touch && drift < 12 && performance.now() - touch.at < 600) dropAt(e.clientX, e.clientY);
    touch = null;
  });
  canvas.addEventListener('pointercancel', () => { touch = null; });

  /* ── running ────────────────────────────────────────────────────── */

  let running = false;

  function loop() {
    requestAnimationFrame(loop);
    if (!visible) return;
    step();
    cool(0.84);
    draw();
    if (frames % 8 === 0) { shelf(); hud(); say(); }
  }

  /* Run without animating, for reduced motion and for looking at a given
     moment on purpose. Every frame is still budgeted, so a pile with its
     edges closed cannot hang the page. */
  function advance(n) {
    for (let i = 0; i < n; i++) { step(); if (running) cool(0.84); }
    draw(); shelf(); hud(); say();
  }

  function restart() {
    h.fill(0); heat.fill(0); stamp.fill(0);
    sp = 0; landed = 0; fell = 0; largest = 0; still = 0; counted = 0;
    hist = new Float64Array(BINS);
    active = false; cur = 0; squares = 0; slideId = 0; queue = []; hold = 0;
    blockIn = 0; blockOut = 0; full = false; fullAt = 0; yours = null;
    seed = 20260924 + ((Math.random() * 1e6) | 0);
    if (yoursEl) yoursEl.textContent = '';
    draw(); shelf(); hud(); say();
  }

  function settle() {
    /* Past the point where it fills, which is about thirty four thousand
       grains, and long enough after it for the shelf to mean something; then clear the warmth so the still shows the pile, not the rain. */
    advance(3000);
    heat.fill(0);
    draw();
  }

  /* A slide that was under way while the edges were shut does not go on the
     shelf, even if they open again before it ends: it was a different pile. */
  function setClosed(v) {
    closed = v;
    if (closed) countable = false;
    say();
  }

  window.NoBrief = window.NoBrief || {};
  window.NoBrief.pile = {
    restart, advance, drop,
    close: (v) => { setClosed(!!v); if (closeEl) closeEl.checked = closed; },
    state: () => ({ landed, fell, density: (landed - fell) / N, still, counted, largest,
                    hist: Array.from(hist), full, fullAt, closed, active, cur, frames, yours }),
  };

  buildColours();
  buildShelf();
  restart();

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduce.matches) {
    visible = false;
    const once = new IntersectionObserver((e) => {
      if (!e[0].isIntersecting) return;
      once.disconnect();
      settle();
    }, { rootMargin: '250px' });
    once.observe(canvas);
  } else {
    running = true;
    new IntersectionObserver((e) => { visible = e[0].isIntersecting; }, { threshold: 0.05 }).observe(canvas);
    loop();
  }

  closeEl && closeEl.addEventListener('change', () => { setClosed(closeEl.checked); if (!running) advance(HOLD); });
  restartEl && restartEl.addEventListener('click', () => { restart(); if (!running) settle(); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { buildColours(); draw(); });
})();
