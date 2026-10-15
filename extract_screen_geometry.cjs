// Copies the screen geometry that index.html computes into the two files that keep
// their own copy of it:
//
//   district_morph.html                   the data block: all 436 districts, 3 decimals
//   forsch/input/kansas_1st_screen.json   Kansas's 1st at full precision, read by forsch/prep_input.cjs
//
// Screen geometry here means each district's outline after d3.geoAlbersUsa and its
// hexagon after the least-squares fit of the hex grid. The script opens index.html itself
// in headless Chromium and reads the numbers from the page, so the copies always match
// what index.html draws.
//
//   npm install
//   npx playwright install chromium     (once)
//   npm run extract
//
// index.html loads d3 7.9.0 from cdnjs. The script serves the same version from
// node_modules instead, so it also runs offline.
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium } = require("playwright");

const ROOT = __dirname;
const D3 = path.join(ROOT, "node_modules", "d3", "dist", "d3.min.js");
const MORPH_PAGE = path.join(ROOT, "district_morph.html");
const KANSAS = path.join(ROOT, "forsch", "input", "kansas_1st_screen.json");
const OPEN = '<script type="application/json" id="data">', CLOSE = "</script>";

// The four examples at the top of district_morph.html's list, with the note it shows for each.
const NOTES = {
  "Kansas's 1st": "A big, simple outline. The pairing works as intended.",
  "Texas's 4th": "Its outline crosses itself for most of the morph.",
  "Louisiana's 3rd": "The wiggly coast takes up most of the outline, so it claims most of the hex edge.",
  "Michigan's 1st": "Its second piece (the northern Lower Peninsula) and four islands shrink into the hex centre.",
};

// Runs inside index.html. Records each district's projected rings the same way the page's
// projectedRings() does: geoPath with a recording context, repeated points dropped,
// the closing point removed, rings with fewer than 3 points skipped.
function readPage() {
  let rec = null;
  const recorder = d3.geoPath(window.hexmap.projection, {
    moveTo(x, y) { rec.push([[x, y]]); },
    lineTo(x, y) { const r = rec[rec.length - 1], l = r[r.length - 1]; if (l[0] !== x || l[1] !== y) r.push([x, y]); },
    closePath() {},
    arc() {},
  });
  const byFips = new Map(window.HEXMAP_DATA.features.map((f) => [f.properties.geo_fips, f]));
  return window.hexmap.districts.map((d) => {
    rec = [];
    recorder(byFips.get(d.properties.geo_fips));
    const rings = rec
      .map((r) => { const a = r[0], b = r[r.length - 1]; if (r.length > 1 && a[0] === b[0] && a[1] === b[1]) r.pop(); return r; })
      .filter((r) => r.length >= 3);
    return { name: d.properties.geo_name, fips: d.properties.geo_fips, dist: d.dist, center: d.center, corners: d.corners, rings };
  });
}

// district_morph.html keeps 3 decimals to stay small. Rounding can make two neighbouring
// points equal, so repeats are dropped again after it.
const r3 = (v) => Math.round(v * 1000) / 1000;
function morphPageData(districts) {
  return districts
    .map((d) => {
      const rings = d.rings
        .map((ring) => ring.map((p) => p.map(r3)))
        .map((ring) => ring.filter((p, i) => i === 0 || p[0] !== ring[i - 1][0] || p[1] !== ring[i - 1][1]))
        .filter((ring) => ring.length >= 3);
      const o = { n: d.name, f: d.fips, d: +d.dist.toFixed(2), c: d.center.map(r3), k: d.corners.map((p) => p.map(r3)), r: rings };
      if (NOTES[d.name]) o.note = NOTES[d.name];
      return o;
    })
    .sort((a, b) => a.f.localeCompare(b.f));
}

function writeIfChanged(file, text) {
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return "unchanged";
  fs.writeFileSync(file, text);
  return "updated";
}

(async () => {
  if (!fs.existsSync(D3)) throw new Error("node_modules/d3 is missing. Run npm install first.");
  const browser = await chromium.launch();
  let districts;
  try {
    const page = await browser.newPage();
    await page.route("https://cdnjs.cloudflare.com/**", (route) => route.fulfill({ path: D3, contentType: "application/javascript" }));
    await page.goto(pathToFileURL(path.join(ROOT, "index.html")).href);
    await page.waitForFunction(() => window.hexmap && window.hexmap.districts);
    districts = await page.evaluate(readPage);
  } finally {
    await browser.close();
  }

  // district_morph.html: replace only the data block and leave the page's code alone.
  const json = JSON.stringify(morphPageData(districts));
  if (json.includes("</")) throw new Error("The data would close its <script> tag early.");
  const html = fs.readFileSync(MORPH_PAGE, "utf8");
  const a = html.indexOf(OPEN), b = html.indexOf(CLOSE, a);
  if (a < 0 || b < 0) throw new Error("district_morph.html has no data block.");
  const pageStatus = writeIfChanged(MORPH_PAGE, html.slice(0, a + OPEN.length) + json + html.slice(b));

  // forsch/input/kansas_1st_screen.json: full precision.
  const k = districts.find((d) => d.name === "Kansas's 1st");
  const kansasStatus = writeIfChanged(KANSAS, JSON.stringify({ name: k.name, center: k.center, corners: k.corners, rings: k.rings }));

  const points = districts.reduce((n, d) => n + d.rings.reduce((m, r) => m + r.length, 0), 0);
  console.log(`${districts.length} districts, ${points.toLocaleString("en-US")} projected points`);
  console.log(`district_morph.html: ${pageStatus}`);
  console.log(`forsch/input/kansas_1st_screen.json: ${kansasStatus}`);
})().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
