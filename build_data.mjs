// Builds hexmap_data.js, the data file index.html loads.
//
// Inputs, both in this folder:
//   cb_2024_us_cd119_20m.zip   Census cartographic boundaries, 119th Congress, 1:20M
//   cdhd_hex_119.geojson       CDHD hex layout (see README.md)
//
// Run:
//   npm install
//   npm run build
//
// Output: hexmap_data.js with one feature per district (436). Geometry is the
// Census shape in lon/lat, rounded to 5 decimals. Properties are the hex fields
// from cdhd_hex_119.geojson, so every district carries its own hex, plus
// map_neighbors: the districts it shares a border with on the Census map.

import fs from "node:fs";
import AdmZip from "adm-zip";
import * as shapefile from "shapefile";
import { geoArea } from "d3-geo";

const CENSUS_ZIP = "cb_2024_us_cd119_20m.zip";
const HEX_GEOJSON = "cdhd_hex_119.geojson";
const OUT = "hexmap_data.js";

// American Samoa, Guam, Northern Mariana Islands, Puerto Rico, US Virgin Islands
const DROP_STATES = new Set(["60", "66", "69", "72", "78"]);

// Read the shapefile straight out of the zip.
const zip = new AdmZip(CENSUS_ZIP);
const entry = (ext) => {
  const e = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith(ext));
  if (!e) throw new Error(`${CENSUS_ZIP} has no ${ext} file`);
  return e.getData();
};
const census = await shapefile.read(entry(".shp"), entry(".dbf"), { encoding: "utf-8" });

const byGeoid = new Map();
for (const f of census.features) {
  const { STATEFP, CD119FP, GEOID } = f.properties;
  if (DROP_STATES.has(STATEFP) || CD119FP === "ZZ") continue;
  byGeoid.set(GEOID, f);
}

// Round to 5 decimals (about 1 m) and drop points that rounding made identical
// to their neighbour. 4 decimals was too coarse: it made the outlines of
// Montana's 2nd and Washington's 5th cross themselves.
const round = (v) => Math.round(v * 1e5) / 1e5;
function roundRing(ring) {
  const out = [];
  for (const [x, y] of ring) {
    const p = [round(x), round(y)];
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
  }
  const a = out[0], b = out[out.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) out.push([a[0], a[1]]);
  return out.length >= 4 ? out : null;
}
// Brute-force check that no two non-adjacent edges of a closed ring cross.
function ringCrossesItself(ring) {
  const m = ring.length - 1;
  const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let a = 0; a < m; a++) {
    for (let b = a + 2; b < m; b++) {
      if (a === 0 && b === m - 1) continue;
      const A = ring[a], A2 = ring[a + 1], B = ring[b], B2 = ring[b + 1];
      if (orient(A, A2, B) * orient(A, A2, B2) < 0 && orient(B, B2, A) * orient(B, B2, A2) < 0) return true;
    }
  }
  return false;
}
function roundGeometry(g) {
  const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates)
    .map((rings) => rings.map(roundRing).filter(Boolean))
    .filter((rings) => rings.length);
  return polys.length === 1
    ? { type: "Polygon", coordinates: polys[0] }
    : { type: "MultiPolygon", coordinates: polys };
}

const hex = JSON.parse(fs.readFileSync(HEX_GEOJSON, "utf8"));

// All hexes share one radius; read it off the data instead of assuming 11.5.
const radii = hex.features.map((h) => {
  const [x, y] = h.geometry.coordinates[0][0];
  return Math.hypot(x - h.properties.cx, y - h.properties.cy);
});
const hexRadius = Math.round((radii.reduce((a, b) => a + b, 0) / radii.length) * 1000) / 1000;
if (radii.some((r) => Math.abs(r - hexRadius) > 0.01)) throw new Error("Hexes do not share one radius");

const features = hex.features.map((h) => {
  const p = h.properties;
  const f = byGeoid.get(p.census_geoid_119);
  if (!f) throw new Error(`No Census district for ${p.census_geoid_119} (${p.geo_name})`);
  byGeoid.delete(p.census_geoid_119);
  const feature = {
    type: "Feature",
    properties: {
      geo_fips: p.geo_fips,
      census_geoid_119: p.census_geoid_119,
      geo_name: p.geo_name,
      state_abbr: p.state_abbr,
      cx: p.cx,
      cy: p.cy,
      col2: p.col2,
      row: p.row,
      hex_neighbors: p.hex_neighbors,
    },
    geometry: roundGeometry(f.geometry),
  };
  // d3 wants exterior rings clockwise. A ring wound the wrong way covers the
  // rest of the globe, so its area comes out near 4π.
  if (geoArea(feature) > 2 * Math.PI) throw new Error(`Bad winding in ${p.census_geoid_119}`);
  // The page scores self-crossing outlines, so the input must start with none.
  const polys = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  for (const rings of polys) for (const ring of rings) {
    if (ringCrossesItself(ring)) throw new Error(`Outline of ${p.geo_name} crosses itself after rounding`);
  }
  return feature;
});
if (byGeoid.size) throw new Error(`Census districts with no hex: ${[...byGeoid.keys()].join(", ")}`);

// Neighbours on the Census map: two districts are neighbours when they share at
// least one boundary segment. Shared borders use identical vertices in the
// Census file, and rounding keeps them identical, so exact matching works.
const segKey = (a, b) => {
  const ka = a[0] + "," + a[1], kb = b[0] + "," + b[1];
  return ka < kb ? ka + "|" + kb : kb + "|" + ka;
};
const segOwners = new Map();
for (const f of features) {
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const rings of polys) for (const ring of rings) for (let i = 0; i < ring.length - 1; i++) {
    const k = segKey(ring[i], ring[i + 1]);
    let owners = segOwners.get(k);
    if (!owners) segOwners.set(k, (owners = new Set()));
    owners.add(f.properties.geo_fips);
  }
}
const mapNeighbors = new Map(features.map((f) => [f.properties.geo_fips, new Set()]));
for (const owners of segOwners.values()) {
  if (owners.size !== 2) continue;
  const [a, b] = owners;
  mapNeighbors.get(a).add(b);
  mapNeighbors.get(b).add(a);
}
let mapPairs = 0, hexPairs = 0, keptPairs = 0;
for (const f of features) {
  const p = f.properties;
  p.map_neighbors = [...mapNeighbors.get(p.geo_fips)].sort();
  mapPairs += p.map_neighbors.length;
  hexPairs += p.hex_neighbors.length;
  keptPairs += p.map_neighbors.filter((n) => p.hex_neighbors.includes(n)).length;
}
console.log(`Neighbour pairs: ${mapPairs / 2} on the map, ${hexPairs / 2} on the hex grid, ${keptPairs / 2} on both`);

const payload = { hexRadius, gridRadius: 12, features };
fs.writeFileSync(
  OUT,
  `// Generated by build_data.mjs from ${CENSUS_ZIP} and ${HEX_GEOJSON}. Rebuild rather than edit.\n` +
    `// ${features.length} districts, 119th Congress. Geometry: Census, lon/lat. Properties: CDHD hex layout.\n` +
    `window.HEXMAP_DATA = ${JSON.stringify(payload)};\n`
);
const verts = features.reduce((n, f) => n + JSON.stringify(f.geometry.coordinates).split("],[").length, 0);
console.log(`Wrote ${OUT}: ${features.length} districts, ~${verts} vertices, hex radius ${hexRadius}, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
