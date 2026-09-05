/* Plate III — Elementary cellular automaton.
   One row of cells. Each cell looks at itself and its two neighbors,
   which is eight possible situations, and a number from 0 to 255 says
   what happens in each of them. */

(function () {
  const canvas = document.getElementById('ca-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const ruleInput = document.getElementById('ca-rule');
  const hud = document.getElementById('ca-hud');
  const randomBox = document.getElementById('ca-random');
  const diffBox = document.getElementById('ca-diff');
  const chips = Array.from(document.querySelectorAll('.chip[data-rule]'));

  const CELL = 3;
  let W = 0, H = 0, dpr = 1, cols = 0, rows = 0;
  let rule = 30;
  let cells = null;
  let twin = null;          // the same run with one cell changed
  let row = 0;
  let raf = null;
  let visible = true;
  let ink = '#17150F';

  let accent = '#B4442A', accentDim = '#D8A492';
  function readInk() {
    const st = getComputedStyle(document.body);
    ink = st.getPropertyValue('--ink').trim() || '#17150F';
    accent = st.getPropertyValue('--accent').trim() || '#B4442A';
    accentDim = st.getPropertyValue('--accent-dim').trim() || '#D8A492';
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(320, Math.round(rect.width));
    H = Math.round(W * 0.52);
    cols = Math.floor(W / CELL);
    rows = Math.floor(H / CELL);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function start() {
    resize();
    ctx.clearRect(0, 0, W, H);
    cells = new Uint8Array(cols);
    if (randomBox && randomBox.checked) {
      for (let i = 0; i < cols; i++) cells[i] = Math.random() < 0.5 ? 1 : 0;
    } else {
      cells[cols >> 1] = 1;
    }
    /* The same run again with one cell different, so the plate can show what
       that one cell costs. Flipping the middle of a single seed row would just
       switch the run off, so in that case the changed cell is put beside it. */
    twin = cells.slice();
    const flip = (randomBox && randomBox.checked) ? (cols >> 1) : ((cols >> 1) + 9) % cols;
    twin[flip] ^= 1;
    row = 0;
    drawRow();
  }

  function drawRow() {
    const y = row * CELL;
    const showDiff = diffBox ? diffBox.checked : false;
    ctx.fillStyle = ink;
    for (let i = 0; i < cols; i++) {
      if (cells[i]) ctx.fillRect(i * CELL, y, CELL, CELL);
    }
    if (!showDiff) return;

    /* Two kinds of disagreement, drawn differently on purpose. Full red is a
       cell that is part of this picture and would not be part of the other one.
       Pale red is the opposite: nothing is here, but something would have been.

       Marking both the same way buries the pattern under a solid red triangle.
       Marking only the first way can show nothing at all, which I found out
       from rule 90: it lives on every other cell, the changed cell is nine over
       and nine is odd, so the pattern and its consequences never once land on
       the same square. The plate looked broken and the arithmetic was right. */
    ctx.fillStyle = accentDim;
    for (let i = 0; i < cols; i++) {
      if (!cells[i] && twin[i]) ctx.fillRect(i * CELL, y, CELL, CELL);
    }
    ctx.fillStyle = accent;
    for (let i = 0; i < cols; i++) {
      if (cells[i] && !twin[i]) ctx.fillRect(i * CELL, y, CELL, CELL);
    }
  }

  function advance(src) {
    const next = new Uint8Array(cols);
    for (let i = 0; i < cols; i++) {
      const l = src[(i - 1 + cols) % cols];
      const c = src[i];
      const r = src[(i + 1) % cols];
      next[i] = (rule >> ((l << 2) | (c << 1) | r)) & 1;
    }
    return next;
  }

  function stepRow() {
    cells = advance(cells);
    twin = advance(twin);
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    if (!visible) return;
    /* four rows a frame: fast enough to feel alive, slow enough to watch */
    for (let k = 0; k < 4 && row < rows - 1; k++) {
      stepRow();
      row++;
      drawRow();
    }
  }

  function setRule(n, fromChip) {
    rule = Math.max(0, Math.min(255, n | 0));
    if (hud) hud.textContent = rule;
    if (ruleInput && ruleInput.value !== String(rule)) ruleInput.value = rule;
    chips.forEach(c => c.setAttribute('aria-pressed', String(+c.dataset.rule === rule)));
    const census = window.NoBrief && window.NoBrief.census;
    if (census) census.mark(rule);
    start();
  }

  readInk();

  /* Opening on rule 30 is what everybody does, and the census next to the plate
     exists precisely because the number tells you nothing. So the plate opens
     on whichever rule the measurement thinks is worth a look today. */
  const census = window.NoBrief && window.NoBrief.census;
  setRule(census ? census.pick() : 30);

  window.NoBrief = window.NoBrief || {};
  window.NoBrief.rule = {
    set: setRule,
    get: () => rule,
    /* Run the sheet to the bottom without animating it, which is what the
       reduced motion path wants and what anyone measuring this wants too. */
    fill: () => { while (row < rows - 1) { stepRow(); row++; drawRow(); } },
  };

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduce.matches) {
    window.NoBrief.rule.fill();
  } else {
    new IntersectionObserver((e) => { visible = e[0].isIntersecting; }, { threshold: 0.05 }).observe(canvas);
    loop();
  }

  ruleInput && ruleInput.addEventListener('input', () => {
    const v = parseInt(ruleInput.value, 10);
    if (!Number.isNaN(v)) setRule(v);
  });
  chips.forEach(c => c.addEventListener('click', () => setRule(parseInt(c.dataset.rule, 10))));
  randomBox && randomBox.addEventListener('change', start);
  diffBox && diffBox.addEventListener('change', start);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readInk(); start(); });

  /* Width only: see the note in growth.js about the address bar. */
  let rt, lastW = Math.round(canvas.getBoundingClientRect().width);
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      const w = Math.round(canvas.getBoundingClientRect().width);
      if (w === lastW) return;
      lastW = w;
      start();
    }, 220);
  });
})();
