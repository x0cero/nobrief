/* Plate VI: Recall.
   A thousand and twenty four cells, every one connected to every other one.
   Teaching it a picture means strengthening the connection between every
   pair of cells that agree in that picture and weakening it between every
   pair that disagree. Nothing else is stored. There is no list of pictures
   anywhere in here, only the connections, and all the pictures share them.

   Asking it for a picture means handing it a damaged copy and letting every
   cell, one at a time, take whichever side its connections vote for, until
   nobody wants to change. If the damage was not too bad, what is left is the
   picture it was taught. Or it was, until it was taught a few too many. */

(function () {
  const canvas = document.getElementById('recall-canvas');
  if (!canvas) return;

  const S = 32, N = S * S;       // fixed, so the numbers are the same for everybody
  const SCALE = 12;
  const FADE = 0.95;             // what is left of every connection each time something new is taught
  const DAMAGE = 0.2;            // share of cells flipped in a cue
  const HELD = 0.95;             // agreement with the original that counts as remembered
  const MAX_SWEEPS = 12;
  const MAX_TAUGHT = 80;
  const PER_FRAME = 32;          // cells reconsidered per frame while it is being watched
  const IDLE = 150;              // frames of nothing before it goes and remembers something by itself

  const chartEl  = document.getElementById('recall-chart');
  const stripEl  = document.getElementById('recall-strip');
  const hudEl    = document.getElementById('recall-hud');
  const statusEl = document.getElementById('recall-status');
  const readEl   = document.getElementById('recall-read');
  const fadeEl   = document.getElementById('recall-fade');
  const oneEl    = document.getElementById('recall-one');
  const fiveEl   = document.getElementById('recall-five');
  const wipeEl   = document.getElementById('recall-wipe');

  canvas.width = S * SCALE;
  canvas.height = S * SCALE;
  const ctx = canvas.getContext('2d', { alpha: false });
  const off = document.createElement('canvas');
  off.width = S; off.height = S;
  const octx = off.getContext('2d');
  const image = octx.createImageData(S, S);
  const pixels = new Uint32Array(image.data.buffer);

  const Wt = new Float32Array(N * N);
  const state = new Int8Array(N);
  const heat = new Float32Array(N);
  let fade = false;
  let memories = [];             // { p, n, held, overlap, el, cv }
  let best = 0;
  const traces = { keep: [0], fade: [0] };

  function rng(s) {
    return function () {
      s |= 0; s = s + 0x6D2B79F5 | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* ── the pictures ───────────────────────────────────────────────── */

  /* Each picture is smooth noise cut in half at its median, so exactly half
     the cells are ink. Memory number n is the same picture for everybody. */
  function picture(n) {
    const rand = rng(20260928 + n * 7919);
    const g1 = 11, g2 = 19;
    const a = Float32Array.from({ length: g1 * g1 }, () => rand() * 2 - 1);
    const b = Float32Array.from({ length: g2 * g2 }, () => rand() * 2 - 1);
    const f = new Float32Array(N);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      f[y * S + x] = sample(a, g1, x / 4, y / 4) + 0.5 * sample(b, g2, x / 2, y / 2);
    }
    const med = Float32Array.from(f).sort()[N >> 1];
    return Int8Array.from(f, v => v > med ? 1 : -1);
  }

  function sample(arr, gw, x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const p = arr[y0 * gw + x0], q = arr[y0 * gw + x0 + 1];
    const r = arr[(y0 + 1) * gw + x0], s = arr[(y0 + 1) * gw + x0 + 1];
    return p + (q - p) * sx + (r - p) * sy + (p - q - r + s) * sx * sy;
  }

  /* ── the rule ───────────────────────────────────────────────────── */

  /* Hebb: cells that agree in the picture pull each other the same way.
     With fading on, every existing connection is weakened a little first,
     so whatever was taught longest ago is always the faintest thing in it. */
  function learn(p) {
    if (fade) for (let k = 0; k < Wt.length; k++) Wt[k] *= FADE;
    for (let i = 0; i < N; i++) {
      const pi = p[i] / N, row = i * N;
      for (let j = 0; j < N; j++) Wt[row + j] += pi * p[j];
      Wt[row + i] = 0;
    }
  }

  function field(s, i) {
    const row = i * N;
    let h = 0;
    for (let j = 0; j < N; j++) h += Wt[row + j] * s[j];
    return h;
  }

  function overlap(s, p) {
    let m = 0;
    for (let i = 0; i < N; i++) m += s[i] * p[i];
    return m / N;
  }

  function damage(p, rand) {
    const s = Int8Array.from(p);
    for (let i = 0; i < N; i++) if (rand() < DAMAGE) s[i] = -s[i];
    return s;
  }

  function shuffle(order, rand) {
    for (let k = N - 1; k > 0; k--) {
      const j = (rand() * (k + 1)) | 0;
      const t = order[k]; order[k] = order[j]; order[j] = t;
    }
  }

  /* Let every cell take the side its connections vote for, in a random
     order, until a full pass changes nothing. */
  function settle(s, rand) {
    const order = Int32Array.from({ length: N }, (_, i) => i);
    for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
      shuffle(order, rand);
      let changed = 0;
      for (let k = 0; k < N; k++) {
        const i = order[k];
        const v = field(s, i) >= 0 ? 1 : -1;
        if (v !== s[i]) { s[i] = v; changed++; }
      }
      if (!changed) break;
    }
    return s;
  }

  /* Whether memory k is still in there: the same damaged cue every time,
     so the answer only changes when the connections do. */
  function check(k) {
    const m = memories[k];
    const rand = rng(777 + m.n * 131);
    const s = settle(damage(m.p, rand), rand);
    m.overlap = overlap(s, m.p);
    m.held = m.overlap >= HELD;
  }

  /* ── checking everything, a little at a time ────────────────────── */

  let queue = [];
  function recheck() {
    queue = memories.map((_, k) => k);
    for (const m of memories) { m.held = null; }
    strip();
  }

  function work() {
    if (!queue.length) return false;
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < 6) check(queue.shift());
    if (!queue.length) finished();
    strip();
    return true;
  }

  function finished() {
    const held = memories.filter(m => m.held).length;
    if (held > best) best = held;
    const t = traces[fade ? 'fade' : 'keep'];
    t[memories.length] = held;
    chart(); read(); say();
  }

  function flush() { while (queue.length) check(queue.shift()); finished(); strip(); }

  /* ── teaching ───────────────────────────────────────────────────── */

  function teach(count) {
    for (let c = 0; c < count && memories.length < MAX_TAUGHT; c++) {
      const n = memories.length + 1;
      const p = picture(n);
      learn(p);
      memories.push({ p, n, held: null, overlap: 0, el: null, cv: null });
      addThumb(memories[memories.length - 1]);
    }
    const last = memories[memories.length - 1];
    if (last) { state.set(last.p); heat.fill(0); showing = last; watching = null; hudText(`memory ${last.n}, as taught`); }
    idle = 0;
    recheck();
    if (!running) flush();
    draw(); read(); say();
  }

  function wipe() {
    Wt.fill(0);
    memories = [];
    best = 0;
    queue = [];
    watching = null; showing = null;
    traces[fade ? 'fade' : 'keep'] = [0];
    state.fill(-1); heat.fill(0);
    if (stripEl) stripEl.innerHTML = '';
    hudText('nothing taught');
    draw(); chart(); read(); say();
  }

  /* ── watching it remember ───────────────────────────────────────── */

  let watching = null;           // { order, k, changed, sweeps, target, rand }
  let showing = null;
  let idle = 0;

  function cue(m) {
    const rand = rng((Math.random() * 1e9) | 0);
    state.set(damage(m.p, rand));
    heat.fill(0);
    showing = m;
    watching = { order: Int32Array.from({ length: N }, (_, i) => i), k: N, changed: 0, sweeps: 0, rand };
    hudText(`memory ${m.n}, ${Math.round(DAMAGE * 100)}% damaged`);
    say('remembering');
    idle = 0;
    strip();
    if (!running) { while (watching) tick(N); draw(); }
  }

  /* A drawing of the visitor's own, settled from wherever they left it. */
  function cueFromState() {
    showing = null;
    watching = { order: Int32Array.from({ length: N }, (_, i) => i), k: N, changed: 0, sweeps: 0, rand: rng((Math.random() * 1e9) | 0) };
    hudText('your drawing');
    say('remembering');
    idle = 0;
    strip();
    if (!running) { while (watching) tick(N); draw(); }
  }

  function tick(budget) {
    const w = watching;
    for (let b = 0; b < budget; b++) {
      if (w.k >= N) {
        if (w.sweeps > 0 && w.changed === 0 || w.sweeps >= MAX_SWEEPS) { conclude(); return; }
        shuffle(w.order, w.rand);
        w.k = 0; w.changed = 0; w.sweeps++;
      }
      const i = w.order[w.k++];
      const v = field(state, i) >= 0 ? 1 : -1;
      if (v !== state[i]) { state[i] = v; heat[i] = 1; w.changed++; }
    }
  }

  /* What did it land on? The memory it was asked for, a different one, the
     photographic negative of one (which it has also learned, without being
     asked, because every connection is symmetric), or none of them. */
  function conclude() {
    watching = null;
    let bestM = null, bestO = 0;
    for (const m of memories) {
      const o = overlap(state, m.p);
      if (Math.abs(o) > Math.abs(bestO)) { bestO = o; bestM = m; }
    }
    const pct = (o) => Math.round(Math.abs(o) * 100) + '%';
    if (!bestM || Math.abs(bestO) < 0.8) hudText('settled on something it was never taught');
    else if (bestO < 0) hudText(`settled on memory ${bestM.n} inside out`);
    else if (showing && bestM !== showing) hudText(`asked for ${showing.n}, gave back ${bestM.n}`);
    else hudText(`memory ${bestM.n}, ${pct(bestO)} right`);
    say();
    strip();
  }

  /* ── drawing ────────────────────────────────────────────────────── */

  function hex(name, fallback) {
    const v = getComputedStyle(document.body).getPropertyValue(name).trim();
    const m = /^#([0-9a-f]{6})$/i.exec(v || '');
    const n = m ? parseInt(m[1], 16) : fallback;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);

  let paper, inkOn, accent, colInk, colSoft, colFaint, colRule;
  function buildColours() {
    paper   = hex('--paper-2', 0xE9E3D6);
    colInk  = hex('--ink', 0x17150F);
    accent  = hex('--accent', 0xB4442A);
    colSoft = hex('--ink-soft', 0x5D584A);
    colFaint = hex('--ink-faint', 0x8C8676);
    colRule = hex('--rule', 0xCBC3B1);
    inkOn   = mix(paper, colInk, 0.72);
  }

  function paint(px, s, hot) {
    for (let i = 0; i < N; i++) {
      let c = s[i] > 0 ? inkOn : paper;
      if (hot && hot[i] > 0.03) c = mix(c, accent, hot[i] * 0.85);
      px[i] = (255 << 24) | ((c[2] | 0) << 16) | ((c[1] | 0) << 8) | (c[0] | 0);
    }
  }

  function draw() {
    paint(pixels, state, heat);
    octx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  }

  function hudText(t) { if (hudEl) hudEl.textContent = t; }

  function say(t) {
    if (!statusEl) return;
    if (t) { statusEl.textContent = t; return; }
    if (queue.length) statusEl.textContent = 'checking what it still has';
    else statusEl.textContent = fade ? 'letting the oldest fade' : 'keeping everything';
  }

  function read() {
    if (!readEl) return;
    const done = !queue.length;
    const held = memories.filter(m => m.held).length;
    let t = `<b>${memories.length}</b> taught · ` + (done ? `<b>${held}</b> still there` : 'checking…');
    if (memories.length) t += ` · most it has ever held at once <b>${best}</b>`;
    if (fade && done && held) {
      const oldest = memories.find(m => m.held);
      t += ` · oldest it still has: <b>${oldest.n}</b>`;
    }
    if (memories.length >= MAX_TAUGHT) t += ' · that is as many as this plate teaches';
    readEl.innerHTML = t;
  }

  /* ── the strip of everything taught ─────────────────────────────── */

  const thumbPx = new Uint32Array(N);
  function addThumb(m) {
    if (!stripEl) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mem';
    b.title = `Memory ${m.n}: give it a damaged copy and see what comes back`;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const lab = document.createElement('span');
    lab.textContent = m.n;
    b.append(cv, lab);
    b.addEventListener('click', () => cue(m));
    stripEl.appendChild(b);
    m.el = b; m.cv = cv;
    drawThumb(m);
  }

  function drawThumb(m) {
    const c = m.cv.getContext('2d');
    const img = c.createImageData(S, S);
    const px = new Uint32Array(img.data.buffer);
    paint(thumbPx, m.p, null);
    px.set(thumbPx);
    c.putImageData(img, 0, 0);
  }

  function strip() {
    for (const m of memories) {
      if (!m.el) continue;
      m.el.classList.toggle('is-lost', m.held === false);
      m.el.classList.toggle('is-checking', m.held === null);
      m.el.setAttribute('aria-pressed', showing === m ? 'true' : 'false');
      m.el.setAttribute('aria-label', `Memory ${m.n}, ${m.held === null ? 'being checked' : m.held ? 'still there' : 'gone'}`);
    }
  }

  /* ── the chart: held against taught ─────────────────────────────── */

  const cctx = chartEl ? chartEl.getContext('2d') : null;
  let cw = 0;
  function sizeChart() {
    if (!chartEl) return false;
    const w = Math.round(chartEl.clientWidth);
    if (!w || w === cw) return false;
    cw = w;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    chartEl.width = w * dpr;
    chartEl.height = Math.round(w * 0.78) * dpr;
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  function chart() {
    if (!cctx) return;
    sizeChart();
    const w = cw, h = Math.round(cw * 0.78);
    const L = 30, R = 10, T = 14, B = 26;
    const X = (v) => L + (v / MAX_TAUGHT) * (w - L - R);
    const Y = (v) => T + (1 - v / 30) * (h - T - B);
    cctx.fillStyle = css(paper);
    cctx.fillRect(0, 0, w, h);
    cctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
    cctx.textBaseline = 'middle';

    cctx.strokeStyle = css(colRule); cctx.lineWidth = 1;
    cctx.fillStyle = css(colFaint);
    for (let v = 0; v <= 30; v += 10) {
      cctx.beginPath(); cctx.moveTo(L, Y(v) + .5); cctx.lineTo(w - R, Y(v) + .5); cctx.stroke();
      cctx.textAlign = 'right'; cctx.fillText(v, L - 6, Y(v));
    }
    cctx.textAlign = 'center';
    for (let v = 0; v < MAX_TAUGHT - 20; v += 20) cctx.fillText(v, X(v), h - B + 13);
    cctx.textAlign = 'right';
    cctx.fillText(MAX_TAUGHT + ' taught', w - R, h - B + 13);
    cctx.textAlign = 'left';
    cctx.fillText('still there', L + 4, T - 4);

    /* everything taught is still there: the line nothing can be above */
    cctx.setLineDash([2, 4]);
    cctx.strokeStyle = css(colFaint);
    cctx.beginPath(); cctx.moveTo(X(0), Y(0)); cctx.lineTo(X(30), Y(30)); cctx.stroke();
    cctx.setLineDash([]);

    line(traces.keep, css(colSoft), X, Y, !fade);
    line(traces.fade, css(accent), X, Y, fade);
  }

  function line(t, colour, X, Y, current) {
    let started = false;
    cctx.strokeStyle = colour;
    cctx.lineWidth = current ? 2 : 1.25;
    cctx.globalAlpha = current ? 1 : 0.55;
    cctx.beginPath();
    for (let i = 0; i < t.length; i++) {
      if (t[i] === undefined) continue;
      if (!started) { cctx.moveTo(X(i), Y(t[i])); started = true; }
      else cctx.lineTo(X(i), Y(t[i]));
    }
    if (started) cctx.stroke();
    cctx.globalAlpha = 1;
  }

  /* ── visitors draw on it ────────────────────────────────────────── */

  let pen = null, penIdle = -1;
  function cellAt(e) {
    const r = canvas.getBoundingClientRect();
    const x = Math.min(S - 1, Math.max(0, Math.floor((e.clientX - r.left) / r.width * S)));
    const y = Math.min(S - 1, Math.max(0, Math.floor((e.clientY - r.top) / r.height * S)));
    return y * S + x;
  }
  function dab(i, v) {
    const x = i % S, y = (i - x) / S;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue;
      state[yy * S + xx] = v;
      heat[yy * S + xx] = 0;
    }
  }
  function startPen(e) {
    watching = null;
    const i = cellAt(e);
    pen = { v: -state[i] };
    dab(i, pen.v);
    hudText('drawing');
    say('let go and it will decide');
    penIdle = -1;
    draw();
  }

  let touch = null, drift = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') { touch = { x: e.clientX, y: e.clientY, at: performance.now() }; drift = 0; return; }
    startPen(e);
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') {
      if (touch) drift = Math.max(drift, Math.hypot(e.clientX - touch.x, e.clientY - touch.y));
      return;
    }
    if (!pen) return;
    dab(cellAt(e), pen.v);
    draw();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') {
      if (touch && drift < 12 && performance.now() - touch.at < 600) { startPen(e); pen = null; penIdle = 40; }
      touch = null;
      return;
    }
    if (pen) { pen = null; penIdle = 30; }
  });
  canvas.addEventListener('pointercancel', () => { touch = null; pen = null; });

  /* ── running ────────────────────────────────────────────────────── */

  let running = false, visible = true;

  function loop() {
    requestAnimationFrame(loop);
    if (!visible) return;
    const busy = work();
    if (penIdle > 0 && --penIdle === 0) { penIdle = -1; if (memories.length) cueFromState(); else say(); }
    if (watching) tick(PER_FRAME);
    else if (!pen && penIdle < 0 && !busy && memories.length && ++idle > IDLE) {
      cue(memories[(Math.random() * memories.length) | 0]);
    }
    let hot = false;
    for (let i = 0; i < N; i++) if (heat[i] > 0) { heat[i] *= 0.9; hot = true; }
    if (watching || hot || pen) draw();
  }

  function setFade(v) {
    fade = !!v;
    if (fadeEl) fadeEl.checked = fade;
    wipe();
    teach(5);
  }

  window.NoBrief = window.NoBrief || {};
  window.NoBrief.recall = {
    teach, wipe, cue: (n) => memories[n - 1] && cue(memories[n - 1]),
    fade: setFade, flush,
    /* for looking at it without animation: n frames of remembering, synchronously */
    advance: (n) => { for (let i = 0; i < n && (watching || queue.length); i++) { work(); if (watching) tick(PER_FRAME); } draw(); return hudEl && hudEl.textContent; },
    draw: (fn) => { watching = null; fn(state); draw(); if (memories.length) cueFromState(); },
    state: () => ({
      fade, taught: memories.length, best,
      held: memories.filter(m => m.held).map(m => m.n),
      lost: memories.filter(m => m.held === false).map(m => m.n),
      pending: queue.length, traces: JSON.parse(JSON.stringify(traces)),
    }),
  };

  buildColours();
  wipe();
  teach(5);

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduce.matches) {
    flush();
  } else {
    running = true;
    new IntersectionObserver((e) => { visible = e[0].isIntersecting; }, { threshold: 0.05 }).observe(canvas);
    loop();
  }

  oneEl && oneEl.addEventListener('click', () => teach(1));
  fiveEl && fiveEl.addEventListener('click', () => teach(5));
  wipeEl && wipeEl.addEventListener('click', () => { wipe(); teach(5); });
  fadeEl && fadeEl.addEventListener('change', () => setFade(fadeEl.checked));
  window.addEventListener('resize', () => { if (sizeChart()) chart(); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    buildColours(); draw(); chart(); for (const m of memories) drawThumb(m);
  });
})();
