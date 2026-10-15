// Precompute a Forsch-derived morph for every main district outline.
//
// This is deliberately an offline build. The author's Java MorphApp cannot run
// in the browser, so index.html only replays the compact keyframes written to
// ../forsch_map_data.js.
//
// Usage (from the repository root):
//   node forsch/build_full_map.cjs --limit=5 --jobs=2
//   node forsch/build_full_map.cjs --jobs=4
// A limited run writes under forsch/fullmap_work unless --output is supplied;
// only a full run replaces ../forsch_map_data.js.
//
// The Census outlines are not schematic and many districts are smaller than a
// display hex. We therefore:
//   1. schematize the main ring in the same squashed octilinear space as the
//      Kansas experiment;
//   2. enlarge that schematic source, when necessary, until a standard-size
//      target hex fits inside it;
//   3. run the unmodified publication MorphApp;
//   4. store the algorithm's screen-space keyframes plus sourceScale. During
//      playback index.html continuously removes that enlargement at t=0 and
//      reaches scale 1 at t=1, while sliding the inner hex to its grid cell.
//
// The positive similarity transform preserves allowed directions and whether
// one outline self-crosses. It does NOT preserve the paper's screen-space
// self-contained or constant-velocity guarantees, hence the UI calls this a
// "Forsch hybrid" rather than the strict four-constraint method.

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const HERE = __dirname;
const ROOT = path.resolve(HERE, "..");
const WORK = path.join(HERE, "fullmap_work");
const RESULTS = path.join(WORK, "results");
const CLASS = "de.geoinfobonn.traveltimemaps.schematicmorph.MorphApp";
const K = Math.tan(Math.PI / 6);
const DIRS = Array.from({ length: 8 }, (_, k) => [Math.cos(k * Math.PI / 4), Math.sin(k * Math.PI / 4)]);
// Include sub-pixel tolerances for very small projected districts (for
// example Manhattan).  Larger outlines quickly fall through to the original
// tolerance range.
const ATTEMPTS = [0.4, 0.6, 0.85, 1.2, 1.7, 2.4, 3.5, 5, 8, 0.02, 0.05, 0.1, 0.2]
  .map((tolerance) => ({ tolerance, hull: false }))
  .concat([0.4, 1, 2].map((tolerance) => ({ tolerance, hull: true })));

const args = Object.fromEntries(process.argv.slice(2).map((s) => {
  const m = s.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [s, true];
}));
const LIMIT = Math.max(0, +(args.limit || 0));
const JOBS = Math.max(1, +(args.jobs || 2));
const RETRY = !!args.retry;
const OUTPUT = args.output
  ? path.resolve(String(args.output))
  : LIMIT
    ? path.join(WORK, `forsch_map_data.limit-${LIMIT}.js`)
    : path.join(ROOT, "forsch_map_data.js");

function updateTreeHash(hash, directory) {
  if (!fs.existsSync(directory)) { hash.update(`missing:${directory}\n`); return; }
  const files = [];
  (function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(full);
    }
  })(directory);
  files.sort();
  for (const file of files) {
    hash.update(path.relative(directory, file).replace(/\\/g, "/") + "\0");
    hash.update(fs.readFileSync(file));
  }
}

function buildFingerprint() {
  const hash = crypto.createHash("sha256");
  hash.update("forsch-full-map-cache-v2\0");
  hash.update(fs.readFileSync(__filename));
  updateTreeHash(hash, path.join(HERE, "build", "classes"));
  updateTreeHash(hash, path.join(HERE, "lib"));
  return hash.digest("hex");
}

const BUILD_FINGERPRINT = buildFingerprint();
const districtCacheKey = (district) => crypto.createHash("sha256")
  .update(BUILD_FINGERPRINT).update("\0").update(JSON.stringify(district)).digest("hex");

