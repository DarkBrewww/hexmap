// Prepares Kansas's 1st for the code of Forsch et al. (octilinear mode).
//
// Input: input/kansas_1st_screen.json, the district's outline and its hexagon in the
// screen coordinates of index.html (geoAlbersUsa, hex grid fitted onto the map).
// Output (with "write"): input/source.wkt, input/target.wkt, input/transform.json.
//
//   node prep_input.cjs 0.4 0.5 write  (Douglas-Peucker tolerance, shortest segment; about 50 segments)
//
// Their code only knows rectilinear and octilinear directions. Squashing x by tan(30°)
// turns the hexagon's slanted sides into 45° sides, so the hexagon becomes octilinear.
// We schematize the district octilinearly in that squashed space, run their code there,
// and stretch the result back. In screen space the allowed directions are then
// 0°, 30°, 90° and 150° (and their opposites): the hexagon's three plus horizontal.
const fs = require("fs");
const d = JSON.parse(fs.readFileSync(__dirname + "/input/kansas_1st_screen.json", "utf8"));
const NAME = d.name;
const K = Math.tan(Math.PI / 6);

const area = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
let main = d.rings.reduce((b, r) => (Math.abs(area(r)) > Math.abs(area(b)) ? r : b));
// planar area centroid of the projected outline (screen coords, y down)
let A = 0, CX = 0, CY = 0;
for (let i = 0; i < main.length; i++) { const p = main[i], q = main[(i + 1) % main.length]; const c = p[0] * q[1] - q[0] * p[1]; A += c; CX += (p[0] + q[0]) * c; CY += (p[1] + q[1]) * c; }
A /= 2; CX /= 6 * A; CY /= 6 * A;

const T = ([x, y]) => [(x - CX) * K, -(y - CY)];       // screen -> squashed, y up, centred on the district
const Tinv = ([X, Y]) => [X / K + CX, -Y + CY];

let P = main.map(T);
if (area(P) < 0) P.reverse();                         // counter-clockwise in y-up space
const hexRel = d.corners.map(([x, y]) => [x - d.center[0], y - d.center[1]]);
let H = hexRel.map(([dx, dy]) => [dx * K, -dy]);       // hexagon placed on the district's centroid
if (area(H) < 0) H.reverse();

// Douglas-Peucker on a closed ring (split at vertex 0 and the vertex farthest from it).
function dp(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let idx = -1, best = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-12;
    const dist = Math.abs(dx * (a[1] - p[1]) - dy * (a[0] - p[0])) / L;
    if (dist > best) { best = dist; idx = i; }
  }
  if (best <= tol) return [a, b];
  const left = dp(pts.slice(0, idx + 1), tol), right = dp(pts.slice(idx), tol);
  return left.slice(0, -1).concat(right);
}
function dpRing(ring, tol) {
  let far = 0, fd = -1;
  for (let i = 1; i < ring.length; i++) { const dd = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]); if (dd > fd) { fd = dd; far = i; } }
  const a = dp(ring.slice(0, far + 1), tol), b = dp(ring.slice(far).concat([ring[0]]), tol);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

