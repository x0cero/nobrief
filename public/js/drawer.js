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

  function drawing(spec, strokeWidth) {
    const n = spec.path.split(',');
    const xs = [], ys = [];
    for (let i = 0; i < n.length; i += 2) { xs.push(+n[i]); ys.push(+n[i + 1]); }
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = 0.02;
    const w = (maxX - minX) + pad * 2, h = (maxY - minY) + pad * 2;

    /* The stored curve is thinned to keep it small, which shows as corners
       once you look at it large. Rounding each corner with a quadratic through
       the midpoints puts the smoothness back without storing more. */
    const N = xs.length;
    const mx = (i, j) => ((xs[i] + xs[j]) / 2).toFixed(4);
    const my = (i, j) => ((ys[i] + ys[j]) / 2).toFixed(4);
    let d = `M${mx(N - 1, 0)} ${my(N - 1, 0)}`;
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      d += `Q${xs[i].toFixed(4)} ${ys[i].toFixed(4)} ${mx(i, j)} ${my(i, j)}`;
    }
    d += 'Z';

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `${(minX - pad).toFixed(3)} ${(minY - pad).toFixed(3)} ${w.toFixed(3)} ${h.toFixed(3)}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', String(strokeWidth));
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
  }

  const shortDate = (at) =>
    new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  /* A shape with seventeen hundred points deserves better than a thumbnail. */
  let modal = null;
  function look(spec) {
    if (!modal) {
      modal = document.createElement('dialog');
      modal.className = 'look';
      modal.innerHTML = '<div class="look__plate"></div><div class="look__cap"></div>' +
        '<button type="button" class="look__close" aria-label="Close">Close</button>';
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });
      modal.querySelector('.look__close').addEventListener('click', () => modal.close());
      document.body.appendChild(modal);
    }
    const plate = modal.querySelector('.look__plate');
    plate.innerHTML = '';
    plate.appendChild(drawing(spec, 0.0016));
    modal.querySelector('.look__cap').innerHTML =
      `<span>${spec.id}</span><span>${spec.n} points</span><span>${shortDate(spec.at)}</span>`;
    modal.showModal();
  }

  function thumb(spec) {
    const li = document.createElement('li');
    li.className = 'drawer__item';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'drawer__figure';
    btn.setAttribute('aria-label', `Look at specimen ${spec.id} closely`);
    btn.appendChild(drawing(spec, 0.0028));
    btn.addEventListener('click', () => look(spec));
    const cap = document.createElement('div');
    cap.className = 'drawer__cap';
    cap.innerHTML = `<span>${spec.id}</span><span>${shortDate(spec.at)}</span>`;
    li.append(btn, cap);
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