function readCache(file, key, field) {
  if (!fs.existsSync(file)) return null;
  try {
    const cached = JSON.parse(fs.readFileSync(file, "utf8"));
    return cached.cacheKey === key && cached[field] ? cached[field] : null;
  } catch (_) {
    return null;
  }
}

function findJava() {
  if (args.java) return path.resolve(String(args.java));
  if (process.env.JAVA_HOME) {
    const candidate = path.join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java");
    if (fs.existsSync(candidate)) return candidate;
  }
  const portable = path.resolve(ROOT, "..", "tools", "temurin11");
  if (fs.existsSync(portable)) {
    for (const name of fs.readdirSync(portable)) {
      const candidate = path.join(portable, name, "bin", process.platform === "win32" ? "java.exe" : "java");
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return "java";
}

const JAVA = findJava();
const CLASSPATH = [path.join(HERE, "build", "classes"), path.join(HERE, "lib", "*")].join(path.delimiter);

function readDistricts() {
  const html = fs.readFileSync(path.join(ROOT, "district_morph.html"), "utf8");
  const match = html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/);
  if (!match) throw new Error("district_morph.html has no embedded #data JSON");
  return JSON.parse(match[1]);
}

function area(r) {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function centroid(r) {
  let twice = 0, x = 0, y = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length], c = p[0] * q[1] - q[0] * p[1];
    twice += c; x += (p[0] + q[0]) * c; y += (p[1] + q[1]) * c;
  }
  if (Math.abs(twice) > 1e-12) return [x / (3 * twice), y / (3 * twice)];
  const xs = r.map((p) => p[0]), ys = r.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

function dp(points, tolerance) {
  if (points.length < 3) return points.slice();
  const a = points[0], b = points[points.length - 1];
  let index = -1, best = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i], dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy) || 1e-12;
    const distance = Math.abs(dx * (a[1] - p[1]) - dy * (a[0] - p[0])) / length;
    if (distance > best) { best = distance; index = i; }
  }
  if (best <= tolerance) return [a, b];
  const left = dp(points.slice(0, index + 1), tolerance), right = dp(points.slice(index), tolerance);
  return left.slice(0, -1).concat(right);
}

function dpRing(ring, tolerance) {
  let far = 0, distance = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > distance) { distance = d; far = i; }
  }
  const a = dp(ring.slice(0, far + 1), tolerance);
  const b = dp(ring.slice(far).concat([ring[0]]), tolerance);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

function octilinearize(ring, minLength) {
  const out = [ring[0].slice()];
  let current = ring[0].slice();
  for (let i = 1; i <= ring.length; i++) {
    const target = ring[i % ring.length], last = i === ring.length;
    const vx = target[0] - current[0], vy = target[1] - current[1];
    if (Math.hypot(vx, vy) < 1e-9) continue;
    let angle = Math.atan2(vy, vx); if (angle < 0) angle += 2 * Math.PI;
    const k = Math.floor(angle / (Math.PI / 4)) % 8, k2 = (k + 1) % 8;
    const [ax, ay] = DIRS[k], [bx, by] = DIRS[k2], det = ax * by - ay * bx;
    let da = (vx * by - vy * bx) / det, db = (ax * vy - ay * vx) / det;
    if (!last && db < minLength && da >= db) db = 0;
    else if (!last && da < minLength && db > da) da = 0;
    const c1 = [current[0] + da * ax, current[1] + da * ay];
    const c2 = [current[0] + db * bx, current[1] + db * by];
    const cross = (c) => vx * (c[1] - current[1]) - vy * (c[0] - current[0]);
    const firstA = da > 0 && db > 0 ? cross(c1) <= cross(c2) : da > 0;
    const steps = firstA ? [[da, ax, ay], [db, bx, by]] : [[db, bx, by], [da, ax, ay]];
    for (const [length, ux, uy] of steps) if (length > 1e-9) {
      current = [current[0] + length * ux, current[1] + length * uy];
      out.push(current.slice());
    }
  }
  out.pop();
  const direction = (p, q) => {
    let angle = Math.atan2(q[1] - p[1], q[0] - p[0]); if (angle < 0) angle += 2 * Math.PI;
    return Math.round(angle / (Math.PI / 4)) % 8;
  };
  let result = out, changed = true;
  while (changed && result.length >= 3) {
    changed = false;
    const keep = [], m = result.length;
    for (let i = 0; i < m; i++) {
      const p = result[(i - 1 + m) % m], q = result[i], s = result[(i + 1) % m];
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9 || direction(p, q) === direction(q, s)) { changed = true; continue; }
      keep.push(q);
    }
    result = keep;
  }
  return result;
}

