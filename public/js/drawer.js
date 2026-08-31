/* The drawer. Every shape Plate I grows is unique and then gone when the tab
   closes, which bothered me, so this keeps the ones people decide to keep. */

(function () {
  const keepBtn  = document.getElementById('growth-keep');
  const keepNote = document.getElementById('growth-keep-note');
  const grid     = document.getElementById('drawer-grid');
  const countEl  = document.getElementById('drawer-count');
  const canvas   = document.getElementById('growth-canvas');
  if (!grid) return;

  const NS = 'http://www.w3.org/2000/svg';

  function thumb(spec) {
    const n = spec.path.split(',');
    const xs = [], ys = [];
    for (let i = 0; i < n.length; i += 2) { xs.push(+n[i]); ys.push(+n[i + 1]); }
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = 0.02;
    const w = (maxX - minX) + pad * 2, h = (maxY - minY) + pad * 2;

    let d = '';
    for (let i = 0; i < xs.length; i++) d += (i ? 'L' : 'M') + xs[i].toFixed(3) + ' ' + ys[i].toFixed(3);
    d += 'Z';

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `${(minX - pad).toFixed(3)} ${(minY - pad).toFixed(3)} ${w.toFixed(3)} ${h.toFixed(3)}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '0.0028');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);

    const when = new Date(spec.at);
    const li = document.createElement('li');
    li.className = 'drawer__item';
    const figure = document.createElement('div');
    figure.className = 'drawer__figure';
    figure.appendChild(svg);
    const cap = document.createElement('div');
    cap.className = 'drawer__cap';
    cap.innerHTML = `<span>${spec.id}</span><span>${when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>`;
    li.append(figure, cap);
    return li;
  }

  let loaded = false;
  async function load(fresh) {
    if (loaded && !fresh) return;
    loaded = true;
    try {
      /* after a save the browser will happily hand back the cached empty
         drawer, so ask for it again properly */
      const url = '/api/specimens?limit=24' + (fresh ? '&t=' + Date.now() : '');
      const res = await fetch(url, fresh ? { cache: 'no-store' } : undefined);
      const data = await res.json();
      render(data);
    } catch {
      grid.innerHTML = '';
      const li = document.createElement('li');
      li.className = 'drawer__empty';
      li.textContent = 'The drawer will not open just now.';
      grid.appendChild(li);
    }
  }

  function render(data) {
    grid.innerHTML = '';
    if (countEl) countEl.textContent = data.total === 1 ? '1 kept' : `${data.total} kept`;
    if (!data.specimens.length) {
      const li = document.createElement('li');
      li.className = 'drawer__empty';
      li.textContent = 'Nothing in here yet. Grow one above and press keep.';
      grid.appendChild(li);
      return;
    }
    for (const s of data.specimens) grid.appendChild(thumb(s));
  }

  new IntersectionObserver((e, o) => {
    if (e[0].isIntersecting) { load(); o.disconnect(); }
  }, { rootMargin: '400px' }).observe(grid);

  /* ── the keep button ── */
  if (!keepBtn || !canvas) return;

  const say = (msg) => { if (keepNote) keepNote.textContent = msg; };

  canvas.addEventListener('growth:settled', () => {
    keepBtn.disabled = false;
    say('this one will never happen again');
  });
  canvas.addEventListener('growth:restarted', () => {
    keepBtn.disabled = true;
    keepBtn.textContent = 'Keep this one';
    say('');
  });

  keepBtn.addEventListener('click', async () => {
    const g = window.NoBrief && window.NoBrief.growth;
    if (!g || !g.settled()) return;
    keepBtn.disabled = true;
    say('keeping…');
    try {
      const res = await fetch('/api/specimens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: g.normalizedPath() })
      });
      const data = await res.json();
      if (!res.ok) { say(data.error || 'It would not go in.'); keepBtn.disabled = false; return; }
      keepBtn.textContent = data.duplicate ? 'Already in there' : 'Kept';
      say(data.duplicate ? 'that exact shape was already in the drawer' : `filed as ${data.id}`);
      await load(true);
      document.getElementById('drawer').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      say('It would not go in.');
      keepBtn.disabled = false;
    }
  });
})();
