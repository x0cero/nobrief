# No Brief

A website with no client, at [nobrief.0nerv.com](https://nobrief.0nerv.com).

Three small machines, each one a rule that fits in a sentence, plus a short
essay about what happens when nobody tells you what to build.

| Plate | What it is |
| --- | --- |
| I. Growth | Differential growth. A closed loop of points that attract their neighbors, repel everything else, and split when stretched. |
| II. Prediction | A character level n-gram language model, orders one through six with backoff, trained in the browser on the text of the page it lives on. |
| III. Rule | Elementary cellular automaton. Eight neighborhoods, one number from 0 to 255, and that number is the whole program. |

No libraries, no build step, no framework. One HTML file, one stylesheet, three
scripts, served as static assets from a Cloudflare Worker.

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
