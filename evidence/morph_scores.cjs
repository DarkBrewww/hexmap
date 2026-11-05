// Morph scores for every layout, read from the morph page itself.
//
//   npm install
//   npx playwright install chromium     (once)
//   node evidence/morph_scores.cjs [LAYOUTS.json] [OUT.csv]
//   (defaults: evidence/friday_layouts.json and evidence/morph_scores.csv)
//
// Opens index.html in headless Chromium, imports LAYOUTS.json through #layout-file, then for
// the NYU layout and every candidate in #layout-select runs Linear and Forsch hybrid and copies
// window.hexmap.scoresByMode. These are the page's own 101 frames, the same numbers as its
// "Download scores (CSV)" button. Output: one row per layout, method and frame.
//
// index.html loads d3 7.9.0 from cdnjs; like extract_screen_geometry.cjs, this serves the same
// version from node_modules, so it runs offline. HEXMAP_CHROMIUM, if set, is the Chromium
// executable to use instead of Playwright's own.
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium } = require("playwright");

const ROOT = path.dirname(__dirname);
const D3 = path.join(ROOT, "node_modules", "d3", "dist", "d3.min.js");
const layoutsPath = path.resolve(process.argv[2] || path.join(__dirname, "friday_layouts.json"));
const outPath = path.resolve(process.argv[3] || path.join(__dirname, "morph_scores.csv"));
const WAIT = { timeout: 15 * 60 * 1000 };

(async () => {
  if (!fs.existsSync(D3)) throw new Error("node_modules/d3 is missing. Run npm install first.");
  const browser = await chromium.launch(process.env.HEXMAP_CHROMIUM ? { executablePath: process.env.HEXMAP_CHROMIUM } : {});
  const rows = [], errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("https://cdnjs.cloudflare.com/**", (route) => route.fulfill({ path: D3, contentType: "application/javascript" }));
    await page.goto(pathToFileURL(path.join(ROOT, "index.html")).href);
    await page.waitForFunction(() => window.hexmap && window.hexmap.scoresByMode.linear, null, WAIT);
    await page.setInputFiles("#layout-file", layoutsPath);
    await page.waitForFunction(() => document.querySelectorAll("#layout-select option").length > 1, null, WAIT);
    const options = await page.$$eval("#layout-select option", (os) => os.map((o) => o.value));
    for (const value of options) {
      await page.selectOption("#layout-select", value);
      const id = await page.evaluate(() => (window.hexmap.layout ? window.hexmap.layout.id : "NYU"));
      for (const mode of ["linear", "forsch"]) {
        await page.evaluate((m) => window.hexmap.setMode(m), mode);
        if ((await page.evaluate(() => window.hexmap.mode)) !== mode) throw new Error(`could not switch ${id} to ${mode}`);
        await page.waitForFunction((m) => window.hexmap.scoresByMode[m], mode, WAIT);
        const frames = await page.evaluate((m) => window.hexmap.scoresByMode[m], mode);
        for (const f of frames) {
          rows.push([id, mode, f.t.toFixed(2), f.overlap.toFixed(3), f.crossing, f.area.toFixed(4)]);
        }
        const peak = Math.max(...frames.map((f) => f.overlap));
        console.log(`${id.padEnd(30)} ${mode.padEnd(7)} ${frames.length} frames, overlap peak ${peak.toFixed(1)}%`);
      }
    }
  } finally {
    await browser.close();
  }
  if (errors.length) throw new Error("page errors: " + errors.join(" | "));
  const header = "layout,method,t,overlap_pct,self_crossing_districts,area_change_rate";
  fs.writeFileSync(outPath, [header, ...rows.map((r) => r.join(","))].join("\n") + "\n");
  console.log(`wrote ${rows.length} rows to ${path.relative(ROOT, outPath)}`);
})().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
