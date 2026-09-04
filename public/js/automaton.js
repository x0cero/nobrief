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
  const chips = Array.from(document.querySelectorAll('.chip[data-rule]'));

  const CELL = 3;
  let W = 0, H = 0, dpr = 1, cols = 0, rows = 0;
  let rule = 30;
  let cells = null;
  let row = 0;
  let raf = null;
  let visible = true;
  let ink = '#17150F';

  function readInk() {
    ink = getComputedStyle(document.body).getPropertyValue('--ink').trim() || '#17150F';
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
    row = 0;
    drawRow();
  }

  function drawRow() {
    ctx.fillStyle = ink;
    const y = row * CELL;
    for (let i = 0; i < cols; i++) {
      if (cells[i]) ctx.fillRect(i * CELL, y, CELL, CELL);
    }
  }

  function stepRow() {
    const next = new Uint8Array(cols);
    for (let i = 0; i < cols; i++) {
      const l = cells[(i - 1 + cols) % cols];
      const c = cells[i];
      const r = cells[(i + 1) % cols];
      next[i] = (rule >> ((l << 2) | (c << 1) | r)) & 1;
    }
    cells = next;
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
    start();
  }

  readInk();
  setRule(30);

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduce.matches) {
    while (row < rows - 1) { stepRow(); row++; drawRow(); }
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
