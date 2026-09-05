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

  const tidy = (t) => t
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  /* ── the corpus is whatever prose this page is carrying ── */
  const corpus = tidy(Array.from(document.querySelectorAll('[data-corpus]'))
    .map(el => el.innerText || el.textContent || '')
    .join('\n\n'));

  /* The newest note in the log, held back from the second model below, so that
     there is one passage on this page it has genuinely never read. */
  const newestEntry = document.querySelector('.log .entry');
  const held = newestEntry ? tidy(newestEntry.innerText || newestEntry.textContent || '') : '';
  const heldAt = held ? corpus.indexOf(held) : -1;
  const seenOnly = heldAt >= 0
    ? corpus.slice(0, heldAt) + corpus.slice(heldAt + held.length)
    : corpus;

  /* ── train: one Map per order, context -> {char: count} ── */
  function train(text) {
    const ms = [];
    for (let k = 0; k <= MAX_ORDER; k++) ms[k] = new Map();
    const uni = new Map();
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      uni.set(ch, (uni.get(ch) || 0) + 1);
      for (let k = 1; k <= MAX_ORDER; k++) {
        if (i < k) continue;
        const key = text.slice(i - k, i);
        let m = ms[k].get(key);
        if (!m) { m = new Map(); ms[k].set(key, m); }
        m.set(ch, (m.get(ch) || 0) + 1);
      }
    }
    ms[0].set('', uni);
    return ms;
  }

  const models = train(corpus);

  /* ── predict: longest context we have actually seen wins ── */
  function predict(context, from) {
    const ms = from || models;
    for (let k = Math.min(MAX_ORDER, context.length); k >= 1; k--) {
      const key = context.slice(-k);
      const m = ms[k].get(key);
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
    const uni = ms[0].get('');
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

  /* ──────────────────  what this page costs it  ──────────────────

     Everything above is the model reading text it has already memorised, which
     flatters it enormously. This is the honest version: a second model trained
     on this page with the newest note in the log cut out of it, asked to pay
     for that note a character at a time.

     Scoring needs a real probability rather than the display rule above, which
     backs off until it finds something interesting to draw. Every order that
     has seen the context gets a vote, longer contexts weighing more, and the
     letter frequencies of the whole page vote last with one imaginary count
     added to every letter, so nothing is ever infinitely surprising. */

  /* Built the first time it is needed rather than at load: this page's corpus
     grows every time I write in the log, and a second training pass is the one
     thing here that gets slower the more I write. */
  let heldModels = null;
  const heldOut = () => (heldModels || (heldModels = heldAt >= 0 ? train(seenOnly) : models));

  function bits(context, ch, ms) {
    const uni = ms[0].get('');
    let uniTotal = 0;
    for (const v of uni.values()) uniTotal += v;
    const V = uni.size + 1;
    let p = ((uni.get(ch) || 0) + 1) / (uniTotal + V);
    let weight = 1;

    for (let k = 1; k <= Math.min(MAX_ORDER, context.length); k++) {
      const m = ms[k].get(context.slice(-k));
      if (!m) continue;
      let total = 0;
      for (const v of m.values()) total += v;
      const w = Math.pow(4, k);
      p += w * ((m.get(ch) || 0) / total);
      weight += w;
    }
    const prob = p / weight;
    return -Math.log2(Math.max(prob, 1e-9));
  }

  function costOf(text, ms, prefix) {
    let sum = 0;
    for (let i = 0; i < text.length; i++) {
      const ctx = i >= MAX_ORDER ? text.slice(i - MAX_ORDER, i) : (prefix + text.slice(0, i)).slice(-MAX_ORDER);
      sum += bits(ctx, text[i], ms);
    }
    return sum / text.length;
  }

  function drawCost() {
    const readEl = document.getElementById('cost-read');
    const passEl = document.getElementById('cost-passage');
    if (!readEl || !passEl || heldAt < 0) return;

    /* A stretch of the page it has read, for comparison, taken from the middle
       of the prose rather than anywhere clever. */
    const seenSample = seenOnly.slice(2000, 2000 + Math.min(4000, held.length * 3));
    const ms = heldOut();
    const seenBits = costOf(seenSample, ms, seenOnly.slice(1994, 2000));
    const heldBits = costOf(held, ms, '\n\n');

    readEl.innerHTML =
      `<b>${seenBits.toFixed(2)}</b> bits a character on writing it has read, ` +
      `<b>${heldBits.toFixed(2)}</b> on the note it has not.`;

    /* The passage, word by word, coloured by what each word cost. The whole
       note is what the number above is measured on; this prints the opening of
       it, because four hundred words of glowing text is a wall rather than a
       point. */
    passEl.innerHTML = '';
    /* The measurement is taken on the whole note, dateline and title included,
       because that is what is in the corpus. The printing starts at the first
       sentence, because a dateline butted against a title reads as a mistake. */
    const firstP = newestEntry && newestEntry.querySelector('p');
    const opener = firstP ? tidy(firstP.textContent || '').slice(0, 24) : '';
    const from = opener ? Math.max(0, held.indexOf(opener)) : 0;
    const words = held.slice(from).split(/(\s+)/);
    let at = from, shown = 0;
    for (const w of words) {
      if (!w) continue;
      if (shown >= 150) { passEl.appendChild(document.createTextNode(' …')); break; }
      if (/^\s+$/.test(w)) { passEl.appendChild(document.createTextNode(' ')); at += w.length; continue; }
      let sum = 0;
      for (let i = 0; i < w.length; i++) {
        const j = at + i;
        const ctx = held.slice(Math.max(0, j - MAX_ORDER), j);
        sum += bits(ctx, held[j], ms);
      }
      const b = sum / w.length;
      /* The middle of this page costs it about two and a half bits a character,
         so a ramp starting below that paints almost every word red and says
         nothing. It starts above the middle instead. */
      const t = Math.max(0, Math.min(1, (b - 1.6) / 5));
      const span = document.createElement('span');
      span.className = 'cost__word';
      span.style.color = `color-mix(in srgb, var(--accent) ${Math.round(t * 100)}%, var(--ink-soft))`;
      span.title = b.toFixed(1) + ' bits a character';
      span.textContent = w;
      passEl.appendChild(span);
      at += w.length;
      shown++;
    }
  }

  /* Two trainings and a scoring pass is the most expensive thing on this page,
     so it waits until the plate is somewhere near the screen. */
  const costEl = document.getElementById('cost-passage');
  if (costEl) {
    new IntersectionObserver((e, o) => {
      if (!e[0].isIntersecting) return;
      o.disconnect();
      setTimeout(drawCost, 0);
    }, { rootMargin: '600px' }).observe(costEl);
  }

  window.NoBrief = window.NoBrief || {};
  window.NoBrief.predictor = {
    cost: drawCost,
    corpus: () => corpus.length,
    held: () => held.length,
    bits: (ctx, ch) => bits(ctx, ch, heldOut()),
    heldText: () => held,
  };

  tempOut.textContent = parseFloat(tempEl.value).toFixed(2);
  chooseSeed();
  render();
})();
