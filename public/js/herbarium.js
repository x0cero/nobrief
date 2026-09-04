/* The herbarium. The drawer keeps curves; this keeps networks.

   A pressed network is not a picture of the plate, it is the plate's lines
   with everything else thrown away: where each run of ink went, and how heavy
   it was. Which is what a pressed plant is, more or less. */

(function () {
  const grid    = document.getElementById('herb-grid');
  const countEl = document.getElementById('herb-count');
  const pressBtn = document.getElementById('trail-press');
  const noteEl  = document.getElementById('trail-press-note');
  if (!grid) return;

  const NS = 'http://www.w3.org/2000/svg';
  const A64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const VAL = {};
  for (let i = 0; i < 64; i++) VAL[A64[i]] = i;

  function decode(data) {
    const out = [];
    for (const part of data.split(';')) {
      const bar = part.indexOf('|');
      if (bar < 0) continue;
      const weight = +part.slice(0, bar);
      const body = part.slice(bar + 1);
      const pts = [];
      for (let i = 0; i + 3 < body.length; i += 4) {
        const x = ((VAL[body[i]] << 6) | VAL[body[i + 1]]) / 4095;
        const y = ((VAL[body[i + 2]] << 6) | VAL[body[i + 3]]) / 4095;
        if (Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y]);
      }
      if (pts.length > 1) out.push({ weight, pts });
    }
    return out;
  }

  /* One path element per weight rather than per line. A network can be a
     thousand separate runs and the browser should not be asked to keep a
     thousand elements alive in a thumbnail the size of a stamp. */
  function drawing(spec, scale) {
    const chains = decode(spec.data);
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    for (const c of chains) {
      for (const [x, y] of c.pts) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    const pad = 0.01;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox',
      `${(minX - pad).toFixed(3)} ${(minY - pad).toFixed(3)} ` +
      `${(maxX - minX + pad * 2).toFixed(3)} ${(maxY - minY + pad * 2).toFixed(3)}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    const byWeight = new Map();
    for (const c of chains) {
      let d = byWeight.get(c.weight);
      if (!d) { d = []; byWeight.set(c.weight, d); }
      let s = 'M' + c.pts[0][0].toFixed(4) + ' ' + c.pts[0][1].toFixed(4);
      for (let i = 1; i < c.pts.length; i++) s += 'L' + c.pts[i][0].toFixed(4) + ' ' + c.pts[i][1].toFixed(4);
      d.push(s);
    }
    for (const [weight, ds] of [...byWeight].sort((a, b) => a[0] - b[0])) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', ds.join(''));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', ((0.0022 + weight * 0.0009) * scale).toFixed(5));
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('opacity', (0.45 + weight * 0.06).toFixed(2));
      svg.appendChild(path);
    }
    return svg;
  }

  const shortDate = (at) =>
    new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  let modal = null;
  function look(spec) {
    if (!modal) {
      modal = document.createElement('dialog');
      modal.className = 'look';
      modal.innerHTML = '<div class="look__plate look__plate--wide"></div><div class="look__cap"></div>' +
        '<button type="button" class="look__close" aria-label="Close">Close</button>';
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });
      modal.querySelector('.look__close').addEventListener('click', () => modal.close());
      document.body.appendChild(modal);
    }
    const plate = modal.querySelector('.look__plate');
    plate.innerHTML = '';
    plate.appendChild(drawing(spec, 0.45));
    modal.querySelector('.look__cap').innerHTML =
      `<span>${spec.id}</span><span>${spec.species}</span><span>${spec.chains} lines</span><span>${shortDate(spec.at)}</span>`;
    modal.showModal();
  }

  function sheet(spec) {
    const li = document.createElement('li');
    li.className = 'drawer__item';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'drawer__figure drawer__figure--wide';
    btn.setAttribute('aria-label', `Look at pressing ${spec.id} closely`);
    btn.appendChild(drawing(spec, 1));
    btn.addEventListener('click', () => look(spec));
    const cap = document.createElement('div');
    cap.className = 'drawer__cap';
    cap.innerHTML = `<span>${spec.species}</span><span>${shortDate(spec.at)}</span>`;
    li.append(btn, cap);
    return li;
  }

  function render(data) {
    grid.innerHTML = '';
    if (countEl) countEl.textContent = data.total === 1 ? '1 pressed' : `${data.total} pressed`;
    if (!data.pressings.length) {
      const li = document.createElement('li');
      li.className = 'drawer__empty';
      li.textContent = 'Empty. Press one from the plate above.';
      grid.appendChild(li);
      return;
    }
    for (const s of data.pressings) grid.appendChild(sheet(s));
  }

  let loaded = false;
  async function load(fresh) {
    if (loaded && !fresh) return;
    loaded = true;
    try {
      const url = '/api/pressings?limit=12' + (fresh ? '&t=' + Date.now() : '');
      const res = await fetch(url, fresh ? { cache: 'no-store' } : undefined);
      render(await res.json());
    } catch {
      grid.innerHTML = '';
      const li = document.createElement('li');
      li.className = 'drawer__empty';
      li.textContent = 'The cabinet will not open just now.';
      grid.appendChild(li);
    }
  }

  new IntersectionObserver((e, o) => {
    if (e[0].isIntersecting) { load(); o.disconnect(); }
  }, { rootMargin: '400px' }).observe(grid);

  window.NoBrief = window.NoBrief || {};
  window.NoBrief.herbarium = { reload: () => load(true) };

  /* ── the press button ── */
  if (!pressBtn) return;
  const say = (msg) => { if (noteEl) noteEl.textContent = msg; };

  pressBtn.addEventListener('click', async () => {
    const trail = window.NoBrief && window.NoBrief.trail;
    const press = window.NoBrief && window.NoBrief.press;
    if (!trail || !press) return;
    pressBtn.disabled = true;
    say('pressing…');

    /* Getting the lines out takes a moment and it is all main-thread work, so
       hand the browser a frame to paint the word first. A background tab is
       never given a frame at all, hence the timeout standing behind it:
       waiting on requestAnimationFrame alone means anyone who presses and then
       switches tabs comes back to a button that never finished. */
    await new Promise((resolve) => {
      let done = false;
      const go = () => { if (!done) { done = true; resolve(); } };
      requestAnimationFrame(() => setTimeout(go, 0));
      setTimeout(go, 150);
    });

    let made;
    try {
      made = press.press(trail.snapshot());
    } catch {
      say('could not get the lines out of it');
      pressBtn.disabled = false;
      return;
    }
    if (!made) { say('nothing to press yet, give it a few seconds'); pressBtn.disabled = false; return; }

    try {
      const res = await fetch('/api/pressings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ species: trail.species(), data: made.data })
      });
      const out = await res.json();
      if (!res.ok) { say(out.error || 'It would not go in.'); pressBtn.disabled = false; return; }
      say(out.duplicate ? 'that exact network was already pressed' : `${made.chains} lines, filed as ${out.id}`);
      await load(true);
      document.getElementById('herbarium').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      say('It would not go in.');
    }
    pressBtn.disabled = false;
  });
})();