function removeShort(ring, minLength) {
  let result = ring;
  for (let pass = 0; pass < 100 && result.length > 6; pass++) {
    const m = result.length;
    let index = -1, shortest = Infinity;
    for (let i = 0; i < m; i++) {
      const p = result[i], q = result[(i + 1) % m], length = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (length < minLength && length < shortest) { shortest = length; index = i; }
    }
    if (index < 0) return result;
    const a = result[(index - 1 + m) % m], b = result[index], c = result[(index + 1) % m], d = result[(index + 2) % m];
    const d1 = [b[0] - a[0], b[1] - a[1]], d2 = [d[0] - c[0], d[1] - c[1]];
    const denominator = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(denominator) < 1e-9) return result;
    const t = ((c[0] - a[0]) * d2[1] - (c[1] - a[1]) * d2[0]) / denominator;
    const x = [a[0] + t * d1[0], a[1] + t * d1[1]];
    const s = ((x[0] - c[0]) * d2[0] + (x[1] - c[1]) * d2[1]) / (d2[0] ** 2 + d2[1] ** 2);
    if (t <= 0 || s >= 1 || Math.hypot(x[0] - b[0], x[1] - b[1]) > 3 * minLength) return result;
    result = result.slice(); result[index] = x; result.splice((index + 1) % m, 1);
  }
  return result;
}

