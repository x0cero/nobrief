/* No Brief — the only server-side part of this site.
   It keeps the shapes that people decide to keep, and it only accepts a
   shape that could plausibly have been grown by Plate I. */

const MAX_BODY   = 28_000;   // bytes
const MAX_NET    = 20_000;   // bytes, a pressed network is a bigger thing
const MIN_POINTS = 300;
const MAX_POINTS = 900;
const KEEP_ROWS  = 800;      // oldest beyond this get pruned
const KEEP_NETS  = 240;      // networks are heavier, so fewer of them
const PER_HOUR   = 5;
const PER_DAY    = 25;

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });

/* A visitor is identified only as a hash of their address plus today's date,
   so the identifier changes every day on its own and there is nothing here
   that points back at a person. */
async function whoami(request) {
  const ip = request.headers.get('cf-connecting-ip') || '0.0.0.0';
  const day = new Date().toISOString().slice(0, 10);
  const bytes = new TextEncoder().encode(`${day}:nobrief:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Does this look like something the plate actually drew?
   Differential growth leaves a closed curve with near uniform spacing that
   fills a good part of the frame. Anything else is somebody with a curl
   command, and it does not belong in the drawer. */
function looksGrown(path) {
  const nums = path.split(',');
  if (nums.length % 2 !== 0) return 'odd number of coordinates';
  const n = nums.length / 2;
  if (n < MIN_POINTS || n > MAX_POINTS) return `wrong number of points (${n})`;

  const xs = new Float64Array(n), ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = +nums[i * 2], y = +nums[i * 2 + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 'non-numeric coordinate';
    if (x < -0.02 || x > 1.02 || y < -0.02 || y > 1.3) return 'coordinate out of frame';
    xs[i] = x; ys[i] = y;
  }

  const gaps = new Float64Array(n);
  let length = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const g = Math.hypot(xs[j] - xs[i], ys[j] - ys[i]);
    gaps[i] = g;
    length += g;
  }
  const sorted = Array.from(gaps).sort((a, b) => a - b);
  const median = sorted[n >> 1];
  const largest = sorted[n - 1];

  if (median < 0.003 || median > 0.04) return 'implausible spacing between points';
  if (largest > Math.max(0.06, median * 5)) return 'a gap too large for a grown curve';
  if (length < 3 || length > 45) return 'implausible total length';

  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  if (w < 0.3 || h < 0.2) return 'does not fill enough of the frame';

  return null;
}

async function listSpecimens(env, limit) {
  const { results } = await env.DB.prepare(
    'SELECT id, created_at, points, path FROM specimens ORDER BY created_at DESC LIMIT ?1'
  ).bind(limit).all();
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM specimens').first('n');
  return { total: total || 0, specimens: results.map(r => ({ id: r.id, at: r.created_at, n: r.points, path: r.path })) };
}

async function keepSpecimen(request, env) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ error: 'That drawing is too large.' }, 413);

  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: 'Malformed body.' }, 400); }
  const path = typeof body?.path === 'string' ? body.path.trim() : '';
  if (!path) return json({ error: 'No drawing sent.' }, 400);

  const complaint = looksGrown(path);
  if (complaint) return json({ error: `That is not a grown shape: ${complaint}.` }, 422);

  const who = await whoami(request);
  const now = Date.now();
  const hour = await env.DB.prepare('SELECT COUNT(*) AS n FROM saves WHERE who = ?1 AND ts > ?2')
    .bind(who, now - 3600_000).first('n');
  if (hour >= PER_HOUR) return json({ error: 'You have kept a few already. Try again in an hour.' }, 429);
  const day = await env.DB.prepare('SELECT COUNT(*) AS n FROM saves WHERE who = ?1 AND ts > ?2')
    .bind(who, now - 86_400_000).first('n');
  if (day >= PER_DAY) return json({ error: 'That is enough for one day.' }, 429);

  const dupe = await env.DB.prepare('SELECT id FROM specimens WHERE path = ?1').bind(path).first('id');
  if (dupe) return json({ id: dupe, duplicate: true });

  const id = crypto.randomUUID().slice(0, 8);
  const points = (path.split(',').length / 2) | 0;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO specimens (id, created_at, points, path) VALUES (?1, ?2, ?3, ?4)')
      .bind(id, now, points, path),
    env.DB.prepare('INSERT INTO saves (who, ts) VALUES (?1, ?2)').bind(who, now),
    env.DB.prepare('DELETE FROM saves WHERE ts < ?1').bind(now - 86_400_000),
    env.DB.prepare(
      'DELETE FROM specimens WHERE id NOT IN (SELECT id FROM specimens ORDER BY created_at DESC LIMIT ?1)'
    ).bind(KEEP_ROWS)
  ]);

  return json({ id, at: now, n: points });
}


/* The same question asked of a network. A physarum plate leaves a lot of short
   runs meeting at junctions, spread over the whole sheet, with a range of
   weights; a curve drawn by hand and posted here has none of those properties
   at once. */
const SPECIES = ['veins', 'lace', 'cells', 'drift'];
const A64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const VAL = Object.fromEntries([...A64].map((c, i) => [c, i]));

function readChains(data) {
  const chains = [];
  for (const part of data.split(';')) {
    const bar = part.indexOf('|');
    if (bar !== 1) return null;
    const weight = +part[0];
    if (!(weight >= 1 && weight <= 9)) return null;
    const body = part.slice(2);
    if (body.length < 8 || body.length % 4 !== 0) return null;
    const pts = [];
    for (let i = 0; i < body.length; i += 4) {
      const a = VAL[body[i]], b = VAL[body[i + 1]], c = VAL[body[i + 2]], d = VAL[body[i + 3]];
      if (a === undefined || b === undefined || c === undefined || d === undefined) return null;
      pts.push([((a << 6) | b) / 4095, ((c << 6) | d) / 4095]);
    }
    chains.push({ weight, pts });
  }
  return chains;
}

function looksForaged(chains) {
  if (chains.length < 12 || chains.length > 1400) return `wrong number of lines (${chains.length})`;

  let points = 0, ink = 0, longest = 0;
  let minX = 2, maxX = -1, minY = 2, maxY = -1;
  const segs = [];
  const weights = new Set();

  for (const c of chains) {
    weights.add(c.weight);
    points += c.pts.length;
    for (let i = 0; i < c.pts.length; i++) {
      const [x, y] = c.pts[i];
      if (x < 0 || x > 1 || y < 0 || y > 0.9) return 'coordinate out of frame';
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (i) {
        const g = Math.hypot(x - c.pts[i - 1][0], y - c.pts[i - 1][1]);
        segs.push(g);
        ink += g;
        if (g > longest) longest = g;
      }
    }
  }

  if (points < 120 || points > 2600) return `wrong number of points (${points})`;
  if (weights.size < 2) return 'every line the same weight';
  if (longest > 0.35) return 'a line too straight and too long to have been grown';

  segs.sort((a, b) => a - b);
  const median = segs[segs.length >> 1];
  if (median < 0.0008 || median > 0.09) return 'implausible spacing along the lines';
  if (ink < 2 || ink > 160) return 'implausible total length of line';

  if (maxX - minX < 0.55 || maxY - minY < 0.3) return 'does not spread across the sheet';

  return null;
}

async function listPressings(env, limit) {
  const { results } = await env.DB.prepare(
    'SELECT id, created_at, species, chains, points, data FROM pressings ORDER BY created_at DESC LIMIT ?1'
  ).bind(limit).all();
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM pressings').first('n');
  return {
    total: total || 0,
    pressings: results.map(r => ({
      id: r.id, at: r.created_at, species: r.species, chains: r.chains, n: r.points, data: r.data
    }))
  };
}

async function keepPressing(request, env) {
  const raw = await request.text();
  if (raw.length > MAX_NET) return json({ error: 'That pressing is too large.' }, 413);

  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: 'Malformed body.' }, 400); }
  const data = typeof body?.data === 'string' ? body.data.trim() : '';
  const species = typeof body?.species === 'string' ? body.species.trim().toLowerCase() : '';
  if (!data) return json({ error: 'Nothing sent.' }, 400);
  if (!SPECIES.includes(species)) return json({ error: 'No such species.' }, 422);

  const chains = readChains(data);
  if (!chains) return json({ error: 'That is not a pressing.' }, 422);
  const complaint = looksForaged(chains);
  if (complaint) return json({ error: `That is not a foraged network: ${complaint}.` }, 422);

  const who = await whoami(request);
  const now = Date.now();
  const hour = await env.DB.prepare('SELECT COUNT(*) AS n FROM saves WHERE who = ?1 AND ts > ?2')
    .bind(who, now - 3600_000).first('n');
  if (hour >= PER_HOUR) return json({ error: 'You have kept a few already. Try again in an hour.' }, 429);
  const day = await env.DB.prepare('SELECT COUNT(*) AS n FROM saves WHERE who = ?1 AND ts > ?2')
    .bind(who, now - 86_400_000).first('n');
  if (day >= PER_DAY) return json({ error: 'That is enough for one day.' }, 429);

  const dupe = await env.DB.prepare('SELECT id FROM pressings WHERE data = ?1').bind(data).first('id');
  if (dupe) return json({ id: dupe, duplicate: true });

  const id = crypto.randomUUID().slice(0, 8);
  const points = chains.reduce((a, c) => a + c.pts.length, 0);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO pressings (id, created_at, species, chains, points, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind(id, now, species, chains.length, points, data),
    env.DB.prepare('INSERT INTO saves (who, ts) VALUES (?1, ?2)').bind(who, now),
    env.DB.prepare(
      'DELETE FROM pressings WHERE id NOT IN (SELECT id FROM pressings ORDER BY created_at DESC LIMIT ?1)'
    ).bind(KEEP_NETS)
  ]);

  return json({ id, at: now, chains: chains.length, n: points });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/specimens') {
      if (request.method === 'GET') {
        const limit = Math.min(48, Math.max(1, parseInt(url.searchParams.get('limit') || '24', 10) || 24));
        try {
          const data = await listSpecimens(env, limit);
          return json(data, 200, { 'cache-control': 'public, max-age=10' });
        } catch (err) {
          return json({ error: 'The drawer would not open.', detail: String(err) }, 500);
        }
      }
      if (request.method === 'POST') {
        try {
          return await keepSpecimen(request, env);
        } catch (err) {
          return json({ error: 'Could not keep that one.', detail: String(err) }, 500);
        }
      }
      return json({ error: 'Method not allowed.' }, 405, { allow: 'GET, POST' });
    }

    if (url.pathname === '/api/pressings') {
      if (request.method === 'GET') {
        const limit = Math.min(24, Math.max(1, parseInt(url.searchParams.get('limit') || '12', 10) || 12));
        try {
          const data = await listPressings(env, limit);
          return json(data, 200, { 'cache-control': 'public, max-age=10' });
        } catch (err) {
          return json({ error: 'The cabinet would not open.', detail: String(err) }, 500);
        }
      }
      if (request.method === 'POST') {
        try {
          return await keepPressing(request, env);
        } catch (err) {
          return json({ error: 'Could not press that one.', detail: String(err) }, 500);
        }
      }
      return json({ error: 'Method not allowed.' }, 405, { allow: 'GET, POST' });
    }

    if (url.pathname.startsWith('/api/')) return json({ error: 'No such endpoint.' }, 404);

    return env.ASSETS.fetch(request);
  }
};
