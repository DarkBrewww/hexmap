/*
 * Hex-layout generation: independent implementation of McNeill & Hale,
 * "Generating Tile Maps", Computer Graphics Forum 36(3), 2017, §§4.1–4.5.
 * Paper: https://doi.org/10.1111/cgf.13200
 * Reference implementation: https://github.com/gjmcn/tile-maps-eurovis-demo
 *
 * This is the paper route, not the later demo's optional repulsion/concave hull.
 * Gaussian noise follows the paper's MEAN neighbor distance (the demo uses RMS).
 * Fixed 30 synchronous centroid updates; periodic Gaussian basis regression;
 * author-style half-step shifts; bounded exact-count grid fitting; Hungarian
 * squared-Euclidean assignment; four paper costs. Numerical safeguards and
 * rejection of self-crossing boundaries are explicit additions, not guarantees
 * made by the paper. No topology preservation or global optimum is claimed.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.McNeillEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';
  const SQRT3 = Math.sqrt(3), TAU = 2 * Math.PI;
  const DIRECTIONS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  const preparedCache = new WeakMap();
  function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const finitePoint = p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
  function polygonArea(points) {
    let sum = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) sum += points[j][0] * points[i][1] - points[i][0] * points[j][1];
    return Math.abs(sum) / 2;
  }
  function openRing(points) {
    const ring = points.map(p => [p[0], p[1]]).filter((p, i, all) => !i || distance(p, all[i - 1]) > 1e-10);
    if (ring.length > 1 && distance(ring[0], ring[ring.length - 1]) < 1e-10) ring.pop();
    return ring;
  }
  function bounds(points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of points) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    return {minX, minY, maxX, maxY};
  }
  function orient(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
  function onSegment(a, b, p, epsilon) {
    return Math.abs(orient(a, b, p)) <= epsilon && p[0] >= Math.min(a[0], b[0]) - epsilon && p[0] <= Math.max(a[0], b[0]) + epsilon && p[1] >= Math.min(a[1], b[1]) - epsilon && p[1] <= Math.max(a[1], b[1]) + epsilon;
  }
  function simplePolygon(points) {
    const box = bounds(points), eps = 1e-10 * Math.max(1, box.maxX - box.minX, box.maxY - box.minY);
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      for (let j = i + 2; j < points.length; j++) {
        if (i === 0 && j === points.length - 1) continue;
        const c = points[j], d = points[(j + 1) % points.length];
        if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) - eps || Math.max(c[0], d[0]) < Math.min(a[0], b[0]) - eps || Math.max(a[1], b[1]) < Math.min(c[1], d[1]) - eps || Math.max(c[1], d[1]) < Math.min(a[1], b[1]) - eps) continue;
        const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
        if (((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps)) && ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps))) return false;
        if (onSegment(a, b, c, eps) || onSegment(a, b, d, eps) || onSegment(c, d, a, eps) || onSegment(c, d, b, eps)) return false;
      }
    }
    return true;
  }
  // Standard ray-casting. Boundary points are accepted, consistently and without
  // adding cells outside the containing polygon to force the desired count.
  function contains(point, polygon) {
    let inside = false;
    const x = point[0], y = point[1];
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[j], b = polygon[i];
      if (onSegment(a, b, point, 1e-9)) return true;
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  function seededRandom(seed) {
    let a = seed >>> 0;
    return function () { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function normal(random) { return Math.sqrt(-2 * Math.log(Math.max(random(), 1e-15))) * Math.cos(TAU * random()); }
  function hashSeed(seed, text) {
    let value = seed >>> 0;
    for (let i = 0; i < text.length; i++) { value ^= text.charCodeAt(i); value = Math.imul(value, 16777619); }
    return value >>> 0;
  }
  function resampleRing(points, count) {
    const cumulative = [0];
    for (let i = 0; i < points.length; i++) cumulative.push(cumulative[i] + distance(points[i], points[(i + 1) % points.length]));
    const perimeter = cumulative[cumulative.length - 1], result = [];
    let segment = 0;
    for (let i = 0; i < count; i++) {
      const target = i * perimeter / count;
      while (segment + 1 < points.length && cumulative[segment + 1] < target) segment++;
      const a = points[segment], b = points[(segment + 1) % points.length], ratio = (target - cumulative[segment]) / (cumulative[segment + 1] - cumulative[segment]);
      result.push([a[0] + ratio * (b[0] - a[0]), a[1] + ratio * (b[1] - a[1])]);
    }
    return result;
  }
  function prepare(group) {
    if (group && preparedCache.has(group)) return preparedCache.get(group);
    if (!group || !Array.isArray(group.regions) || !group.regions.length) fail('INPUT', 'No regions supplied.');
    if (!Array.isArray(group.boundary) || group.boundary.length < 3 || !group.boundary.every(finitePoint)) fail('INPUT', 'A finite containing boundary is required.');
    const regions = group.regions, ids = new Map();
    regions.forEach((r, i) => { if (r.id == null || ids.has(String(r.id)) || !finitePoint(r.center)) fail('INPUT', 'Region IDs must be unique and centers finite.'); ids.set(String(r.id), i); });
    const neighbors = regions.map((r, i) => [...new Set((r.neighbors || []).map(id => ids.get(String(id))).filter(j => j !== undefined && j !== i))]);
    for (let i = 0; i < neighbors.length; i++) for (const j of neighbors[i]) if (!neighbors[j].includes(i)) fail('INPUT', `Asymmetric input adjacency: ${regions[i].id} / ${regions[j].id}.`);
    const originalBoundary = openRing(group.boundary), area = polygonArea(originalBoundary);
    if (originalBoundary.length < 3 || !(area > 1e-9) || !simplePolygon(originalBoundary)) fail('INPUT_BOUNDARY', 'The input containing boundary must be simple and have positive area.');
    // Like the author's eqSpace preprocessing, fit a fixed-density boundary.
    // The original area's reference scale is retained; no projection is changed.
    const boundary = resampleRing(originalBoundary, 512);
    if (!simplePolygon(boundary)) fail('INPUT_RESAMPLING', 'The 512-sample boundary intersects itself; use a cleaner containing outline.');
    const result = {regions, neighbors, boundary, referenceStep: Math.sqrt(area / regions.length), originalBoundaryVertices: originalBoundary.length};
    preparedCache.set(group, result);
    return result;
  }
  function checkOptions(input) {
    const options = Object.assign({noise: 0, transform: 1, smooth: 20, shift: 'none', shape: 'flat-side', seed: 2017}, input);
    if (!Number.isFinite(options.noise) || options.noise < 0 || options.noise > 2) fail('OPTIONS', 'Noise must be between 0 and 2.');
    if (!Number.isFinite(options.transform) || options.transform < 0 || options.transform > 1) fail('OPTIONS', 'Transform must be between 0 and 1.');
    if (!Number.isInteger(options.smooth) || (options.smooth !== 0 && (options.smooth < 3 || options.smooth > 128))) fail('OPTIONS', 'Smooth is 0, or an integer number of basis functions from 3 to 128.');
    if (!['none', 'x', 'y', 'xy'].includes(options.shift)) fail('OPTIONS', 'Shift must be none, x, y, or xy.');
    if (!['flat-side', 'flat-base'].includes(options.shape)) fail('OPTIONS', 'Unknown hex orientation.');
    if (!Number.isInteger(options.seed)) fail('OPTIONS', 'Seed must be an integer.');
    return options;
  }
  function transformCenters(prepared, options, groupId) {
    const {regions, neighbors, referenceStep} = prepared;
    const random = seededRandom(hashSeed(options.seed, `${groupId || ''}|${options.noise}`));
    const noisy = regions.map((r, i) => {
      const sigma = options.noise * (neighbors[i].length ? neighbors[i].reduce((sum, j) => sum + distance(r.center, regions[j].center), 0) / neighbors[i].length : 0);
      return [r.center[0] + sigma * normal(random), r.center[1] + sigma * normal(random)];
    });
    const vectors = neighbors.map((list, i) => list.map(j => {
      const length = distance(noisy[i], noisy[j]);
      if (length < 1e-12) fail('COINCIDENT_CENTERS', 'Adjacent noisy centroids coincide; change the noise or seed.');
      return [(noisy[i][0] - noisy[j][0]) * referenceStep / length, (noisy[i][1] - noisy[j][1]) * referenceStep / length];
    }));
    let current = noisy.map(p => p.slice());
    if (options.transform > 0) for (let iteration = 0; iteration < 30; iteration++) {
      current = neighbors.map((list, i) => {
        if (!list.length) return noisy[i].slice();
        let x = 0, y = 0;
        list.forEach((j, k) => { x += current[j][0] + vectors[i][k][0]; y += current[j][1] + vectors[i][k][1]; });
        return [x / list.length, y / list.length];
      });
    }
    const transformed = noisy.map((p, i) => [p[0] + options.transform * (current[i][0] - p[0]), p[1] + options.transform * (current[i][1] - p[1])]);
    return {noisy, transformed};
  }
  function transformBoundary(boundary, noisy, transformed, step) {
    return boundary.map(point => {
      const nearest = noisy.map((center, i) => ({i, d2: (center[0] - point[0]) ** 2 + (center[1] - point[1]) ** 2})).sort((a, b) => a.d2 - b.d2).slice(0, Math.min(3, noisy.length));
      const denominator = Math.max(2 * nearest[0].d2, 1e-20);
      let sum = 0;
      for (const item of nearest) { item.weight = Math.exp(-item.d2 / denominator); sum += item.weight; }
      if (sum < 1e-100) { nearest[0].weight = 1; sum = 1; }
      let vx = 0, vy = 0, cx = 0, cy = 0;
      for (const item of nearest) { const w = item.weight / sum; vx += w * (point[0] - noisy[item.i][0]); vy += w * (point[1] - noisy[item.i][1]); cx += w * transformed[item.i][0]; cy += w * transformed[item.i][1]; }
      const length = Math.hypot(vx, vy), factor = length > 1e-12 ? Math.sqrt(step / length) : 0;
      return [cx + factor * vx, cy + factor * vy];
    });
  }
  function solveSPD(matrix, rhsX, rhsY) {
    const n = matrix.length, lower = Array.from({length: n}, () => new Float64Array(n));
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
      let sum = matrix[i][j];
      for (let k = 0; k < j; k++) sum -= lower[i][k] * lower[j][k];
      if (i === j) { if (!(sum > 0)) fail('SMOOTH_NUMERICAL', 'Boundary smoothing system is not numerically positive definite.'); lower[i][j] = Math.sqrt(sum); }
      else lower[i][j] = sum / lower[j][j];
    }
    function solve(rhs) {
      const result = new Float64Array(n);
      for (let i = 0; i < n; i++) { let sum = rhs[i]; for (let j = 0; j < i; j++) sum -= lower[i][j] * result[j]; result[i] = sum / lower[i][i]; }
      for (let i = n - 1; i >= 0; i--) { let sum = result[i]; for (let j = i + 1; j < n; j++) sum -= lower[j][i] * result[j]; result[i] = sum / lower[i][i]; }
      return result;
    }
    return [solve(rhsX), solve(rhsY)];
  }
  function smoothBoundary(boundary, basisCount) {
    if (!basisCount) return boundary.map(p => p.slice());
    const n = boundary.length, arc = new Float64Array(n), center = [0, 0];
    for (let i = 0; i < n; i++) { center[0] += boundary[i][0] / n; center[1] += boundary[i][1] / n; if (i) arc[i] = arc[i - 1] + distance(boundary[i], boundary[i - 1]); }
    const perimeter = arc[n - 1] + distance(boundary[n - 1], boundary[0]), width = perimeter / basisCount;
    if (!(width > 0)) fail('SMOOTH_NUMERICAL', 'Boundary has no measurable perimeter.');
    const design = Array.from(arc, t => Float64Array.from({length: basisCount}, (_, j) => { const d = Math.abs(t - j * width), wrapped = Math.min(d, perimeter - d); return Math.exp(-wrapped * wrapped / (2 * width * width)); }));
    const normalMatrix = Array.from({length: basisCount}, () => new Float64Array(basisCount)), rhsX = new Float64Array(basisCount), rhsY = new Float64Array(basisCount);
    for (let i = 0; i < n; i++) for (let j = 0; j < basisCount; j++) { const value = design[i][j]; rhsX[j] += value * (boundary[i][0] - center[0]); rhsY[j] += value * (boundary[i][1] - center[1]); for (let k = 0; k <= j; k++) normalMatrix[j][k] += value * design[i][k]; }
    for (let j = 0; j < basisCount; j++) { normalMatrix[j][j] += 1e-10; for (let k = 0; k < j; k++) normalMatrix[k][j] = normalMatrix[j][k]; }
    const [betaX, betaY] = solveSPD(normalMatrix, rhsX, rhsY);
    return design.map(row => { let x = center[0], y = center[1]; for (let j = 0; j < basisCount; j++) { x += row[j] * betaX[j]; y += row[j] * betaY[j]; } return [x, y]; });
  }
  function gridDefinition(origin, step, shape) {
    return {origin: origin.slice(), step, shape, basis: shape === 'flat-side' ? [[step, 0], [step / 2, SQRT3 * step / 2]] : [[SQRT3 * step / 2, step / 2], [0, step]]};
  }
  function cellAt(q, r, grid) { return {q, r, x: grid.origin[0] + q * grid.basis[0][0] + r * grid.basis[1][0], y: grid.origin[1] + q * grid.basis[0][1] + r * grid.basis[1][1]}; }
  function nearestCell(point, grid) {
    const [u, v] = grid.basis, dx = point[0] - grid.origin[0], dy = point[1] - grid.origin[1], determinant = u[0] * v[1] - u[1] * v[0];
    const fq = (dx * v[1] - dy * v[0]) / determinant, fr = (dy * u[0] - dx * u[1]) / determinant, fs = -fq - fr;
    let q = Math.round(fq), r = Math.round(fr), s = Math.round(fs);
    const dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(s - fs);
    if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s; else s = -q - r;
    return cellAt(q, r, grid);
  }
  function hexCorners(cell, step, shape) {
    const radius = step / SQRT3, phase = shape === 'flat-side' ? Math.PI / 6 : 0;
    return Array.from({length: 6}, (_, k) => [cell.x + radius * Math.cos(phase + k * Math.PI / 3), cell.y + radius * Math.sin(phase + k * Math.PI / 3)]);
  }
  function fitGrid(boundary, count, shape, shift) {
    const fitInitialStep = Math.sqrt(polygonArea(boundary) / count), box = bounds(boundary);
    const shiftX = shift.includes('x') ? fitInitialStep / 2 : 0, shiftY = shift.includes('y') ? fitInitialStep / 2 : 0;
    const origin = [box.minX - shiftX, box.minY - shiftY], maxX = box.maxX, maxY = box.maxY;
    let step = fitInitialStep, stepMin = null, stepMax = null, lastCount = -1;
    for (let iteration = 1; iteration <= 50; iteration++) {
      const grid = gridDefinition(origin, step, shape), cells = [];
      const rowStep = shape === 'flat-side' ? SQRT3 * step / 2 : step / 2;
      const colStep = shape === 'flat-side' ? step : SQRT3 * step;
      const rows = Math.floor((maxY - origin[1]) / rowStep + 1e-9), cols = Math.floor((maxX - origin[0]) / colStep + 1e-9);
      if ((rows + 1) * (cols + 1) > 300000) fail('GRID_LIMIT', 'Grid search became excessively dense; use a less extreme parameter combination.');
      for (let row = 0; row <= rows; row++) for (let col = 0; col <= cols; col++) {
        let q, r;
        if (shape === 'flat-side') { r = row; q = col - Math.floor(row / 2); }
        else { q = 2 * col + row % 2; r = (row - q) / 2; }
        const cell = cellAt(q, r, grid);
        if (cell.x <= maxX + 1e-9 && contains([cell.x, cell.y], boundary)) cells.push(cell);
      }
      lastCount = cells.length;
      if (cells.length === count) return {cells, step, grid, fitIterations: iteration, fitInitialStep};
      if (cells.length < count) { stepMax = step; step = (step + (stepMin === null ? step * 0.9 : stepMin)) / 2; }
      else { stepMin = step; step = (step + (stepMax === null ? step * 1.1 : stepMax)) / 2; }
      if (!Number.isFinite(step) || step <= 1e-12) break;
    }
    fail('GRID_COUNT', `Exact-count grid search did not find ${count} cells in 50 iterations (last count ${lastCount}). No cells were arbitrarily added or discarded.`);
  }
  // Shortest-augmenting-path Hungarian algorithm, O(n^3), square cost matrix.
  function hungarian(cost) {
    const n = cost.length;
    if (!n || cost.some(row => row.length !== n || Array.from(row).some(value => !Number.isFinite(value)))) fail('ASSIGNMENT', 'Assignment requires a finite square cost matrix.');
    const u = new Float64Array(n + 1), v = new Float64Array(n + 1), p = new Int32Array(n + 1), way = new Int32Array(n + 1);
    for (let i = 1; i <= n; i++) {
      p[0] = i;
      const minv = new Float64Array(n + 1).fill(Infinity), used = new Uint8Array(n + 1);
      let j0 = 0;
      do {
        used[j0] = 1;
        const i0 = p[j0]; let delta = Infinity, j1 = 0;
        for (let j = 1; j <= n; j++) if (!used[j]) { const cur = cost[i0 - 1][j - 1] - u[i0] - v[j]; if (cur < minv[j]) { minv[j] = cur; way[j] = j0; } if (minv[j] < delta) { delta = minv[j]; j1 = j; } }
        if (!Number.isFinite(delta)) fail('ASSIGNMENT', 'No finite augmenting path in assignment.');
        for (let j = 0; j <= n; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
        j0 = j1;
      } while (p[j0] !== 0);
      do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }
    const assignment = new Int32Array(n);
    for (let j = 1; j <= n; j++) assignment[p[j] - 1] = j - 1;
    return Array.from(assignment);
  }
  function validate(group, cells, grid) {
    if (!grid || !finitePoint(grid.origin) || !Number.isFinite(grid.step) || grid.step <= 0 || !['flat-side', 'flat-base'].includes(grid.shape) || !Array.isArray(grid.basis) || !grid.basis.every(finitePoint)) fail('VALIDITY', 'A regular positive-scale hex grid is required.');
    const standard = gridDefinition(grid.origin, grid.step, grid.shape);
    if (grid.basis.length !== 2 || grid.basis.some((v, i) => distance(v, standard.basis[i]) > grid.step * 1e-9)) fail('VALIDITY', 'Unexpected hex-grid basis.');
    if (cells.length !== group.regions.length) fail('VALIDITY', 'Not every region has a cell.');
    const expected = new Set(group.regions.map(r => String(r.id))), seen = new Set(), occupied = new Set();
    for (const cell of cells) {
      if (!expected.has(String(cell.id)) || seen.has(String(cell.id))) fail('VALIDITY', 'Duplicate or unknown region assignment.');
      if (!Number.isInteger(cell.q) || !Number.isInteger(cell.r) || !Number.isFinite(cell.x) || !Number.isFinite(cell.y)) fail('VALIDITY', 'Invalid lattice coordinate.');
      const key = `${cell.q},${cell.r}`;
      if (occupied.has(key)) fail('VALIDITY', 'Two regions occupy the same cell.');
      const exact = cellAt(cell.q, cell.r, grid);
      if (Math.hypot(exact.x - cell.x, exact.y - cell.y) > grid.step * 1e-7) fail('VALIDITY', 'A cell lies outside the regular hex lattice.');
      occupied.add(key); seen.add(String(cell.id));
    }
    return {complete: true, unique: true, finite: true, regularLattice: true, nonOverlapping: true};
  }
  function evaluate(group, cells, transformedCenters, step, referenceStep) {
    const index = new Map(group.regions.map((r, i) => [String(r.id), i])), byId = new Map(cells.map(c => [String(c.id), c])), occupied = new Map(cells.map(c => [`${c.q},${c.r}`, c]));
    let missingPairsTwice = 0, originalPairsTwice = 0, retainedPairsTwice = 0, edgeCountTwice = 0, maxDegree = 0, isolated = 0;
    const perRegion = group.regions.map((region, i) => {
      const cell = byId.get(String(region.id));
      if (!cell) fail('METRICS', 'Metrics require a complete assignment.');
      const tileNeighbors = DIRECTIONS.map(([dq, dr]) => occupied.get(`${cell.q + dq},${cell.r + dr}`)).filter(Boolean);
      edgeCountTwice += tileNeighbors.length;
      const adjacent = new Set(tileNeighbors.map(c => String(c.id))), neighbors = [...new Set((region.neighbors || []).map(String).filter(id => index.has(id) && id !== String(region.id)))];
      const missing = neighbors.filter(id => !adjacent.has(id));
      let angle = 0;
      for (const id of neighbors) { const j = index.get(id), next = byId.get(id), source = group.regions[j].center; const original = Math.atan2(source[1] - region.center[1], source[0] - region.center[0]), target = Math.atan2(next.y - cell.y, next.x - cell.x); let difference = Math.abs(original - target) % TAU; angle += Math.min(difference, TAU - difference); }
      originalPairsTwice += neighbors.length; missingPairsTwice += missing.length; retainedPairsTwice += neighbors.length - missing.length; maxDegree = Math.max(maxDegree, neighbors.length); if (!neighbors.length) isolated++;
      const transformed = transformedCenters[i];
      return {id: String(region.id), distance: Math.hypot(cell.x - transformed[0], cell.y - transformed[1]) / referenceStep, adjacency: neighbors.length ? missing.length / neighbors.length : 0, angle: neighbors.length ? angle / neighbors.length : 0, originalDisplacement: Math.hypot(cell.x - region.center[0], cell.y - region.center[1]) / referenceStep, missingNeighbors: missing, newNeighbors: tileNeighbors.map(c => String(c.id)).filter(id => !neighbors.includes(id))};
    });
    const n = group.regions.length, perimeter = 6 * n - edgeCountTwice, minPerimeter = 2 * Math.sqrt(Math.PI * n * 3 * SQRT3 / 2);
    const metrics = {distance: 0, adjacency: 0, angle: 0, roughness: (perimeter - minPerimeter) / minPerimeter};
    for (const region of perRegion) for (const key of ['distance', 'adjacency', 'angle']) metrics[key] += region[key] / n;
    if (Object.values(metrics).some(value => !Number.isFinite(value))) fail('METRICS', 'A metric is not finite.');
    const unvisited = new Set(occupied.keys()); let tileComponents = 0;
    while (unvisited.size) { tileComponents++; const stack = [unvisited.values().next().value]; unvisited.delete(stack[0]); while (stack.length) { const current = occupied.get(stack.pop()); for (const [dq, dr] of DIRECTIONS) { const key = `${current.q + dq},${current.r + dr}`; if (unvisited.delete(key)) stack.push(key); } } }
    return {metrics, perRegion, diagnostics: {originalEdges: originalPairsTwice / 2, retainedEdges: retainedPairsTwice / 2, lostEdges: missingPairsTwice / 2, tileEdges: edgeCountTwice / 2, newEdges: (edgeCountTwice - retainedPairsTwice) / 2, tileComponents, maxOriginalDegree: maxDegree, isolatedRegions: isolated, unitEdgePerimeter: perimeter, referenceStep, step}};
  }
  function generate(group, inputOptions) {
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const options = checkOptions(inputOptions), prepared = prepare(group);
    const {noisy, transformed} = transformCenters(prepared, options, group.id);
    const warped = options.transform > 0 ? transformBoundary(prepared.boundary, noisy, transformed, prepared.referenceStep) : prepared.boundary;
    const boundary = openRing(smoothBoundary(warped, options.smooth));
    if (!boundary.every(finitePoint) || polygonArea(boundary) <= 1e-9) fail('BOUNDARY_DEGENERATE', 'This parameter combination produces a degenerate boundary.');
    if (!simplePolygon(boundary)) fail('BOUNDARY_CROSSING', 'This parameter combination produces a self-crossing containing boundary. Try smoothing or a smaller transform/noise.');
    const fit = fitGrid(boundary, prepared.regions.length, options.shape, options.shift);
    const costs = transformed.map(center => Float64Array.from(fit.cells, cell => (center[0] - cell.x) ** 2 + (center[1] - cell.y) ** 2));
    const assignment = hungarian(costs), cells = assignment.map((cellIndex, i) => Object.assign({id: String(prepared.regions[i].id)}, fit.cells[cellIndex]));
    const validity = validate(group, cells, fit.grid), evaluated = evaluate(group, cells, transformed, fit.step, prepared.referenceStep);
    return {cells, step: fit.step, grid: fit.grid, boundary, noisyCenters: noisy, transformedCenters: transformed, referenceStep: prepared.referenceStep, options, metrics: evaluated.metrics, perRegion: evaluated.perRegion, diagnostics: Object.assign(evaluated.diagnostics, {validity, fitIterations: fit.fitIterations, fitInitialStep: fit.fitInitialStep, centroidIterations: options.transform ? 30 : 0, boundarySamples: prepared.boundary.length, originalBoundaryVertices: prepared.originalBoundaryVertices, elapsedMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start})};
  }
  return {version: 'mcneill-paper-local-1', generate, evaluate, validate, polygonArea, simplePolygon, contains, gridDefinition, cellAt, nearestCell, hexCorners, hungarian, smoothBoundary, transformBoundary, transformCenters, prepare, fitGrid, resampleRing, directions: DIRECTIONS.map(d => d.slice())};
});