function orient(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
function properIntersection(a, b, c, d) {
  return orient(a, b, c) * orient(a, b, d) < -1e-12 && orient(c, d, a) * orient(c, d, b) < -1e-12;
}
function onSegment(a, b, p) {
  return Math.abs(orient(a, b, p)) < 1e-9 && p[0] >= Math.min(a[0], b[0]) - 1e-9 && p[0] <= Math.max(a[0], b[0]) + 1e-9 && p[1] >= Math.min(a[1], b[1]) - 1e-9 && p[1] <= Math.max(a[1], b[1]) + 1e-9;
}
function segmentsIntersect(a, b, c, d) {
  if (properIntersection(a, b, c, d)) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}
function selfCrossing(ring) {
  for (let i = 0; i < ring.length; i++) for (let j = i + 1; j < ring.length; j++) {
    if (j === i + 1 || (i === 0 && j === ring.length - 1)) continue;
    if (segmentsIntersect(ring[i], ring[(i + 1) % ring.length], ring[j], ring[(j + 1) % ring.length])) return true;
  }
  return false;
}
function cleanRing(input) {
  let ring = input.slice(), changed = true;
  while (changed && ring.length > 3) {
    changed = false;
    const keep = [], m = ring.length;
    for (let i = 0; i < m; i++) {
      const p = ring[(i - 1 + m) % m], q = ring[i], r = ring[(i + 1) % m];
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-8 || Math.abs(orient(p, q, r)) < 1e-8) { changed = true; continue; }
      keep.push(q);
    }
    ring = keep;
  }
  return ring;
}
function convexHull(points) {
  const sorted = points.map((p) => p.slice()).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const unique = sorted.filter((p, i) => !i || Math.hypot(p[0] - sorted[i - 1][0], p[1] - sorted[i - 1][1]) > 1e-9);
  if (unique.length < 4) return unique;
  const half = [];
  for (const p of unique) {
    while (half.length >= 2 && orient(half.at(-2), half.at(-1), p) <= 1e-10) half.pop();
    half.push(p);
  }
  const lower = half.slice(); half.length = 0;
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i];
    while (half.length >= 2 && orient(half.at(-2), half.at(-1), p) <= 1e-10) half.pop();
    half.push(p);
  }
  return lower.slice(0, -1).concat(half.slice(0, -1));
}
function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function polygonsCross(a, b) {
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    if (properIntersection(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
  }
  return false;
}

function bestInnerHex(source, baseHex) {
  const xs = source.map((p) => p[0]), ys = source.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const candidates = [centroid(source), [xs.reduce((a, b) => a + b, 0) / xs.length, ys.reduce((a, b) => a + b, 0) / ys.length], [(minX + maxX) / 2, (minY + maxY) / 2]];
  const grid = 15;
  for (let iy = 1; iy < grid; iy++) for (let ix = 1; ix < grid; ix++) {
    candidates.push([minX + (maxX - minX) * ix / grid, minY + (maxY - minY) * iy / grid]);
  }
  const fits = (center, scale) => {
    const hex = baseHex.map(([x, y]) => [center[0] + scale * x, center[1] + scale * y]);
    return hex.every((p) => pointInRing(p, source)) && !polygonsCross(source, hex);
  };
  let best = null;
  for (const c of candidates) {
    if (!pointInRing(c, source)) continue;
    let lo = 0, hi = 1;
    for (let k = 0; k < 14; k++) {
      const mid = (lo + hi) / 2;
      if (fits(c, mid)) lo = mid; else hi = mid;
    }
    if (!best || lo > best.scale) best = { center: c, scale: lo };
  }
  if (!best || best.scale < 0.005) throw new Error("no interior target placement");
  best.scale = Math.min(1, best.scale * 0.90);
  return best;
}

function rayHit(origin, direction, ring) {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], ex = b[0] - a[0], ey = b[1] - a[1];
    const denominator = direction[0] * ey - direction[1] * ex;
    if (Math.abs(denominator) < 1e-12) continue;
    const s = ((a[0] - origin[0]) * ey - (a[1] - origin[1]) * ex) / denominator;
    const u = ((a[0] - origin[0]) * direction[1] - (a[1] - origin[1]) * direction[0]) / denominator;
    if (s > 1e-8 && u >= 0 && u <= 1 && (!best || s < best.s)) best = { s, i, u, length: Math.hypot(ex, ey) };
  }
  return best;
}

function cutRings(source, target) {
  let cut = null;
  target.forEach((h, j) => DIRS.forEach((direction, k) => {
    if (pointInRing([h[0] + 1e-4 * direction[0], h[1] + 1e-4 * direction[1]], target)) return;
    const later = rayHit(h, direction, target); if (later && later.s > 1e-6) return;
    const hit = rayHit(h, direction, source); if (!hit) return;
    const room = Math.min(hit.u, 1 - hit.u) * hit.length;
    if (room < 0.02) return;
    if (!cut || hit.s < cut.s) cut = { s: hit.s, i: hit.i, j, point: [h[0] + hit.s * direction[0], h[1] + hit.s * direction[1]] };
  }));
  if (!cut) throw new Error("no schematic cut line");
  let s = source.slice(0, cut.i + 1).concat([cut.point], source.slice(cut.i + 1));
  s = s.slice(cut.i + 1).concat(s.slice(0, cut.i + 1));
  const h = target.slice(cut.j).concat(target.slice(0, cut.j));
  return { source: s, target: h, cutLength: cut.s };
}

function f6(v) { return (Math.round(v * 1e6) / 1e6).toString(); }
function wkt(ring) { return "LINEARRING (" + ring.concat([ring[0]]).map(([x, y]) => `${f6(x)} ${f6(y)}`).join(", ") + ")\n"; }
function round3(v) { return Math.round(v * 1000) / 1000; }

