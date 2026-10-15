"use strict";

// Structural and endpoint checks for the generated browser payload.  This
// checks the stored keyframes and the final screen-space endpoint after the
// grid slide. It does not prove intermediate-frame validity or check the
// browser's area normalization, overlap, or the raw-to-schematic intro.
// Usage: node forsch/validate_full_map.cjs [--input=path/to/candidate.js]

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
if (args.some((arg) => !arg.startsWith("--input=") || arg === "--input=") || args.length > 1) {
  console.error("Usage: node forsch/validate_full_map.cjs [--input=path/to/candidate.js]");
  process.exit(1);
}
const INPUT = args.length ? path.resolve(args[0].slice("--input=".length)) : path.join(ROOT, "forsch_map_data.js");

function readDistricts() {
  const html = fs.readFileSync(path.join(ROOT, "district_morph.html"), "utf8");
  const marker = 'id="data">';
  const start = html.indexOf(marker);
  const end = html.indexOf("</script>", start);
  if (start < 0 || end < 0) throw new Error("district_morph.html has no embedded data");
  return JSON.parse(html.slice(start + marker.length, end));
}

function readGenerated() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(INPUT, "utf8"), context, { timeout: 5000 });
  return context.window.FORSCH_MAP_DATA;
}

function area(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    sum += p[0] * q[1] - q[0] * p[1];
  }
  return sum / 2;
}

function pointSegmentDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function boundaryDistance(p, ring) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) best = Math.min(best, pointSegmentDistance(p, ring[i], ring[(i + 1) % ring.length]));
  return best;
}

function flatRing(flat, transform = (x, y) => [x, y]) {
  const ring = [];
  for (let i = 0; i < flat.length; i += 2) ring.push(transform(flat[i], flat[i + 1]));
  return ring;
}

const source = readDistricts();
const generated = readGenerated();
if (!generated || !generated.districts || typeof generated.districts !== "object") {
  throw new Error("Input has no FORSCH_MAP_DATA.districts object");
}
const failures = [];
let maxGeneratedToHex = 0, maxHexToGenerated = 0, maxRelativeAreaError = 0;

if (!generated.coverage || generated.coverage.total !== source.length || generated.coverage.attempted !== source.length || generated.coverage.succeeded !== source.length || generated.coverage.failed !== 0 || Object.keys(generated.districts).length !== source.length) {
  failures.push(`coverage is not complete: ${JSON.stringify(generated && generated.coverage)}`);
}

for (const district of source) {
  const morph = generated.districts[district.f];
  const fail = (message) => failures.push(`${district.f} ${district.n}: ${message}`);
  if (!morph) { fail("missing generated morph"); continue; }
  if (!Array.isArray(morph.keyTimes) || !Array.isArray(morph.states) || morph.states.length < 2 ||
      morph.keyTimes.some((value) => !Number.isFinite(value)) ||
      !Number.isInteger(morph.statePoints) || morph.statePoints < 3 ||
      !Array.isArray(morph.slide) || morph.slide.length !== 2 || morph.slide.some((value) => !Number.isFinite(value)) ||
      morph.states.some((state) => !Array.isArray(state) || state.length !== morph.statePoints * 2 || state.some((value) => !Number.isFinite(value)))) {
    fail("invalid keyTimes, states, statePoints, or slide");
    continue;
  }
  if (morph.keyTimes.length !== morph.states.length || morph.states.length < 2) fail("keyframe count mismatch");
  if (morph.keyTimes[0] !== 0 || morph.keyTimes.at(-1) !== 1) fail("keyTimes do not span [0,1]");
  for (let i = 1; i < morph.keyTimes.length; i++) if (!(morph.keyTimes[i] > morph.keyTimes[i - 1])) fail("keyTimes are not strictly increasing");
  const expectedLength = morph.statePoints * 2;
  for (const state of morph.states) {
    if (state.length !== expectedLength) fail("state point count mismatch");
    if (state.some((value) => !Number.isFinite(value))) fail("non-finite coordinate");
  }
  if (!(morph.sourceScale > 0) || !Number.isFinite(morph.sourceScale)) fail("invalid sourceScale");

  const finalRing = flatRing(morph.states.at(-1), (x, y) => [x + morph.slide[0], y + morph.slide[1]]);
  const hex = district.k;
  const toHex = Math.max(...finalRing.map((point) => boundaryDistance(point, hex)));
  const fromHex = Math.max(...hex.map((point) => boundaryDistance(point, finalRing)));
  const relativeAreaError = Math.abs(Math.abs(area(finalRing)) - Math.abs(area(hex))) / Math.abs(area(hex));
  maxGeneratedToHex = Math.max(maxGeneratedToHex, toHex);
  maxHexToGenerated = Math.max(maxHexToGenerated, fromHex);
  maxRelativeAreaError = Math.max(maxRelativeAreaError, relativeAreaError);
  if (toHex > 0.01 || fromHex > 0.01 || relativeAreaError > 0.001) {
    fail(`final endpoint differs from hex (distances ${toHex.toFixed(4)}/${fromHex.toFixed(4)}, area error ${relativeAreaError.toExponential(2)})`);
  }
}

console.log(JSON.stringify({
  input: INPUT,
  districts: source.length,
  generated: Object.keys(generated.districts).length,
  coverage: generated.coverage,
  maxGeneratedToHex,
  maxHexToGenerated,
  maxRelativeAreaError,
  failures: failures.length,
}, null, 2));

if (failures.length) {
  for (const failure of failures.slice(0, 30)) console.error(failure);
  process.exitCode = 1;
}
