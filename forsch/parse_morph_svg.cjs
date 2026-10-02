// Turns the morph.svg written by their MorphApp back into keyframes in the screen
// coordinates of index.html, and checks the result.
//
//   node parse_morph_svg.cjs            reads out/morph.svg, writes out/forsch_frames.json
//
// Two things in StateLineWriter are undone here:
//   - y is stored as (envelope minY - y), so y = minY - y_svg
//   - MorphApp pads the animation with a 20% hold at both ends (setDelay(1/5)),
//     so the first and last values are dropped and t = (keyTime - 0.2) / 0.6
// Then the squash from prep_input.cjs is reversed with input/transform.json.
const fs = require("fs");
const dir = __dirname;
const svg = fs.readFileSync(dir + "/out/morph.svg", "utf8");
const tf = JSON.parse(fs.readFileSync(dir + "/input/transform.json", "utf8"));
const readWkt = (f) => fs.readFileSync(dir + "/input/" + f, "utf8").trim()
  .replace(/^LINEARRING \(/, "").replace(/\)$/, "").split(", ").map((s) => s.split(" ").map(Number));
const S = readWkt("source.wkt").slice(0, -1), H = readWkt("target.wkt").slice(0, -1);

const anims = [...svg.matchAll(/<animate\b([^>]*?)\/?>/g)].map((m) => m[1]);
if (anims.length !== 1) throw new Error(`expected one <animate>, found ${anims.length}`);
const attr = (s, name) => { const m = s.match(new RegExp(`\\b${name}="([^"]*)"`)); if (!m) throw new Error(`no ${name}`); return m[1]; };
let keyTimes = attr(anims[0], "keyTimes").split(";").map(Number);
let values = attr(anims[0], "values").split(";").map((s) => s.trim()).filter(Boolean)
  .map((s) => s.split(",").map((p) => p.trim().split(/\s+/).map(Number)));
if (keyTimes.length !== values.length) throw new Error(`${keyTimes.length} keyTimes but ${values.length} values`);

// Undo the 20% hold at both ends.
const DELAY = 0.2;
const same = (a, b) => a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);
if (keyTimes[0] === 0 && keyTimes[keyTimes.length - 1] === 1 && same(values[0], values[1]) && same(values.at(-1), values.at(-2))) {
  keyTimes = keyTimes.slice(1, -1).map((k) => (k - DELAY) / (1 - 2 * DELAY));
  values = values.slice(1, -1);
} else throw new Error("animation does not have the expected hold at both ends");

// Undo the y flip. minY of the global envelope = lowest y of source and target.
const minY = Math.min(...S.map((p) => p[1]), ...H.map((p) => p[1]));
const states = values.map((st) => st.map(([x, ys]) => [x, minY - ys]));

// Check: the first state passes through every source vertex, the last through every target vertex.
const covers = (state, ring) => ring.every((q) => state.some((p) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-4));
const counts = new Set(states.map((s) => s.length));
const report = {
  keyframes: states.length,
  pointsPerState: [...counts],
  firstIsSource: covers(states[0], S),
  lastIsTarget: covers(states.at(-1), H),
  keyTimesIncreasing: keyTimes.every((k, i) => i === 0 || k >= keyTimes[i - 1]),
  keyTimeRange: [keyTimes[0], keyTimes.at(-1)],
};

// Check: every edge of every state is octilinear (in the squashed space the code ran in).
let worst = 0;
for (const st of states) for (let i = 0; i + 1 < st.length; i++) {
  const dx = st[i + 1][0] - st[i][0], dy = st[i + 1][1] - st[i][1];
  if (Math.hypot(dx, dy) < 1e-6) continue;
  const a = Math.atan2(dy, dx) * 180 / Math.PI, off = Math.abs(a - 45 * Math.round(a / 45));
  worst = Math.max(worst, off);
}
report.worstAngleOffDeg = +worst.toFixed(6);

// Squashed space -> screen space (y down), still on the hexagon placed inside the district.
const K = tf.k, [CX, CY] = tf.centroid;
const toScreen = ([X, Y]) => [X / K + CX, -Y + CY];
const r3 = (v) => Math.round(v * 1000) / 1000;
const screenStates = states.map((st) => st.map((p) => toScreen(p).map(r3)));
const hexCorners = tf.hexCorners, hexCenter = tf.hexCenter, placed = tf.placedHexCenter;
const out = {
  keyTimes: keyTimes.map((k) => +k.toFixed(9)),
  states: screenStates,
  slide: [hexCenter[0] - placed[0], hexCenter[1] - placed[1]].map(r3),
  placedHex: hexCorners.map(([x, y]) => [x - hexCenter[0] + placed[0], y - hexCenter[1] + placed[1]].map(r3)),
  schematic: S.map((p) => toScreen(p).map(r3)),
  report,
};
fs.writeFileSync(dir + "/out/forsch_frames.json", JSON.stringify(out));
console.log(JSON.stringify(report, null, 1));
