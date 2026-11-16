// Overlap per pair of districts during the Linear morph, read from the morph page's own outlines.
//
//   node experiments/fixed-grid-overlap/pair_overlap.cjs LAYOUTS.json OUT_PREFIX [--frames 51]
//
// Opens index.html in headless Chromium (as evidence/morph_scores.cjs does), imports LAYOUTS.json,
// and for the NYU layout and every candidate takes the page's Linear outlines (each district part's
// src/dst vertex arrays, interpolated at time t exactly as sampleLinearPart does). Each outline is
// filled on a pixel grid 1,200 pixels wide over the bounding box of all outlines, even-odd rule.
// A pixel covered by two districts counts once for that pair; with three or more, each later district
// is paired with the first one only.
// Writes OUT_PREFIX_pairs.csv (layout, a, b, overlap summed over frames in screen units squared) and
// OUT_PREFIX_frames.csv (per frame: our overlap share and the page's own Linear overlap share, so the
// two can be compared). HEXMAP_CHROMIUM picks a local Chromium executable.
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..", "..");
const D3 = path.join(ROOT, "node_modules", "d3", "dist", "d3.min.js");
const [layoutsArg, prefixArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!layoutsArg || !prefixArg) throw new Error("usage: pair_overlap.cjs LAYOUTS.json OUT_PREFIX [--frames 51]");
const fi = process.argv.indexOf("--frames");
const FRAMES = fi > 0 ? Number(process.argv[fi + 1]) : 51;
const WAIT = { timeout: 15 * 60 * 1000 };

// Runs inside the page.
function measurePairs(frames) {
  const ds = window.hexmap.districts;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const d of ds) for (const { src, dst } of d.parts) for (const a of [src, dst]) {
    for (let i = 0; i < a.length; i += 2) {
      if (a[i] < x0) x0 = a[i]; if (a[i] > x1) x1 = a[i];
      if (a[i + 1] < y0) y0 = a[i + 1]; if (a[i + 1] > y1) y1 = a[i + 1];
    }
  }
  const W = 1200, k = W / (x1 - x0), H = Math.ceil((y1 - y0) * k) + 1, pxArea = 1 / (k * k);
  const owner = new Int32Array(W * H), pairs = new Map(), frameRows = [];
  const xs = [];
  for (let f = 0; f < frames; f++) {
    const t = f / (frames - 1);
    owner.fill(0);
    let covered = 0, over = 0;
    const seen = new Uint8Array(W * H);
    ds.forEach((d, n) => {
      const id = n + 1;
      // edges of every part at time t, in pixel coordinates
      const edges = [];
      let ymin = Infinity, ymax = -Infinity;
      for (const { src, dst } of d.parts) {
        const m = src.length / 2;
        const px = new Float64Array(m), py = new Float64Array(m);
        for (let i = 0; i < m; i++) {
          px[i] = (src[2 * i] + (dst[2 * i] - src[2 * i]) * t - x0) * k;
          py[i] = (src[2 * i + 1] + (dst[2 * i + 1] - src[2 * i + 1]) * t - y0) * k;
          if (py[i] < ymin) ymin = py[i]; if (py[i] > ymax) ymax = py[i];
        }
        for (let i = 0; i < m; i++) { const j = (i + 1) % m; if (py[i] !== py[j]) edges.push(px[i], py[i], px[j], py[j]); }
      }
      const r0 = Math.max(0, Math.ceil(ymin - 0.5)), r1 = Math.min(H - 1, Math.floor(ymax - 0.5));
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
            if (o === 0) { owner[p] = id; covered++; }
            else if (o !== id) {
              if (!seen[p]) { seen[p] = 1; over++; }
              const a = Math.min(o, id) - 1, b = Math.max(o, id) - 1, key = a * 4096 + b;
              pairs.set(key, (pairs.get(key) || 0) + 1);
            }
          }
        }
      }
    });
    frameRows.push([t, covered ? (100 * over) / covered : 0]);
  }
  const ids = ds.map((d) => d.id);
  const out = [];
  for (const [key, count] of pairs) out.push([ids[Math.floor(key / 4096)], ids[key % 4096], count * pxArea]);
  return { pairs: out, frames: frameRows, page: window.hexmap.scoresByMode.linear.map((r) => [r.t, r.overlap]) };
}

(async () => {
  fs.mkdirSync(path.dirname(path.resolve(prefixArg)), { recursive: true });
  const browser = await chromium.launch(process.env.HEXMAP_CHROMIUM ? { executablePath: process.env.HEXMAP_CHROMIUM } : {});
  const pairRows = [], frameRows = [], errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("https://cdnjs.cloudflare.com/**", (route) => route.fulfill({ path: D3, contentType: "application/javascript" }));
    await page.goto(pathToFileURL(path.join(ROOT, "index.html")).href);
    await page.waitForFunction(() => window.hexmap && window.hexmap.scoresByMode.linear, null, WAIT);
    await page.setInputFiles("#layout-file", path.resolve(layoutsArg));
    await page.waitForFunction(() => document.querySelectorAll("#layout-select option").length > 1, null, WAIT);
    const options = await page.$$eval("#layout-select option", (os) => os.map((o) => o.value));
    for (const value of options) {
      await page.selectOption("#layout-select", value);
      const id = await page.evaluate(() => (window.hexmap.layout ? window.hexmap.layout.id : "NYU"));
      await page.evaluate(() => window.hexmap.setMode("linear"));
      await page.waitForFunction(() => window.hexmap.scoresByMode.linear, null, WAIT);
      const r = await page.evaluate(measurePairs, FRAMES);
      for (const [a, b, area] of r.pairs) pairRows.push([id, a, b, area.toFixed(3)]);
      const pageAt = new Map(r.page.map(([t, o]) => [t.toFixed(2), o]));
      for (const [t, o] of r.frames) frameRows.push([id, t.toFixed(2), o.toFixed(3), (pageAt.get(t.toFixed(2)) ?? NaN).toFixed(3)]);
      const peak = Math.max(...r.frames.map((x) => x[1])), pagePeak = Math.max(...r.page.map((x) => x[1]));
      console.log(`${id.padEnd(30)} pairs ${String(r.pairs.length).padStart(5)}  peak ${peak.toFixed(2)}% (page ${pagePeak.toFixed(2)}%)`);
    }
  } finally {
    await browser.close();
  }
  if (errors.length) throw new Error("page errors: " + errors.join(" | "));
  fs.writeFileSync(prefixArg + "_pairs.csv", ["layout,a,b,overlap_area_frames", ...pairRows.map((r) => r.join(","))].join("\n") + "\n");
  fs.writeFileSync(prefixArg + "_frames.csv", ["layout,t,overlap_pct,page_overlap_pct", ...frameRows.map((r) => r.join(","))].join("\n") + "\n");
  console.log(`wrote ${pairRows.length} pair rows and ${frameRows.length} frame rows`);
})().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
