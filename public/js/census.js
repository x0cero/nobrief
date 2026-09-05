/* The census.

   The closing note on this page says the work was choosing which rule to sit in
   front of. This is that choice, made by measurement instead of by me.

   Every one of the 256 rules is run twice from the same first row, the two runs
   differing by a single cell, and what is recorded is how much of the future
   that one cell changed. It is the cheapest possible question to ask of a rule
   and it sorts them almost perfectly: a rule that forgets the cell immediately
   is doing nothing, a rule that lets it wreck everything is making noise, and
   the handful in between are the ones worth watching.

   Two hundred and twenty one of the two hundred and fifty six do nothing. */

(function () {
  const W = 201;        // cells, wrapping
  const T = 160;        // steps
  const TAIL = 24;      // the last steps, where the measurement is taken
  const SEED = 20260904;

  /* One first row, the same one for every rule, so the census is a comparison
     and not a collection of anecdotes. Everybody who loads this page gets the
     same numbers. */
  function firstRow() {
    let a = SEED;
    const row = new Uint8Array(W);
    for (let i = 0; i < W; i++) {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      row[i] = (((t ^ t >>> 14) >>> 0) / 4294967296) < 0.5 ? 1 : 0;
    }
    return row;
  }

  function step(src, dst, rule) {
    for (let i = 0; i < W; i++) {
      const l = src[(i - 1 + W) % W], c = src[i], r = src[(i + 1) % W];
      dst[i] = (rule >> ((l << 2) | (c << 1) | r)) & 1;
    }
  }

  function assay(rule, start) {
    let a = start.slice(), b = start.slice();
    b[W >> 1] ^= 1;
    let na = new Uint8Array(W), nb = new Uint8Array(W);
    let damage = 0, activity = 0, n = 0;
    for (let t = 0; t < T; t++) {
      step(a, na, rule); step(b, nb, rule);
      let ta = a; a = na; na = ta;
      let tb = b; b = nb; nb = tb;
      if (t >= T - TAIL) {
        let d = 0, ch = 0;
        for (let i = 0; i < W; i++) {
          if (a[i] !== b[i]) d++;
          if (a[i] !== na[i]) ch++;      // na is now the row before this one
        }
        damage += d / W; activity += ch / W; n++;
      }
    }
    return { rule, damage: damage / n, activity: activity / n };
  }

  const start = firstRow();
  const all = [];
  for (let r = 0; r < 256; r++) all.push(assay(r, start));

  const frozen = (m) => m.activity <= 0.005;
  const worth  = (m) => m.activity > 0.05 && m.damage >= 0.05 && m.damage <= 0.30;
  const band = all.filter(worth);

  /* What the plate opens on. Not rule 30, which is the one everybody opens on,
     and not a rule I picked either. */
  function pick() {
    const pool = band.length ? band : all;
    return pool[(Math.random() * pool.length) | 0].rule;
  }

  /* ── the map ─────────────────────────────────────────────────────── */

  const grid = document.getElementById('census-grid');
  const read = document.getElementById('census-read');
  let cells = [];

  function describe(m) {
    if (frozen(m)) return `Rule ${m.rule}: nothing moves`;
    const pct = Math.round(m.damage * 100);
    if (m.damage < 0.005) return `Rule ${m.rule}: the changed cell stays where it is`;
    return `Rule ${m.rule}: one changed cell changes ${pct}% of the picture`;
  }

  function paint(el, m) {
    if (frozen(m)) {
      el.style.background = 'transparent';
    } else if (worth(m)) {
      el.style.background = 'var(--accent)';
    } else {
      const pct = Math.round(20 + m.damage * 80);
      el.style.background = `color-mix(in srgb, var(--ink) ${pct}%, transparent)`;
    }
  }

  function build() {
    if (!grid || cells.length) return;
    const frag = document.createDocumentFragment();
    for (const m of all) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'census__cell';
      b.dataset.rule = m.rule;
      b.setAttribute('aria-label', describe(m));
      b.title = describe(m);
      paint(b, m);
      b.addEventListener('click', () => {
        const api = window.NoBrief && window.NoBrief.rule;
        if (api) api.set(m.rule);
      });
      b.addEventListener('pointerenter', () => { if (read) read.textContent = describe(m); });
      frag.appendChild(b);
      cells.push(b);
    }
    grid.innerHTML = '';
    grid.appendChild(frag);
    grid.addEventListener('pointerleave', () => { if (read) read.textContent = current(); });
    mark(window.NoBrief && window.NoBrief.rule ? window.NoBrief.rule.get() : -1);
  }

  let marked = -1;
  function current() {
    const m = all[marked];
    return m ? describe(m) : '';
  }

  function mark(rule) {
    marked = rule;
    for (const el of cells) el.setAttribute('aria-pressed', String(+el.dataset.rule === rule));
    if (read) read.textContent = current();
  }

  window.NoBrief = window.NoBrief || {};
  window.NoBrief.census = { all, band, pick, mark, draw: build, describe: (r) => describe(all[r]) };

  /* Two hundred and fifty six buttons is nothing next to what the rest of this
     page is doing, so the map is built at once rather than waiting to be
     scrolled to. The measuring above is the expensive part and it has already
     happened by the time this line runs. */
  build();
})();
