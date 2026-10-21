/**
 * Input adapter for the hex-layout generator.
 * Reads (never writes) the existing morph viewer's data. It deliberately uses
 * the same d3.geoAlbersUsa() defaults and geoPath.centroid as that viewer.
 * Run from this directory: node prepare-data.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import E from './engine.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const {values} = parseArgs({options: {'source-dir': {type: 'string'}}});
const parentDirectory = path.resolve(directory, '..');
if (values['source-dir'] === '') throw new Error('--source-dir must name the morph comparison project directory.');
const sourceDirectory = values['source-dir'] !== undefined
  ? path.resolve(values['source-dir'])
  : parentDirectory;
const sourcePath = path.join(sourceDirectory, 'hexmap_data.js');
const d3Path = path.join(sourceDirectory, 'node_modules/d3/src/index.js');
if (!fs.existsSync(sourcePath)) throw new Error(`Source data not found: ${sourcePath}. Set --source-dir to the morph comparison project.`);
if (!fs.existsSync(d3Path)) throw new Error(`D3 not found in ${sourceDirectory}. Install that project's dependencies before preparing data.`);
const d3 = await import(pathToFileURL(d3Path).href);
const sourceText = fs.readFileSync(sourcePath, 'utf8');
const sandbox = {window: {}};
vm.runInNewContext(sourceText, sandbox, {filename: sourcePath, timeout: 10000});
const sourceData = sandbox.window.HEXMAP_DATA;
const features = sourceData.features;
if (features.length !== 436) throw new Error(`Expected 436 districts, found ${features.length}. Review the source-data change.`);

const projection = d3.geoAlbersUsa();
const geoPath = d3.geoPath(projection);
let recording = null;
const recorder = d3.geoPath(projection, {
  moveTo(x, y) { recording.push([[x, y]]); },
  lineTo(x, y) {
    const ring = recording.at(-1), last = ring.at(-1);
    if (last[0] !== x || last[1] !== y) ring.push([x, y]);
  },
  closePath() {},
  arc() {},
});
function projectedRings(feature) {
  recording = [];
  recorder(feature);
  const result = recording;
  recording = null;
  return result.filter(ring => {
    if (ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring.pop();
    return ring.length >= 3;
  });
}

function signedArea(ring) {
  let result = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    result += a[0] * b[1] - b[0] * a[1];
  }
  return result / 2;
}

// Census district borders have exactly matching rounded vertices. Cancel each
// segment shared by two polygons, then stitch the remaining directed segments.
// No convex hull, fabricated border or invented district adjacency is used.
function dissolveExteriorRings(subset) {
  const segments = new Map(), coordinates = new Map();
  for (const feature of subset) {
    const polygons = feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const polygon of polygons) for (const ring of polygon) {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i].join(','), b = ring[i + 1].join(',');
        if (a === b) continue;
        coordinates.set(a, ring[i]); coordinates.set(b, ring[i + 1]);
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (!segments.has(key)) segments.set(key, []);
        segments.get(key).push([a, b]);
      }
    }
  }
  if ([...segments.values()].some(owners => owners.length > 2)) throw new Error('Non-manifold source border: more than two polygon occurrences.');
  const outer = [...segments.values()].filter(owners => owners.length === 1).flat();
  const outgoing = new Map();
  for (const [a, b] of outer) {
    if (outgoing.has(a)) throw new Error(`Ambiguous boundary junction at ${a}.`);
    outgoing.set(a, b);
  }
  const visited = new Set(), rings = [];
  for (const [start] of outer) {
    if (visited.has(start)) continue;
    const ring = [];
    let current = start;
    do {
      if (visited.has(current) || !outgoing.has(current)) throw new Error('Source boundary is not a closed simple chain.');
      visited.add(current);
      ring.push(coordinates.get(current));
      current = outgoing.get(current);
    } while (current !== start);
    ring.push(ring[0]);
    const projected = projectedRings({type: 'Polygon', coordinates: [ring]});
    rings.push(...projected);
  }
  return rings.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
}

const regions = features.map(feature => {
  const p = feature.properties;
  return {
    id: p.geo_fips,
    censusId: p.census_geoid_119,
    name: p.geo_name,
    state: p.state_abbr,
    center: geoPath.centroid(feature),
    neighbors: [...p.map_neighbors],
    rings: projectedRings(feature),
    path: geoPath(feature),
  };
});
const byId = new Map(regions.map(region => [region.id, region]));
if (byId.size !== regions.length) throw new Error('Duplicate district identifiers.');
for (const region of regions) {
  for (const point of [region.center, ...region.rings.flat()]) {
    if (!point.every(Number.isFinite)) throw new Error(`Non-finite projected coordinate in ${region.id}.`);
  }
  for (const neighbor of region.neighbors) {
    if (!byId.get(neighbor)?.neighbors.includes(region.id)) throw new Error(`Non-reciprocal source adjacency ${region.id} / ${neighbor}.`);
  }
}

const components = [];
const seen = new Set();
for (const region of regions) {
  if (seen.has(region.id)) continue;
  const todo = [region.id], component = [];
  seen.add(region.id);
  while (todo.length) {
    const id = todo.pop();
    component.push(id);
    for (const neighbor of byId.get(id).neighbors) if (!seen.has(neighbor)) {
      seen.add(neighbor); todo.push(neighbor);
    }
  }
  components.push(component.sort());
}
const groupSpecs = [
  {id: 'mainland', label: 'Contiguous US + DC', include: feature => !['AK', 'HI'].includes(feature.properties.state_abbr)},
  {id: 'alaska', label: 'Alaska inset', include: feature => feature.properties.state_abbr === 'AK'},
  {id: 'hawaii', label: 'Hawaii inset', include: feature => feature.properties.state_abbr === 'HI'},
];
const groups = groupSpecs.map(spec => {
  const subset = features.filter(spec.include);
  const ids = new Set(subset.map(feature => feature.properties.geo_fips));
  const members = regions.filter(region => ids.has(region.id));
  const boundaryRings = dissolveExteriorRings(subset);
  if (!boundaryRings.length) throw new Error(`Empty projected boundary for ${spec.id}.`);
  const boundary = boundaryRings[0];
  const outside = members.filter(region => !d3.polygonContains(boundary, region.center)).map(region => region.id);
  return {
    id: spec.id,
    label: spec.label,
    regions: members.map(({id, name, state, center, neighbors}) => ({id, name, state, center, neighbors: neighbors.filter(neighbor => ids.has(neighbor))})),
    boundary,
    boundaryRings,
    anchor: [d3.mean(members, region => region.center[0]), d3.mean(members, region => region.center[1])],
    metadata: {
      count: members.length,
      boundaryMethod: 'Exact cancellation of shared rounded Census segments; largest projected exterior selected for the single-boundary generator.',
      originalBoundaryRingCount: boundaryRings.length,
      selectedBoundaryVertexCount: boundary.length,
      centersOutsideSelectedBoundary: outside,
    },
  };
});
const sourceBounds = geoPath.bounds({type: 'FeatureCollection', features});
const pad = 12;
const viewBox = [sourceBounds[0][0] - pad, sourceBounds[0][1] - pad,
  sourceBounds[1][0] - sourceBounds[0][0] + 2 * pad,
  sourceBounds[1][1] - sourceBounds[0][1] + 2 * pad];

// Match the original viewer's fit exactly: one scale and translation after
// flipping source y. The fit is computed once from the original district labels.
// Candidate reassignment must never refit these target cells.
function prepareNyuTarget() {
  const n = features.length;
  let pmx = 0, pmy = 0, cmx = 0, cmy = 0;
  features.forEach((feature, i) => {
    pmx += feature.properties.cx; pmy -= feature.properties.cy;
    cmx += regions[i].center[0]; cmy += regions[i].center[1];
  });
  pmx /= n; pmy /= n; cmx /= n; cmy /= n;
  let numerator = 0, denominator = 0;
  features.forEach((feature, i) => {
    const dx = feature.properties.cx - pmx, dy = -feature.properties.cy - pmy;
    numerator += dx * (regions[i].center[0] - cmx) + dy * (regions[i].center[1] - cmy);
    denominator += dx * dx + dy * dy;
  });
  const scale = numerator / denominator;
  const tx = cmx - scale * pmx, ty = cmy - scale * pmy;
  const step = scale * sourceData.gridRadius * Math.sqrt(3);
  const radius = scale * sourceData.hexRadius;
  if (![scale, tx, ty, step, radius].every(Number.isFinite) || scale <= 0 || radius <= 0 || radius > step / Math.sqrt(3)) {
    throw new Error('The imported NYU geometry has an invalid fit or overlapping hex radii.');
  }
  const centers = features.map(feature => [scale * feature.properties.cx + tx, -scale * feature.properties.cy + ty]);
  const shape = 'flat-side';
  const grid = E.gridDefinition(centers[0], step, shape);
  let maxLatticeError = 0;
  const cells = features.map((feature, i) => {
    const [x, y] = centers[i], lattice = E.nearestCell([x, y], grid);
    const error = Math.hypot(x - lattice.x, y - lattice.y);
    maxLatticeError = Math.max(maxLatticeError, error);
    if (error > 1e-7 * step) throw new Error(`Imported NYU cell ${feature.properties.geo_fips} is off the regular lattice.`);
    const id = String(feature.properties.geo_fips);
    // Preserve the imported center, including source rounding, rather than
    // replacing it with a computed lattice coordinate.
    return {id, originalId: id, x, y, q: lattice.q, r: lattice.r};
  });
  const byCell = new Map(cells.map(cell => [`${cell.q},${cell.r}`, cell]));
  if (byCell.size !== n) throw new Error('The imported NYU layout contains duplicate occupied cells.');
  let neighborPairsTwice = 0;
  features.forEach((feature, i) => {
    const cell = cells[i];
    const neighbors = E.directions.map(([dq, dr]) => byCell.get(`${cell.q + dq},${cell.r + dr}`)?.originalId).filter(Boolean).sort();
    const expected = [...feature.properties.hex_neighbors].map(String).sort();
    if (JSON.stringify(neighbors) !== JSON.stringify(expected)) throw new Error(`Imported NYU neighbor mismatch for ${cell.originalId}.`);
    neighborPairsTwice += neighbors.length;
  });
  return {
    cells, grid, step, radius, shape,
    metadata: {
      source: 'Congressional District Health Dashboard, Department of Population Health, NYU Langone Health.',
      sourceUrl: 'https://www.congressionaldistricthealthdashboard.org/',
      sourceFile: 'hexmap_data.js',
      sourceSha256: crypto.createHash('sha256').update(sourceText).digest('hex'),
      sourceAccessed: '2026-09-26',
      alignment: {scale, tx, ty, flipY: true},
      alignmentMethod: 'Exactly the original morph viewer fit: least-squares uniform scale and translation after a y flip, using original district-centroid correspondences. Never recomputed after reassignment.',
      sourceGridRadius: sourceData.gridRadius,
      sourceDrawnRadius: sourceData.hexRadius,
      drawnRadiusRatio: sourceData.hexRadius / sourceData.gridRadius,
      maxLatticeError,
      maxLatticeErrorInSteps: maxLatticeError / step,
      latticeToleranceInSteps: 1e-7,
      originalNeighborPairs: neighborPairsTwice / 2,
      fixedGeometrySha256: crypto.createHash('sha256').update(JSON.stringify({centers, radius, shape})).digest('hex'),
      geometry: 'Raw aligned source centers and original drawn radius are retained exactly. Integer axial coordinates describe topology; source rounding is not snapped away.',
      topology: 'Adjacency and footprint roughness use neighboring grid cells. The original drawn hex radius is smaller than the grid radius, leaving intentional visual gutters.',
    },
  };
}
const nyuTarget = prepareNyuTarget();
const data = {
  regions,
  groups,
  viewBox,
  nyuTarget,
  metadata: {
    schemaVersion: 2,
    source: 'Census cb_2024_us_cd119_20m geometry and map_neighbors from the existing morph viewer hexmap_data.js; 435 congressional districts plus DC.',
    sourceSha256: crypto.createHash('sha256').update(sourceText).digest('hex'),
    projection: 'd3.geoAlbersUsa() with unchanged defaults, exactly as the morph comparison viewer; Alaska and Hawaii retain the existing projected inset positions.',
    coordinateSystem: 'Projected screen units; x right, y down. Responsive SVG display does not change these coordinates.',
    projectionScale: projection.scale(),
    projectionTranslate: projection.translate(),
    representativePoint: 'd3.geoPath(projection).centroid(feature), including the same projected multipart geometry as the morph viewer.',
    adjacency: 'Existing map_neighbors: shared Census boundary segment, not corner-only contact. No inferred water connections.',
    adjacencyPairs: regions.reduce((total, region) => total + region.neighbors.length, 0) / 2,
    highDegreeRegionCount: regions.filter(region => region.neighbors.length > 6).length,
    connectedComponents: components,
    adaptation: 'The mainland generator uses the largest dissolved original exterior; detached small offshore rings and interior holes are not imposed as layout constraints. All original district rings remain visible in the reference map and all 436 district labels are retained. Alaska (1) and Hawaii (2) are handled as explicit inset placement adaptations, not a single contiguous 436-region McNeill run.',
    importedHexLayoutUsage: 'Generated-layout mode does not use NYU positions. Fixed-NYU mode reuses their exact aligned cells and drawn radius, then changes only district assignments.',
  },
};
fs.writeFileSync(path.join(directory, 'data.json'), `${JSON.stringify(data)}\n`);
fs.writeFileSync(path.join(directory, 'data.js'), `// Generated by prepare-data.mjs.\nwindow.HEX_LAYOUT_INPUT = ${JSON.stringify(data)};\n`);
console.log(JSON.stringify({regions: regions.length, components: components.map(component => component.length), adjacencyPairs: data.metadata.adjacencyPairs,
  groups: groups.map(group => ({id: group.id, ...group.metadata})), viewBox, nyuTarget: {cells: nyuTarget.cells.length, step: nyuTarget.step, radius: nyuTarget.radius, ...nyuTarget.metadata}, dataBytes: fs.statSync(path.join(directory, 'data.js')).size}, null, 2));