// Octilinear staircase: replace each edge by at most two octilinear segments.
const DIRS = Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)]);
function octilinearize(ring, minLen) {
  const out = [ring[0].slice()];
  let cur = ring[0].slice();
  const n = ring.length;
  for (let i = 1; i <= n; i++) {
    const target = ring[i % n];
    const last = i === n;
    const vx = target[0] - cur[0], vy = target[1] - cur[1];
    if (Math.hypot(vx, vy) < 1e-9) continue;
    let th = Math.atan2(vy, vx); if (th < 0) th += 2 * Math.PI;
    const k = Math.floor(th / (Math.PI / 4)) % 8, k2 = (k + 1) % 8;
    const [ax, ay] = DIRS[k], [bx, by] = DIRS[k2];
    const det = ax * by - ay * bx;
    let a = (vx * by - vy * bx) / det, b = (ax * vy - ay * vx) / det;   // v = a*dk + b*dk2, a,b >= 0
    if (!last && b < minLen && a >= b) b = 0;                          // drop tiny pieces (vertex moves < minLen)
    else if (!last && a < minLen && b > a) a = 0;
    const c1 = [cur[0] + a * ax, cur[1] + a * ay], c2 = [cur[0] + b * bx, cur[1] + b * by];
    // put the corner on the outside (right side of the edge for a CCW ring)
    const cross = (c) => vx * (c[1] - cur[1]) - vy * (c[0] - cur[0]);
    const firstIsA = a > 0 && b > 0 ? cross(c1) <= cross(c2) : a > 0;
    const steps = firstIsA ? [[a, ax, ay], [b, bx, by]] : [[b, bx, by], [a, ax, ay]];
    for (const [len, ux, uy] of steps) if (len > 1e-9) { cur = [cur[0] + len * ux, cur[1] + len * uy]; out.push(cur.slice()); }
  }
  out.pop(); // last point equals the first
  // merge collinear runs
  const dir = (p, q) => { let th = Math.atan2(q[1] - p[1], q[0] - p[0]); if (th < 0) th += 2 * Math.PI; return Math.round(th / (Math.PI / 4)) % 8; };
  let changed = true, r = out;
  while (changed) {
    changed = false;
    const m = r.length, keep = [];
    for (let i = 0; i < m; i++) {
      const p = r[(i - 1 + m) % m], q = r[i], s = r[(i + 1) % m];
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9 || dir(p, q) === dir(q, s)) { changed = true; continue; }
      keep.push(q);
    }
    r = keep;
  }
  return r;
}
function selfCrossing(r) {
  const m = r.length;
  const o = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) {
    if (j === i + 1 || (i === 0 && j === m - 1)) continue;
    const a = r[i], b = r[(i + 1) % m], c = r[j], e = r[(j + 1) % m];
    const o1 = o(a, b, c), o2 = o(a, b, e), o3 = o(c, e, a), o4 = o(c, e, b);
    if (o1 * o2 <= 0 && o3 * o4 <= 0 && Math.max(Math.abs(o1), Math.abs(o2), Math.abs(o3), Math.abs(o4)) > 1e-12) {
      // collinear-disjoint pairs give all zeros; anything else touching or crossing counts
      if (!(o1 === 0 && o2 === 0)) return [i, j];
    }
  }
  return null;
}
function pointInRing(p, r) { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) ins = !ins; } return ins; }

const tol = +(process.argv[2] || 0.5), minLen = +(process.argv[3] || 0.25);
const simp = dpRing(P, tol);
let S = octilinearize(simp, minLen);
if (area(S) < 0) S.reverse();
// Remove leftover pieces shorter than minLen: extend the two neighbouring segments to
// where their lines meet (only when they are not parallel and the corner stays close).
function removeShort(r) {
  for (let pass = 0; pass < 100; pass++) {
    const m = r.length;
    let k = -1, kl = Infinity;
    for (let i = 0; i < m; i++) { const p = r[i], q = r[(i + 1) % m], L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L < minLen && L < kl) { kl = L; k = i; } }
    if (k < 0) return r;
    const a = r[(k - 1 + m) % m], b = r[k], c = r[(k + 1) % m], e = r[(k + 2) % m];
    const d1 = [b[0] - a[0], b[1] - a[1]], d2 = [e[0] - c[0], e[1] - c[1]];
    const den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-9) { console.log("short segment between parallel neighbours left in place:", k, kl.toFixed(2)); return r; }
    const t = ((c[0] - a[0]) * d2[1] - (c[1] - a[1]) * d2[0]) / den;
    const X = [a[0] + t * d1[0], a[1] + t * d1[1]];
    const s2 = ((X[0] - c[0]) * d2[0] + (X[1] - c[1]) * d2[1]) / (d2[0] * d2[0] + d2[1] * d2[1]);
    if (t <= 0 || s2 >= 1 || Math.hypot(X[0] - b[0], X[1] - b[1]) > 3 * minLen) { console.log("could not remove short segment", k, kl.toFixed(2)); return r; }
    r = r.slice();
    r[k] = X; r.splice((k + 1) % m, 1);
  }
  return r;
}
S = removeShort(S);
const cross = selfCrossing(S);