function prepare(district, tolerance, useHull) {
  let main = district.r.reduce((best, ring) => Math.abs(area(ring)) > Math.abs(area(best)) ? ring : best);
  const [cx, cy] = centroid(main);
  const transform = ([x, y]) => [(x - cx) * K, -(y - cy)];
  let raw = main.map(transform);
  if (area(raw) < 0) raw.reverse();
  const relativeHex = district.k.map(([x, y]) => [(x - district.c[0]) * K, -(y - district.c[1])]);
  if (area(relativeHex) < 0) relativeHex.reverse();
  const simplified = useHull ? dpRing(convexHull(raw), tolerance) : dpRing(raw, tolerance);
  const minSegment = Math.min(0.25, Math.max(0.005, tolerance / 2));
  let schematic = cleanRing(removeShort(octilinearize(simplified, minSegment), minSegment));
  if (area(schematic) < 0) schematic.reverse();
  // The publication algorithm accepts source and target polylines with
  // different segment counts.  In particular, a four- or five-segment
  // schematic source can legitimately morph to the six-segment target hex.
  // We only need a non-degenerate polygon here; requiring six source
  // segments unnecessarily rejected compact Manhattan districts.
  if (schematic.length < 3) throw new Error("schematic source has fewer than 3 segments");
  if (schematic.length > 100) throw new Error("schematic source has more than 100 segments");
  if (selfCrossing(schematic)) throw new Error("schematic source self-crosses");
  const placement = bestInnerHex(schematic, relativeHex);
  const sourceScale = 1 / placement.scale;
  const source = schematic.map(([x, y]) => [x * sourceScale, y * sourceScale]);
  const placed = [placement.center[0] * sourceScale, placement.center[1] * sourceScale];
  const target = relativeHex.map(([x, y]) => [x + placed[0], y + placed[1]]);
  if (!target.every((p) => pointInRing(p, source)) || polygonsCross(source, target)) throw new Error("scaled target is not nested");
  const cut = cutRings(source, target);
  const toScreen = ([x, y]) => [x / K + cx, -y + cy];
  const placedCenter = toScreen(placed);
  return {
    source: cut.source,
    target: cut.target,
    originalSource: schematic,
    sourceCenter: [cx, cy],
    placedCenter,
    targetCenter: district.c,
    slide: [district.c[0] - placedCenter[0], district.c[1] - placedCenter[1]],
    sourceScale,
    tolerance,
    preprocessing: useHull ? "convex-hull fallback" : "outline",
    transform: { cx, cy },
    sourceSegments: schematic.length,
    cutLength: cut.cutLength,
  };
}

function attribute(text, name) {
  const match = text.match(new RegExp(`\\b${name}="([^"]*)"`));
  if (!match) throw new Error(`morph.svg has no ${name}`);
  return match[1];
}

function parseStats(file) {
  if (!fs.existsSync(file)) return {};
  const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  if (lines.length < 2) return {};
  const head = lines[0].split(","), values = lines[lines.length - 1].split(","), get = (name) => values[head.indexOf(name)];
  const number = (name) => { const v = +get(name); return Number.isFinite(v) ? v : null; };
  return {
    matches: number("NUMBER_OF_MATCHES"),
    insertions: number("NUMBER_OF_INSERTIONS"),
    deletions: number("NUMBER_OF_DELETIONS"),
    multiInsertions: number("NUMBER_OF_MULTI_INSERTIONS"),
    multiDeletions: number("NUMBER_OF_MULTI_DELETIONS"),
    transitionCells: number("NUMBER_OF_TRANSITION_CELLS"),
    selfCrossings: get("HAS_SELFCROSSINGS") === "true",
    selfContained: get("IS_SELFCONTAINED") === "true",
  };
}

