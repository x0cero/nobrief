/* Pressing a network.

   Plate I keeps a curve, which is easy, because a curve is already a list of
   points. Plate IV has no points in it at all. It is a grid of concentrations
   with a network implied in the bright parts, and the network is the thing
   worth keeping, so it has to be got out of the grid first.

   Three steps: decide which cells count as ink, thin that ink down to lines
   one cell wide, then walk the lines and write down where they go. */

(function () {
  const NB = (window.NoBrief = window.NoBrief || {});

  /* Threshold, chosen against the plate's own brightest structure rather than
     a fixed number, because Lace runs much fainter than Cells and a number
     that suits one erases the other. */
  function inkLevel(trail) {
    const bins = new Int32Array(256);
    for (let i = 0; i < trail.length; i++) {
      let b = (trail[i] * 255) | 0;
      if (b > 255) b = 255; else if (b < 0) b = 0;
      bins[b]++;
    }
    const target = trail.length * 0.01;      // the top one per cent of cells
    let seen = 0, top = 255;
    for (let b = 255; b >= 0; b--) {
      seen += bins[b];
      if (seen >= target) { top = b; break; }
    }
    const level = (top / 255) * 0.32;
    return Math.min(0.55, Math.max(0.08, level));
  }

  /* Zhang-Suen thinning. Peels boundary cells off the ink until what is left
     is one cell wide everywhere and still connected the same way it was. */
  function thin(bin, W, H) {
    const idx = (x, y) => y * W + x;
    const marks = [];
    let changed = true, guard = 0;

    while (changed && guard++ < 40) {
      changed = false;
      for (let sub = 0; sub < 2; sub++) {
        marks.length = 0;
        for (let y = 1; y < H - 1; y++) {
          for (let x = 1; x < W - 1; x++) {
            const i = idx(x, y);
            if (!bin[i]) continue;
            const p2 = bin[i - W], p3 = bin[i - W + 1], p4 = bin[i + 1], p5 = bin[i + W + 1];
            const p6 = bin[i + W], p7 = bin[i + W - 1], p8 = bin[i - 1], p9 = bin[i - W - 1];
            const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
            if (b < 2 || b > 6) continue;
            const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
            let a = 0;
            for (let k = 0; k < 8; k++) if (!seq[k] && seq[k + 1]) a++;
            if (a !== 1) continue;
            if (sub === 0) {
              if (p2 * p4 * p6) continue;
              if (p4 * p6 * p8) continue;
            } else {
              if (p2 * p4 * p8) continue;
              if (p2 * p6 * p8) continue;
            }
            marks.push(i);
          }
        }
        for (let k = 0; k < marks.length; k++) bin[marks[k]] = 0;
        if (marks.length) changed = true;
      }
    }
    return bin;
  }

  const DX = [1, 1, 0, -1, -1, -1, 0, 1];
  const DY = [0, 1, 1, 1, 0, -1, -1, -1];

  /* Counting a cell's neighbours is the wrong way to find the junctions. A line
     running diagonally has cells with three neighbours all over it, because the
     cell before and the cell after are themselves touching. Counting instead the
     number of separate runs of ink around the cell (the crossing number) gets it
     right: one run is a loose end, two is a line passing through, three or more
     is a real fork. On one plate that is the difference between forty eight
     junctions and sixteen hundred, and between three hundred lines and three
     thousand chains two cells long. */
  function classify(bin, W, H) {
    const n = W * H;
    const cross = new Uint8Array(n);
    const nbr = new Uint8Array(n);
    const ring = new Uint8Array(9);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (!bin[i]) continue;
        let bits = 0;
        for (let k = 0; k < 8; k++) {
          const v = bin[i + DY[k] * W + DX[k]];
          ring[k] = v;
          if (v) bits |= 1 << k;
        }
        ring[8] = ring[0];
        let runs = 0;
        for (let k = 0; k < 8; k++) if (!ring[k] && ring[k + 1]) runs++;
        nbr[i] = bits;
        cross[i] = runs;
      }
    }
    return { cross, nbr };
  }

  /* Walk the thinned lines. Every run between two ends or two junctions comes
     out as one chain; anything left over is a loop with no junction on it, so
     it is walked from wherever it is first met. */
  function trace(bin, W, H) {
    const n = W * H;
    const { cross, nbr } = classify(bin, W, H);
    const used = new Uint8Array(n);
    const chains = [];
    const opposite = (k) => (k + 4) & 7;
    const touching = (a, b) =>
      Math.abs((a % W) - (b % W)) <= 1 && Math.abs(((a / W) | 0) - ((b / W) | 0)) <= 1;

    function walk(start, dir0) {
      const cells = [start];
      let prev = start, cur = start, dir = dir0;
      for (let step = 0; step < 20000; step++) {
        const next = cur + DY[dir] * W + DX[dir];
        used[cur] |= 1 << dir;
        used[next] |= 1 << opposite(dir);
        cells.push(next);
        if (cross[next] !== 2 || next === start) break;
        /* At a diagonal, the cell we just came from is often touching one of
           the candidates ahead. That candidate is the same step taken twice, so
           the continuation is whichever one the previous cell cannot reach. */
        let found = -1, fallback = -1;
        for (let k = 0; k < 8; k++) {
          if (!(nbr[next] & (1 << k))) continue;
          if (used[next] & (1 << k)) continue;
          const cand = next + DY[k] * W + DX[k];
          if (cand === cur) continue;
          if (fallback < 0) fallback = k;
          if (touching(cand, cur)) continue;
          found = k; break;
        }
        if (found < 0) found = fallback;
        if (found < 0) break;
        prev = cur; cur = next; dir = found;
      }
      const last = cells[cells.length - 1];
      return { cells, spur: cross[start] === 1 || cross[last] === 1 };
    }

    for (let i = 0; i < n; i++) {
      if (!bin[i] || cross[i] === 2 || cross[i] === 0) continue;
      for (let k = 0; k < 8; k++) {
        if (!(nbr[i] & (1 << k))) continue;
        if (used[i] & (1 << k)) continue;
        chains.push(walk(i, k));
      }
    }
    for (let i = 0; i < n; i++) {
      if (!bin[i] || cross[i] !== 2 || used[i]) continue;
      for (let k = 0; k < 8; k++) {
        if (nbr[i] & (1 << k)) { chains.push(walk(i, k)); break; }
      }
    }
    return chains;
  }

  /* Ramer-Douglas-Peucker. A chain of four hundred cells is four hundred cells
     of storage and about six corners of information. */
  function simplify(pts, eps) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      if (b - a < 2) continue;
      const ax = pts[a][0], ay = pts[a][1], bx = pts[b][0], by = pts[b][1];
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 1e-9;
      let worst = -1, at = -1;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
        if (d > worst) { worst = d; at = i; }
      }
      if (worst > eps) { keep[at] = 1; stack.push([a, at], [at, b]); }
    }
    const out = [];
    for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
    return out;
  }

  /* Two base-64 digits a coordinate, twelve bits each. A loop needed three
     hundred points and could be written out in plain decimals; a network needs
     a couple of thousand and cannot. */
  const A64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const enc = (v) => {
    let n = Math.round(v * 4095);
    if (n < 0) n = 0; else if (n > 4095) n = 4095;
    return A64[n >> 6] + A64[n & 63];
  };

  const MAX_POINTS = 2200;
  const MIN_SPUR = 11;

  function press(snap) {
    const { trail, SW, SH } = snap;
    const level = inkLevel(trail);
    const bin = new Uint8Array(SW * SH);
    for (let i = 0; i < bin.length; i++) bin[i] = trail[i] >= level ? 1 : 0;

    thin(bin, SW, SH);
    const raw = trace(bin, SW, SH);

    const chains = [];
    for (const run of raw) {
      const cells = run.cells;
      /* A line with a loose end is usually thinning debris and gets a length
         test. A line joining two junctions is holding the network together and
         is kept however short it is. */
      if (cells.length < (run.spur ? MIN_SPUR : 3)) continue;
      let sum = 0;
      const pts = new Array(cells.length);
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        sum += trail[c];
        pts[i] = [c % SW, (c / SW) | 0];
      }
      const simple = simplify(pts, 0.8);
      if (simple.length < 2) continue;
      const weight = Math.min(9, Math.max(1, Math.round((sum / cells.length) * 9)));
      chains.push({ pts: simple, weight, run: cells.length });
    }

    /* If it will not all fit, the longest and heaviest lines are the ones the
       plate actually built; the rest is the fine mesh and it goes. */
    chains.sort((a, b) => (b.run * b.weight) - (a.run * a.weight));
    const kept = [];
    let total = 0;
    for (const c of chains) {
      if (total + c.pts.length > MAX_POINTS) continue;
      total += c.pts.length;
      kept.push(c);
    }
    /* Twelve is where the server stops believing it, and it is also about where
       a person would stop calling it a network. */
    if (kept.length < 12) return null;

    const parts = kept.map(c => {
      let s = String(c.weight) + '|';
      for (const [x, y] of c.pts) s += enc(x / SW) + enc(y / SW);
      return s;
    });
    return { data: parts.join(';'), chains: kept.length, points: total, level };
  }

  NB.press = { press };
})();