// Place the hexagon where it has the most room inside the outline (largest clearance,
// measured in screen units). The paper's nested case needs the target fully inside.
const toScreen = ([X, Y]) => [X / K, Y];
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  let t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function clearance(outer, inner) {
  let best = Infinity;
  for (const p of inner) for (let i = 0; i < outer.length; i++) best = Math.min(best, segDist(p, outer[i], outer[(i + 1) % outer.length]));
  for (const p of outer) for (let i = 0; i < inner.length; i++) best = Math.min(best, segDist(p, inner[i], inner[(i + 1) % inner.length]));
  return best;
}
const H0 = H;
const S_scr = S.map(toScreen);
let bestC = [0, 0], bestClr = -1;
const xs = S.map((p) => p[0]), ys = S.map((p) => p[1]);
for (let X = Math.min(...xs); X <= Math.max(...xs); X += 0.1) for (let Y = Math.min(...ys); Y <= Math.max(...ys); Y += 0.2) {
  const Hc = H0.map(([x, y]) => [x + X, y + Y]);
  if (!Hc.every((h) => pointInRing(h, S))) continue;
  const clr = clearance(S_scr, Hc.map(toScreen));
  if (clr > bestClr && S.every((p) => !pointInRing(p, Hc))) { bestClr = clr; bestC = [X, Y]; }
}
H = H0.map(([x, y]) => [x + bestC[0], y + bestC[1]]);
const hexInside = H.every((h) => pointInRing(h, S));
// Cut location. Their code cuts closed outlines at the first vertex of each ring and
// joins the two cuts with a straight line, along which the first and last vertex travel.
// The paper picks the closest vertex pair and asks for a schematic cut line. So: from
// each hexagon corner, shoot a ray in each of the 8 directions (away from the hexagon)
// and take the shortest ray that reaches the outline away from its corners. The hit
// point becomes a new vertex of the outline (on an existing edge, so the shape is
// unchanged) and both rings start there.
const DIR8 = Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)]);
function rayHit(o, d, ring) {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], ex = b[0] - a[0], ey = b[1] - a[1];
    const den = d[0] * ey - d[1] * ex;
    if (Math.abs(den) < 1e-12) continue;
    const s = ((a[0] - o[0]) * ey - (a[1] - o[1]) * ex) / den, u = ((a[0] - o[0]) * d[1] - (a[1] - o[1]) * d[0]) / den;
    if (s > 1e-9 && u >= 0 && u <= 1 && (!best || s < best.s)) best = { s, i, u, len: Math.hypot(ex, ey) };
  }
  return best;
}
let cut = null;
H.forEach((h, j) => DIR8.forEach((d, k) => {
  if (pointInRing([h[0] + 1e-3 * d[0], h[1] + 1e-3 * d[1]], H)) return;           // ray would enter the hexagon
  const hh = rayHit(h, d, H); if (hh && hh.s > 1e-6) return;                        // ray crosses the hexagon later
  const hit = rayHit(h, d, S); if (!hit) return;
  const room = Math.min(hit.u, 1 - hit.u) * hit.len;                               // distance to the edge's corners
  if (room < minLen / 2) return;
  if (!cut || hit.s < cut.s) cut = { s: hit.s, i: hit.i, j, k, p: [h[0] + hit.s * d[0], h[1] + hit.s * d[1]] };
}));
if (!cut) throw new Error("no schematic cut line found");
S = S.slice(0, cut.i + 1).concat([cut.p], S.slice(cut.i + 1));
const bi = cut.i + 1, bj = cut.j, bd = cut.s;
S = S.slice(bi).concat(S.slice(0, bi));
H = H.slice(bj).concat(H.slice(0, bj));
const hist = {};
for (let i = 0; i < S.length; i++) { const p = S[i], q = S[(i + 1) % S.length]; let th = Math.atan2(q[1] - p[1], q[0] - p[0]) * 180 / Math.PI; th = ((Math.round(th) % 180) + 180) % 180; hist[th] = (hist[th] || 0) + 1; }
console.log(`tol ${tol}, minLen ${minLen}: outline ${P.length} -> simplified ${simp.length} -> octilinear ${S.length} segments; self-crossing: ${cross ? cross : "none"}; hex inside: ${hexInside}; hex offset ${bestC.map((v) => v.toFixed(2))} (clearance ${bestClr.toFixed(2)} px); cut line ${bd.toFixed(2)} long at ${cut.k * 45}°; directions (squashed space) ${JSON.stringify(hist)}`);
const f6 = (v) => (Math.round(v * 1e6) / 1e6).toString();
const wkt = (r) => "LINEARRING (" + r.concat([r[0]]).map(([x, y]) => f6(x) + " " + f6(y)).join(", ") + ")";
if (process.argv[4] === "write") {
  fs.writeFileSync(__dirname + "/input/source.wkt", wkt(S) + "\n");
  fs.writeFileSync(__dirname + "/input/target.wkt", wkt(H) + "\n");
  fs.writeFileSync(__dirname + "/input/transform.json", JSON.stringify({ district: NAME, tolerance: tol, minLen, k: K, centroid: [CX, CY], hexCenter: d.center, hexCorners: d.corners, hexOffsetSquashed: bestC, placedHexCenter: Tinv(bestC), originalRing: main, note: "screen -> squashed: X = (x - cx) * k, Y = -(y - cy). Inverse: x = X / k + cx, y = -Y + cy." }));
  console.log("written");
}
