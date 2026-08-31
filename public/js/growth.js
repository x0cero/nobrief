/* Plate I — Differential growth.
   A closed loop of points. Attract to neighbors, repel from everything
   near, subdivide long edges. That is the whole program. */

(function () {
  const canvas = document.getElementById('growth-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const countEl = document.getElementById('growth-count');
  const statusEl = document.getElementById('growth-status');
  const restartEl = document.getElementById('growth-restart');

  const MAX_NODES   = 1700;
  const REST_LEN    = 7;     // desired distance between neighbors
  const SPLIT_LEN   = 11;    // subdivide an edge longer than this
  const REPEL_RAD   = 17;    // how far a point notices other points
  const K_ATTRACT   = 0.22;
  const K_REPEL     = 0.34;
  const K_SMOOTH    = 0.14;
  const JITTER      = 0.06;

  let W = 0, H = 0, dpr = 1;
  let pts = [];
  let running = false;
  let done = false;
  let raf = null;
  let ink = '#17150F';

  function readInk() {
    const s = getComputedStyle(document.body);
    ink = s.getPropertyValue('--ink').trim() || '#17150F';
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(320, Math.round(rect.width));
    H = Math.round(W * 0.66);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function seed() {
    pts = [];
    const n = 26;
    const r = Math.min(W, H) * 0.075;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push({
        x: W / 2 + Math.cos(a) * r + (Math.random() - 0.5) * 1.5,
        y: H / 2 + Math.sin(a) * r + (Math.random() - 0.5) * 1.5,
        vx: 0, vy: 0
      });
    }
    done = false;
    if (statusEl) statusEl.textContent = 'growing';
  }

  /* uniform grid, rebuilt each step; cheaper than it sounds at 1400 points */
  function buildGrid() {
    const cell = REPEL_RAD;
    const cols = Math.ceil(W / cell) + 2;
    const grid = new Map();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const key = ((p.y / cell) | 0) * cols + ((p.x / cell) | 0);
      let bucket = grid.get(key);
      if (!bucket) { bucket = []; grid.set(key, bucket); }
      bucket.push(i);
    }
    return { grid, cell, cols };
  }

  function step() {
    const n = pts.length;
    if (n < 3) return;
    const { grid, cell, cols } = buildGrid();
    const R2 = REPEL_RAD * REPEL_RAD;

    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const prev = pts[(i - 1 + n) % n];
      const next = pts[(i + 1) % n];
      let fx = 0, fy = 0;

      /* 1. pulled toward each neighbor, but only past the rest length */
      for (const q of [prev, next]) {
        const dx = q.x - p.x, dy = q.y - p.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const pull = (d - REST_LEN) / d;
        fx += dx * pull * K_ATTRACT;
        fy += dy * pull * K_ATTRACT;
      }

      /* 2. eased toward the midpoint of its neighbors, so the line stays a line */
      fx += ((prev.x + next.x) * 0.5 - p.x) * K_SMOOTH;
      fy += ((prev.y + next.y) * 0.5 - p.y) * K_SMOOTH;

      /* 3. pushed away from anything else nearby, neighbors included */
      const gx = (p.x / cell) | 0, gy = (p.y / cell) | 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const bucket = grid.get((gy + oy) * cols + (gx + ox));
          if (!bucket) continue;
          for (let k = 0; k < bucket.length; k++) {
            const j = bucket[k];
            if (j === i) continue;
            const q = pts[j];
            const dx = p.x - q.x, dy = p.y - q.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > R2 || d2 === 0) continue;
            const d = Math.sqrt(d2);
            const push = (1 - d / REPEL_RAD) / d;
            fx += dx * push * REPEL_RAD * K_REPEL * 0.1;
            fy += dy * push * REPEL_RAD * K_REPEL * 0.1;
          }
        }
      }

      p.vx = fx + (Math.random() - 0.5) * JITTER;
      p.vy = fy + (Math.random() - 0.5) * JITTER;
    }

    const pad = 6;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      p.x = Math.min(W - pad, Math.max(pad, p.x + p.vx));
      p.y = Math.min(H - pad, Math.max(pad, p.y + p.vy));
    }
  }

  /* The loop reaches equilibrium and stops on its own unless something
     keeps adding material. This is that something: a new point spliced in
     at a random spot every frame. Everything after it is the repulsion
     running out of room. */
  function inject(n) {
    for (let k = 0; k < n && pts.length < MAX_NODES; k++) {
      const i = (Math.random() * pts.length) | 0;
      const p = pts[i], q = pts[(i + 1) % pts.length];
      pts.splice(i + 1, 0, {
        x: (p.x + q.x) / 2 + (Math.random() - 0.5) * 0.4,
        y: (p.y + q.y) / 2 + (Math.random() - 0.5) * 0.4,
        vx: 0, vy: 0
      });
    }
  }

  function subdivide() {
    if (pts.length >= MAX_NODES) return false;
    const out = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      out.push(p);
      if (Math.hypot(q.x - p.x, q.y - p.y) > SPLIT_LEN && out.length + 1 < MAX_NODES) {
        out.push({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, vx: 0, vy: 0 });
      }
    }
    const grew = out.length !== n;
    pts = out;
    return grew;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (countEl) countEl.textContent = pts.length;
  }

  let frame = 0;
  function loop() {
    raf = requestAnimationFrame(loop);
    if (!running || done) return;
    step();
    frame++;
    if (pts.length < MAX_NODES) {
      inject(2);
      if (frame % 2 === 0) subdivide();
    } else if (!done) {
      done = true;
      if (statusEl) statusEl.textContent = 'settled';
      canvas.dispatchEvent(new CustomEvent('growth:settled', { bubbles: true }));
    }
    draw();
  }

  function restart() { resize(); seed(); draw(); canvas.dispatchEvent(new CustomEvent('growth:restarted', { bubbles: true })); }

  /* The drawing normalised by frame width, so a shape kept on a phone and a
     shape kept on a desktop are the same shape. */
  function normalizedPath() {
    const stride = Math.max(1, Math.ceil(pts.length / 880));
    const out = [];
    for (let i = 0; i < pts.length; i += stride) {
      out.push((pts[i].x / W).toFixed(3), (pts[i].y / W).toFixed(3));
    }
    return out.join(',');
  }

  window.NoBrief = window.NoBrief || {};
  window.NoBrief.growth = { normalizedPath, settled: () => done, restart };

  readInk();
  resize();
  seed();
  draw();

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!reduce.matches) {
    /* only burn cycles while the plate is actually on screen */
    new IntersectionObserver((entries) => {
      running = entries[0].isIntersecting;
    }, { threshold: 0.05 }).observe(canvas);
    loop();
  } else {
    /* fast forward to a finished drawing, no animation */
    for (let i = 0; i < 2200 && pts.length < MAX_NODES; i++) { step(); inject(2); if (i % 2 === 0) subdivide(); }
    draw();
    done = true;
    if (statusEl) statusEl.textContent = 'settled';
    canvas.dispatchEvent(new CustomEvent('growth:settled', { bubbles: true }));
  }

  restartEl && restartEl.addEventListener('click', restart);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readInk(); draw(); });

  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(restart, 220);
  });
})();
