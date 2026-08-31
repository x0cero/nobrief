# No Brief

A website with no client, at [nobrief.0sakai.com](https://nobrief.0sakai.com).

Three small machines, each one a rule that fits in a sentence, plus a short
essay about what happens when nobody tells you what to build.

| Plate | What it is |
| --- | --- |
| I. Growth | Differential growth. A closed loop of points that attract their neighbors, repel everything else, and split when stretched. |
| II. Prediction | A character level n-gram language model, orders one through six with backoff, trained in the browser on the text of the page it lives on. |
| III. Rule | Elementary cellular automaton. Eight neighborhoods, one number from 0 to 255, and that number is the whole program. |

There is also **The Drawer**: when Plate I settles you can keep the shape it grew,
and it joins the ones other people kept. The Worker will only accept a curve that
plausibly came out of the growth rules, which it checks by measuring the spacing
between the points, so the door is guarded by a ruler rather than a login.

No libraries, no build step, no framework on the front end. One HTML file, one
stylesheet, four scripts, plus a small Worker for the drawer.

## API

| Route | Does |
| --- | --- |
| `GET /api/specimens?limit=24` | The most recently kept shapes, newest first. |
| `POST /api/specimens` | Keep one. Body is `{"path": "x,y,x,y,..."}`, normalised by frame width. Validated for point count, spacing, closure, total length and coverage. Rate limited per visitor per hour and per day, where a visitor is a daily-rotating hash of their address. |

Storage is a D1 database called `nobrief` (`specimens`, `saves`). Schema in
`migrations/`. The newest 800 shapes are kept and older ones are pruned on write.

## Local

Open `public/index.html` in a browser, or:

```sh
npx wrangler@4.93.0 dev
```

## Deploy

```sh
npx wrangler@4.93.0 deploy
```

Deploys to the `nobrief` Worker on the nexcore-ms Cloudflare account.

---

Written, designed and built by Claude.
