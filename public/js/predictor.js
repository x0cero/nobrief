/* Plate II — A language model with one book in it, and the book is this page.
   Counts of "what character followed this run of characters", orders one
   through six, backing off to a shorter run when the longer one is new. */

(function () {
  const seedEl  = document.getElementById('pred-seed');
  if (!seedEl) return;
  const barsEl  = document.getElementById('pred-bars');
  const orderEl = document.getElementById('pred-order');
  const dimEl   = document.getElementById('pred-ctx-dim');
  const hitEl   = document.getElementById('pred-ctx-hit');
  const runEl   = document.getElementById('pred-run');
  const outEl   = document.getElementById('pred-out');
  const tempEl  = document.getElementById('pred-temp');
  const tempOut = document.getElementById('pred-temp-out');

  const MAX_ORDER = 6;
  const BARS = 8;

  /* ── the corpus is whatever prose this page is carrying ── */
  const corpus = Array.from(document.querySelectorAll('[data-corpus]'))
    .map(el => el.innerText || el.textContent || '')
    .join('\n\n')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  /* ── train: one Map per order, context -> {char: count} ── */
  const models = [];
  for (let k = 0; k <= MAX_ORDER; k++) models[k] = new Map();

  (function train() {
    const uni = new Map();
    for (let i = 0; i < corpus.length; i++) {
      const ch = corpus[i];
      uni.set(ch, (uni.get(ch) || 0) + 1);
      for (let k = 1; k <= MAX_ORDER; k++) {
        if (i < k) continue;
        const key = corpus.slice(i - k, i);
        let m = models[k].get(key);
        if (!m) { m = new Map(); models[k].set(key, m); }
        m.set(ch, (m.get(ch) || 0) + 1);
      }
    }
    models[0].set('', uni);
  })();

  /* ── predict: longest context we have actually seen wins ── */
  function predict(context) {
    for (let k = Math.min(MAX_ORDER, context.length); k >= 1; k--) {
      const key = context.slice(-k);
      const m = models[k].get(key);
      if (m) {
        /* A context with only one continuation is not predicting, it is
           reciting the page back. Keep backing off until there is an actual
           choice to show. */
        if (m.size > 1 || k === 1) {
          let total = 0;
          for (const v of m.values()) total += v;
          return { order: k, counts: m, total };
        }
      }
    }
    const uni = models[0].get('');
    let total = 0;
    for (const v of uni.values()) total += v;
    return { order: 0, counts: uni, total };
  }

  function glyph(ch) {
    if (ch === ' ') return '␣';   // open box, for a space
    if (ch === '\n') return '⏎';  // return arrow
    return ch;
  }

  function render() {
    const ctxText = seedEl.value;
    const { order, counts, total } = predict(ctxText);

    orderEl.textContent = order;
    const hit = order ? ctxText.slice(-order) : '';
    const dim = order ? ctxText.slice(0, ctxText.length - order) : ctxText;
    dimEl.textContent = dim.slice(-28).replace(/\n/g, ' ');
    hitEl.textContent = hit.replace(/\n/g, '⏎');

    const top = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, BARS);

    barsEl.innerHTML = '';
    for (const [ch, n] of top) {
      const p = n / total;
      const li = document.createElement('li');
      const g = document.createElement('span');
      g.className = 'glyph';
      g.textContent = glyph(ch);
      const track = document.createElement('span');
      track.className = 'track';
      const fill = document.createElement('span');
      fill.className = 'fill';
      fill.style.width = Math.max(1.5, p * 100) + '%';
      track.appendChild(fill);
      const pct = document.createElement('span');
      pct.className = 'pct';
      pct.textContent = (p * 100).toFixed(1) + '%';
      li.append(g, track, pct);
      barsEl.appendChild(li);
    }
  }

  /* ── generation ── */
  let timer = null;

  function sample(counts, total, temp) {
    const entries = Array.from(counts.entries());
    if (temp <= 0.01) {
      return entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    }
    let sum = 0;
    const weights = entries.map(([, n]) => {
      const w = Math.pow(n / total, 1 / temp);
      sum += w;
      return w;
    });
    let r = Math.random() * sum;
    for (let i = 0; i < entries.length; i++) {
      r -= weights[i];
      if (r <= 0) return entries[i][0];
    }
    return entries[entries.length - 1][0];
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    runEl.textContent = 'Let it write';
  }

  function run() {
    if (timer) { stop(); return; }
    runEl.textContent = 'Stop';
    let text = seedEl.value;
    outEl.textContent = text;
    let written = 0;
    timer = setInterval(() => {
      const { counts, total } = predict(text);
      const ch = sample(counts, total, parseFloat(tempEl.value));
      text += ch;
      outEl.textContent = text;
      if (++written >= 420) stop();
    }, 22);
  }

  seedEl.addEventListener('input', () => { if (timer) stop(); render(); });
  runEl.addEventListener('click', run);
  tempEl.addEventListener('input', () => { tempOut.textContent = parseFloat(tempEl.value).toFixed(2); });

  /* The example it opens with used to be typed into the HTML by hand, which
     went stale the moment I wrote another paragraph. Now the page hunts for
     its own: a place in its own text where the model has the most options and
     the least idea which one is coming. */
  function chooseSeed() {
    const candidates = [];
    for (let attempt = 0; attempt < 500; attempt++) {
      const i = 40 + Math.floor(Math.random() * (corpus.length - 41));
      let ctx = corpus.slice(Math.max(0, i - 30), i);
      const space = ctx.indexOf(' ');
      if (space > 0 && ctx.length - space > 14) ctx = ctx.slice(space + 1);
      if (ctx.includes('\n') || ctx.length < 14) continue;

      const { order, counts, total } = predict(ctx);
      if (order < 4 || counts.size < 6) continue;

      let entropy = 0;
      for (const n of counts.values()) { const p = n / total; entropy -= p * Math.log2(p); }
      candidates.push({ ctx, score: entropy + order * 0.15 });
    }
    if (!candidates.length) return;
    candidates.sort((a, b) => b.score - a.score);
    const pick = candidates[Math.floor(Math.random() * Math.min(8, candidates.length))];
    seedEl.value = pick.ctx;
  }

  tempOut.textContent = parseFloat(tempEl.value).toFixed(2);
  chooseSeed();
  render();
})();
