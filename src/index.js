/* No Brief — the only server-side part of this site.
   It keeps the shapes that people decide to keep, and it only accepts a
   shape that could plausibly have been grown by Plate I. */

const MAX_BODY   = 28_000;   // bytes
const MIN_POINTS = 300;
const MAX_POINTS = 900;
const KEEP_ROWS  = 800;      // oldest beyond this get pruned
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

    if (url.pathname.startsWith('/api/')) return json({ error: 'No such endpoint.' }, 404);

    return env.ASSETS.fetch(request);
  }
};