function parseOutput(prepared, outputDirectory) {
  const svg = fs.readFileSync(path.join(outputDirectory, "morph.svg"), "utf8");
  const animations = [...svg.matchAll(/<animate\b([^>]*?)\/?>/g)].map((m) => m[1]);
  if (animations.length !== 1) throw new Error(`expected one animation, found ${animations.length}`);
  let keyTimes = attribute(animations[0], "keyTimes").split(";").map(Number);
  let values = attribute(animations[0], "values").split(";").map((s) => s.trim()).filter(Boolean)
    .map((s) => s.split(",").map((p) => p.trim().split(/\s+/).map(Number)));
  if (keyTimes.length !== values.length) throw new Error("keyTimes/value count mismatch");
  const same = (a, b) => a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);
  if (keyTimes[0] === 0 && keyTimes.at(-1) === 1 && same(values[0], values[1]) && same(values.at(-1), values.at(-2))) {
    keyTimes = keyTimes.slice(1, -1).map((t) => (t - 0.2) / 0.6);
    values = values.slice(1, -1);
  } else throw new Error("unexpected MorphApp endpoint delay");
  const minY = Math.min(...prepared.source.map((p) => p[1]), ...prepared.target.map((p) => p[1]));
  const { cx, cy } = prepared.transform;
  let states = values.map((state) => state.map(([x, svgY]) => [x / K + cx, -(minY - svgY) + cy]));
  if (states.every((state) => state.length > 1 && Math.hypot(state[0][0] - state.at(-1)[0], state[0][1] - state.at(-1)[1]) < 1e-7)) {
    states = states.map((state) => state.slice(0, -1));
  }
  const lengths = new Set(states.map((state) => state.length));
  if (lengths.size !== 1) throw new Error("keyframes have unequal point counts");
  const flatStates = states.map((state) => state.flatMap(([x, y]) => [round3(x), round3(y)]));
  return {
    // MorphApp deliberately emits pairs of events that can be less than a
    // nanosecond apart.  Nine decimal places collapsed some of those pairs
    // into a zero-duration browser interval, so retain near-double precision.
    keyTimes: keyTimes.map((t) => +t.toFixed(15)),
    states: flatStates,
    sourceCenter: prepared.sourceCenter.map(round3),
    placedCenter: prepared.placedCenter.map(round3),
    targetCenter: prepared.targetCenter.map(round3),
    sourceScale: +prepared.sourceScale.toFixed(6),
    slide: prepared.slide.map(round3),
    sourcePoints: prepared.sourceSegments,
    statePoints: flatStates[0].length / 2,
    keyframes: flatStates.length,
    tolerance: prepared.tolerance,
    preprocessing: prepared.preprocessing,
    cutLength: +prepared.cutLength.toFixed(3),
    stats: parseStats(path.join(outputDirectory, "stats.csv")),
  };
}

async function runOne(district) {
  const resultFile = path.join(RESULTS, district.f + ".json");
  const failureFile = path.join(RESULTS, district.f + ".failure.json");
  const cacheKey = districtCacheKey(district);
  if (!RETRY) {
    const result = readCache(resultFile, cacheKey, "result");
    if (result) return { id: district.f, result, cached: true };
    const failure = readCache(failureFile, cacheKey, "failure");
    if (failure) return { id: district.f, failure, cached: true };
  }
  const errors = [];
  for (let attempt = 0; attempt < ATTEMPTS.length; attempt++) {
    const { tolerance, hull } = ATTEMPTS[attempt];
    try {
      const prepared = prepare(district, tolerance, hull);
      const base = path.join(WORK, "runs", district.f, `attempt-${attempt}`), input = path.join(base, "input"), output = path.join(base, "out");
      fs.mkdirSync(input, { recursive: true }); fs.mkdirSync(output, { recursive: true });
      const sourceFile = path.join(input, "source.wkt"), targetFile = path.join(input, "target.wkt");
      fs.writeFileSync(sourceFile, wkt(prepared.source)); fs.writeFileSync(targetFile, wkt(prepared.target));
      await execFileAsync(JAVA, ["-cp", CLASSPATH, CLASS, "-s", sourceFile, "-t", targetFile, "-o", output, "-S", "OCTILINEAR", "-T", "GEODESIC"], {
        cwd: ROOT, timeout: 120000, maxBuffer: 8 * 1024 * 1024,
      });
      const result = parseOutput(prepared, output);
      fs.writeFileSync(resultFile, JSON.stringify({ cacheKey, result }));
      if (fs.existsSync(failureFile)) fs.unlinkSync(failureFile);
      return { id: district.f, result, cached: false };
    } catch (error) {
      const detail = [error && error.message, error && error.stderr, error && error.stdout].filter(Boolean).join("\n");
      errors.push({ tolerance, hull, message: String(detail || error).slice(-2000) });
    }
  }
  const failure = { name: district.n, errors };
  fs.writeFileSync(failureFile, JSON.stringify({ cacheKey, failure }, null, 2));
  return { id: district.f, failure, cached: false };
}

