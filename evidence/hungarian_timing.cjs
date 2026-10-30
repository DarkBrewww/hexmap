// How long Paul's assignment step (hex-layouts/engine.js, hungarian) takes at district and county size.
//   node hungarian_timing.cjs [sizes...]        default: 436 3142
// Random points and random cells in a square; cost = squared distance, as in his generator.
// The assignment is the step whose cost grows with the cube of the count (engine.js says O(n^3)).
const path = require("path");
const E = require(path.join(__dirname, "..", "hex-layouts", "engine.js"));
const sizes = process.argv.slice(2).map(Number).filter(Boolean);
let seed = 1;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
for (const n of sizes.length ? sizes : [436, 3142]) {
  const pts = Array.from({length: n}, () => [rand(), rand()]);
  const cells = Array.from({length: n}, () => [rand(), rand()]);
  const cost = pts.map(p => Float64Array.from(cells, c => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2));
  const t0 = Date.now();
  const a = E.hungarian(cost);
  const s = (Date.now() - t0) / 1000;
  if (new Set(a).size !== n) throw new Error("not a one-to-one assignment");
  console.log(`n = ${n}: one assignment took ${s.toFixed(2)} s`);
}
