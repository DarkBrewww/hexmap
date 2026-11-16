// Scores for the staged linear morph, read from this folder's copy of the morph page.
//
//   node experiments/staged-timing/staged_scores.cjs [LAYOUTS.json] [OUT_PREFIX]
//   (defaults: layouts.json and runs/staged in this folder)
//
// Follows evidence/morph_scores.cjs: opens index.html in headless Chromium, imports LAYOUTS.json,
// and for the NYU layout and every candidate records the page's own 101 frames, first for Linear
// and then for Staged linear under every rule at stagger 0, 0.25, 0.5, 0.75 and 1.
// For every staged run it also records
//   - the outlines at t = 0 and t = 1 against Linear's (largest coordinate difference),
//   - how far any outline reaches outside the rectangle the page scores,
//   - the overlap of every pair of districts, summed over 51 moments (as pair_overlap.cjs in
//     ../fixed-grid-overlap does for Linear, here with the staged outlines).
// Writes OUT_frames.csv, OUT_runs.csv and OUT_pairs.csv. HEXMAP_CHROMIUM picks a local Chromium.
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const ROOT = path.resolve(__dirname, "..", "..");
const { chromium } = require(path.join(ROOT, "node_modules", "playwright"));
const D3 = path.join(ROOT, "node_modules", "d3", "dist", "d3.min.js");
const layoutsPath = path.resolve(process.argv[2] || path.join(__dirname, "layouts.json"));
const prefix = path.resolve(process.argv[3] || path.join(__dirname, "runs", "staged"));
const RULES = ["outline", "small", "three"], STAGGERS = [0, 0.25, 0.5, 0.75, 1], PAIR_FRAMES = 51;
const WAIT = { timeout: 15 * 60 * 1000 };

// Runs inside the page.
function inspect(pairFrames) {
  const H = window.hexmap, ds = H.districts, rect = H.scoreRect;
  // endpoints against Linear, and reach outside the scored rectangle
  let end0 = 0, end1 = 0, outside = 0;
  for (let i = 0; i < ds.length; i++) for (let p = 0; p < ds[i].parts.length; p++) {
    for (const [t, which] of [[0, 0], [1, 1]]) {
      const [ax, ay] = H.samplePart(i, p, t, "linear"), [bx, by] = H.samplePart(i, p, t, "staged");
      let worst = 0;
      for (let k = 0; k < ax.length; k++) worst = Math.max(worst, Math.abs(ax[k] - bx[k]), Math.abs(ay[k] - by[k]));
      if (which) end1 = Math.max(end1, worst); else end0 = Math.max(end0, worst);
    }
  }
  // outlines at every pair frame, their bounding box, and the reach outside the scored rectangle
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const frames = [];
  for (let f = 0; f < pairFrames; f++) {
    const t = f / (pairFrames - 1), shapes = [];
    for (let i = 0; i < ds.length; i++) {
      const parts = [];
      for (let p = 0; p < ds[i].parts.length; p++) {
        const [xs, ys] = H.samplePart(i, p, t, "staged");
        for (let k = 0; k < xs.length; k++) {
          if (xs[k] < x0) x0 = xs[k]; if (xs[k] > x1) x1 = xs[k];
          if (ys[k] < y0) y0 = ys[k]; if (ys[k] > y1) y1 = ys[k];
          outside = Math.max(outside, rect.x - xs[k], xs[k] - rect.x - rect.width, rect.y - ys[k], ys[k] - rect.y - rect.height);
        }
        parts.push([xs, ys]);
      }
      shapes.push(parts);
    }
    frames.push(shapes);
  }
  // pair overlap on a 1,200-pixel-wide grid over that bounding box, even-odd fill
  const W = 1200, k = W / (x1 - x0), Hh = Math.ceil((y1 - y0) * k) + 1, pxArea = 1 / (k * k);
  const owner = new Int32Array(W * Hh), pairs = new Map(), xs = [];
  for (const shapes of frames) {
    owner.fill(0);
    shapes.forEach((parts, n) => {
      const id = n + 1, edges = [];
      let ymin = Infinity, ymax = -Infinity;
      for (const [px, py] of parts) {
        const m = px.length;
        for (let i = 0; i < m; i++) {
          const j = (i + 1) % m, ya = (py[i] - y0) * k, yb = (py[j] - y0) * k;
          if (ya < ymin) ymin = ya; if (ya > ymax) ymax = ya;
          if (ya !== yb) edges.push((px[i] - x0) * k, ya, (px[j] - x0) * k, yb);
        }
      }
      const r0 = Math.max(0, Math.ceil(ymin - 0.5)), r1 = Math.min(Hh - 1, Math.floor(ymax - 0.5));
      for (let r = r0; r <= r1; r++) {
        const y = r + 0.5;
        xs.length = 0;
        for (let e = 0; e < edges.length; e += 4) {
          const ya = edges[e + 1], yb = edges[e + 3];
          if ((ya <= y && y < yb) || (yb <= y && y < ya)) xs.push(edges[e] + (y - ya) * (edges[e + 2] - edges[e]) / (yb - ya));
        }
        xs.sort((a, b) => a - b);
        for (let s = 0; s + 1 < xs.length; s += 2) {
          const c0 = Math.max(0, Math.ceil(xs[s] - 0.5)), c1 = Math.min(W - 1, Math.floor(xs[s + 1] - 0.5));
          for (let c = c0; c <= c1; c++) {
            const p = r * W + c, o = owner[p];
            if (o === 0) owner[p] = id;
            else if (o !== id) {
              const a = Math.min(o, id) - 1, b = Math.max(o, id) - 1, key = a * 4096 + b;
              pairs.set(key, (pairs.get(key) || 0) + 1);
            }
          }
        }
      }
    });
  }
  const ids = ds.map((d) => d.id), out = [];
  for (const [key, count] of pairs) out.push([ids[Math.floor(key / 4096)], ids[key % 4096], count * pxArea]);
  let first = 0;
  for (let i = 0; i < ds.length; i++) if (H.outlineFirst(i)) first++;
  const dist = ds.map((d) => d.dist);
  return { end0, end1, outside, outlineFirst: first, districts: ds.length, pairs: out,
    distMean: dist.reduce((a, b) => a + b, 0) / dist.length, distMax: Math.max(...dist), hexStep: H.fit.hexStep };
}