function classifyFailure(failure) {
  const text = failure.errors.map((e) => e.message).join(" ").toLowerCase();
  if (text.includes("interior target") || text.includes("not nested")) return "nesting";
  if (text.includes("cut line")) return "cut";
  if (text.includes("self-cross")) return "schematization";
  if (text.includes("timeout")) return "timeout";
  if (text.includes("morph.svg") || text.includes("morphapp") || text.includes("command failed")) return "morphApp";
  return "other";
}

async function pool(items, jobs, worker) {
  const output = new Array(items.length);
  let next = 0, finished = 0;
  async function lane() {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await worker(items[index]);
      finished++;
      const value = output[index];
      console.log(`[${finished}/${items.length}] ${items[index].f} ${value.result ? "ok" : "FAILED"}${value.cached ? " (cached)" : ""}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, lane));
  return output;
}

async function main() {
  fs.mkdirSync(RESULTS, { recursive: true });
  const all = readDistricts(), selected = LIMIT ? all.slice(0, LIMIT) : all;
  if (!fs.existsSync(path.join(HERE, "build", "classes"))) throw new Error("Compile Forsch first: forsch/build/classes is missing");
  console.log(`Java: ${JAVA}`);
  console.log(`Districts: ${selected.length}/${all.length}; jobs: ${JOBS}; retry: ${RETRY}`);
  const outcomes = await pool(selected, JOBS, runOne);
  const districts = {}, failures = {}, failuresByType = {};
  for (const outcome of outcomes) {
    if (outcome.result) districts[outcome.id] = outcome.result;
    else {
      failures[outcome.id] = outcome.failure;
      const type = classifyFailure(outcome.failure); failuresByType[type] = (failuresByType[type] || 0) + 1;
    }
  }
  const payload = {
    meta: {
      method: "Forsch-derived full-map hybrid",
      generatedAt: new Date().toISOString(),
      input: "district_morph.html embedded screen-space geometry",
      authorCode: "traveltimemaps publication tag via MorphApp",
      buildFingerprint: BUILD_FINGERPRINT,
      description: "Main rings use MorphApp keyframes. Raw-to-schematic intro, source-scale correction, grid slide and non-main rings are local hybrid layers.",
    },
    coverage: { total: all.length, attempted: selected.length, succeeded: Object.keys(districts).length, failed: Object.keys(failures).length, failuresByType, failures },
    districts,
  };
  const javascript = "window.FORSCH_MAP_DATA=" + JSON.stringify(payload) + ";\n";
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, javascript);
  console.log(`Wrote ${OUTPUT}: ${(Buffer.byteLength(javascript) / 1024 / 1024).toFixed(2)} MiB; ${payload.coverage.succeeded} succeeded, ${payload.coverage.failed} failed`);
  if (payload.coverage.failed) console.log("Failures by type:", JSON.stringify(failuresByType));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