(async () => {
  fs.mkdirSync(path.dirname(prefix), { recursive: true });
  const browser = await chromium.launch(process.env.HEXMAP_CHROMIUM ? { executablePath: process.env.HEXMAP_CHROMIUM } : {});
  const frameRows = [], runRows = [], pairRows = [], errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("https://cdnjs.cloudflare.com/**", (route) => route.fulfill({ path: D3, contentType: "application/javascript" }));
    await page.goto(pathToFileURL(path.join(__dirname, "index.html")).href);
    await page.waitForFunction(() => window.hexmap && window.hexmap.scoresByMode.linear, null, WAIT);
    await page.setInputFiles("#layout-file", layoutsPath);
    await page.waitForFunction(() => document.querySelectorAll("#layout-select option").length > 1, null, WAIT);
    const options = await page.$$eval("#layout-select option", (os) => os.map((o) => o.value));
    const addFrames = (layout, method, rule, stagger, frames) => {
      for (const f of frames) frameRows.push([layout, method, rule, stagger, f.t.toFixed(2), f.overlap.toFixed(3), f.crossing, f.area.toFixed(4), f.covered]);
    };
    for (const value of options) {
      await page.selectOption("#layout-select", value);
      const id = await page.evaluate(() => (window.hexmap.layout ? window.hexmap.layout.id : "NYU"));
      await page.evaluate(() => window.hexmap.setMode("linear"));
      await page.waitForFunction(() => window.hexmap.scoresByMode.linear, null, WAIT);
      const linear = await page.evaluate(() => window.hexmap.scoresByMode.linear);
      addFrames(id, "linear", "", "", linear);
      await page.evaluate(() => window.hexmap.setMode("staged"));
      for (const rule of RULES) for (const stagger of STAGGERS) {
        await page.evaluate(([r, s]) => window.hexmap.setStaging(r, s), [rule, stagger]);
        await page.waitForFunction(([r, s]) => window.hexmap.scoresByMode.staged && window.hexmap.staging.rule === r && window.hexmap.staging.stagger === s, [rule, stagger], WAIT);
        const frames = await page.evaluate(() => window.hexmap.scoresByMode.staged);
        addFrames(id, "staged", rule, stagger, frames);
        const info = await page.evaluate(inspect, PAIR_FRAMES);
        runRows.push([id, rule, stagger, info.outlineFirst, info.districts, info.end0, info.end1, info.outside.toFixed(3),
          info.distMean.toFixed(4), info.distMax.toFixed(4), info.hexStep]);
        for (const [a, b, area] of info.pairs) pairRows.push([id, rule, stagger, a, b, area.toFixed(3)]);
        const peak = Math.max(...frames.map((f) => f.overlap));
        console.log(`${id.padEnd(22)} ${rule.padEnd(8)} s=${String(stagger).padEnd(4)} overlap peak ${peak.toFixed(2)}%  ` +
          `(Linear ${Math.max(...linear.map((f) => f.overlap)).toFixed(2)}%)  outside ${info.outside.toFixed(1)}`);
      }
    }
  } finally {
    await browser.close();
  }
  if (errors.length) throw new Error("page errors: " + errors.join(" | "));
  const write = (name, header, rows) => fs.writeFileSync(prefix + name, [header, ...rows.map((r) => r.join(","))].join("\n") + "\n");
  write("_frames.csv", "layout,method,rule,stagger,t,overlap_pct,self_crossing_districts,area_change_rate,covered_pixels", frameRows);
  write("_runs.csv", "layout,rule,stagger,outline_first_districts,districts,endpoint_diff_t0,endpoint_diff_t1,reach_outside_score_rect,dist_mean_hex_steps,dist_max_hex_steps,hex_step", runRows);
  write("_pairs.csv", "layout,rule,stagger,a,b,overlap_area_frames", pairRows);
  console.log(`wrote ${frameRows.length} frame rows, ${runRows.length} runs, ${pairRows.length} pair rows`);
})().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
