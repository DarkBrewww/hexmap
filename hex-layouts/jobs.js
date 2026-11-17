/* US district generation and fixed-target assignment around McNeillEngine. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.HexLayoutJobs = factory(root.McNeillEngine);
})(typeof self !== 'undefined' ? self : globalThis, function (E) {
  'use strict';
  const directions = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  const key = c => `${c.q},${c.r}`;
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

  function nearby(point, grid, radius) {
    const a = E.nearestCell(point, grid), cells = [];
    for (let q = -radius; q <= radius; q++) for (let r = -radius; r <= radius; r++) {
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= radius) cells.push(E.cellAt(a.q + q, a.r + r, grid));
    }
    return cells.sort((a, b) => d2([a.x, a.y], point) - d2([b.x, b.y], point));
  }

  // Labels the connected pieces of a set of cells; label[i] is the piece of cells[i].
  function pieces(cells) {
    const index = new Map(cells.map((c, i) => [key(c), i])), label = new Array(cells.length).fill(-1);
    let count = 0;
    for (let start = 0; start < cells.length; start++) {
      if (label[start] >= 0) continue;
      label[start] = count;
      const stack = [start];
      while (stack.length) {
        const c = cells[stack.pop()];
        for (const [dq, dr] of directions) {
          const j = index.get(`${c.q + dq},${c.r + dr}`);
          if (j !== undefined && label[j] < 0) { label[j] = count; stack.push(j); }
        }
      }
      count++;
    }
    return {count, label};
  }

  // An inset with three or more regions (the county insets) is drawn smaller, about its anchor,
  // so that its land covers as many lattice cells as it has regions; this is how the generator
  // sizes the mainland grid. One Hungarian assignment then takes the scaled centers to free
  // cells. Regions with a land neighbour in the inset must form one connected piece; regions
  // without one (islands such as Aleutians West or Kauai) may stand apart. If the connected
  // regions are split, the inset is shrunk further.
  function placeLargeInset(group, anchor, grid, step, free) {
    const n = group.regions.length;
    const ids = new Set(group.regions.map(r => String(r.id)));
    const island = group.regions.map(r => !(r.neighbors || []).some(id => String(id) !== String(r.id) && ids.has(String(id))));
    const rings = Array.isArray(group.boundaryRings) && group.boundaryRings.length ? group.boundaryRings : [group.boundary];
    const land = rings.reduce((sum, ring) => sum + Math.abs(E.polygonArea(ring)), 0);
    if (!(land > 0)) throw new Error(`Inset ${group.id} has no land area.`);
    let reach = 1;
    while (3 * reach * (reach + 1) + 1 < n) reach++;
    const first = Math.min(1, Math.sqrt(n * (Math.sqrt(3) / 2) * step ** 2 / land));
    const scales = Array.from({length: 80}, (_, i) => first * 0.95 ** i).concat(0);
    for (const scale of scales) {
      const targets = group.regions.map(r => [anchor[0] + scale * (r.center[0] - anchor[0]), anchor[1] + scale * (r.center[1] - anchor[1])]);
      for (let radius = reach + 1; radius <= reach + 8; radius++) {
        const candidates = new Map();
        for (const target of targets) for (const c of nearby(target, grid, radius)) if (free(c)) candidates.set(key(c), c);
        const list = [...candidates.values()];
        if (list.length < n) continue;
        // Rows past n are empty, so the square solver picks the best n of the candidate cells.
        const costs = list.map((_, row) => row < n ? Float64Array.from(list, c => d2([c.x, c.y], targets[row])) : new Float64Array(list.length));
        const chosen = E.hungarian(costs).slice(0, n).map(column => list[column]);
        const split = pieces(chosen);
        if (new Set(split.label.filter((_, i) => !island[i])).size > 1) break;
        const cost = chosen.reduce((sum, c, i) => sum + d2([c.x, c.y], targets[i]), 0);
        return {cells: chosen, targets, scale, cost, pieces: split.count};
      }
    }
    return null;
  }

  function placeInsets(data, result) {
    const occupied = new Set(result.cells.map(key));
    const cells = result.cells.map(c => ({...c}));
    const centers = new Map();
    const mainland = data.groups.find(g => g.id === 'mainland');
    mainland.regions.forEach((r, i) => centers.set(r.id, result.transformedCenters[i]));
    const free = c => !occupied.has(key(c)) && directions.every(([q, r]) => !occupied.has(`${c.q + q},${c.r + r}`));
    const insetDetails = [];
    for (const group of data.groups.filter(g => g.id !== 'mainland')) {
      const n = group.regions.length;
      if (!n) throw new Error(`Inset ${group.id} has no regions.`);
      const anchor = group.regions.reduce((a, r) => [a[0] + r.center[0] / n, a[1] + r.center[1] / n], [0, 0]);
      if (n > 2) {
        const placed = placeLargeInset(group, anchor, result.grid, result.step, free);
        if (!placed) throw new Error(`No non-overlapping inset placement for ${group.id} keeps its connected regions together.`);
        placed.cells.forEach((c, i) => {
          const region = group.regions[i];
          occupied.add(key(c)); cells.push({...c, id: region.id}); centers.set(region.id, placed.targets[i]);
        });
        insetDetails.push({id: group.id, regionCount: n, placement: 'centers scaled about the inset anchor and assigned to free common-lattice cells; regions with a land neighbour form one piece, island regions may stand apart', scale: placed.scale, pieces: placed.pieces, displacementSquared: placed.cost});
        continue;
      }
      let best = null, cost = Infinity;
      for (const radius of [2, 4, 8, 16, 32]) {
        for (const a of nearby(anchor, result.grid, radius)) {
          if (!free(a)) continue;
          if (n === 1) {
            const v = d2([a.x, a.y], group.regions[0].center);
            if (v < cost) { cost = v; best = [a]; }
          } else {
            for (const [dq, dr] of directions) {
              const b = E.cellAt(a.q + dq, a.r + dr, result.grid);
              if (!free(b)) continue;
              const v = d2([a.x, a.y], group.regions[0].center) + d2([b.x, b.y], group.regions[1].center);
              if (v < cost) { cost = v; best = [a, b]; }
            }
          }
        }
        if (best) break;
      }
      if (!best) throw new Error(`No non-overlapping inset placement for ${group.id}.`);
      best.forEach((c, i) => {
        const region = group.regions[i];
        const cell = {...c, id: region.id};
        occupied.add(key(cell)); cells.push(cell); centers.set(region.id, region.center);
      });
      insetDetails.push({id: group.id, regionCount: n, placement: 'nearest available common-lattice inset cells', displacementSquared: cost});
    }
    const cellById = new Map(cells.map(c => [c.id, c]));
    const ordered = data.regions.map(r => cellById.get(r.id));
    const transformed = data.regions.map(r => centers.get(r.id));
    if (ordered.some(c => !c) || new Set(ordered.map(c => c.id)).size !== data.regions.length || new Set(ordered.map(key)).size !== data.regions.length) throw new Error('Full-map bijection or unique-cell check failed.');
    for (const c of ordered) {
      if (![c.x, c.y, c.q, c.r].every(Number.isFinite) || !Number.isInteger(c.q) || !Number.isInteger(c.r)) throw new Error('Non-finite or off-lattice cell.');
      const expected = E.cellAt(c.q, c.r, result.grid);
      if (Math.hypot(c.x - expected.x, c.y - expected.y) > 1e-7 * result.step) throw new Error('Inconsistent cell geometry.');
    }
    return {cells: ordered, transformed, insetDetails};
  }

  function fail(code, message) { const error = new Error(message); error.code = code; throw error; }

  function displacementSummary(cells, regions, referenceStep) {
    const values = cells.map((c, i) => Math.hypot(c.x - regions[i].center[0], c.y - regions[i].center[1]) / referenceStep).sort((a, b) => a - b);
    return {
      originalDisplacementMean: values.reduce((sum, value) => sum + value, 0) / values.length,
      originalDisplacementP95: values[Math.floor(.95 * (values.length - 1))],
      originalDisplacementMax: values.at(-1)
    };
  }

  function fixedInput(data) {
    const target = data.nyuTarget;
    if (!target || !Array.isArray(target.cells) || target.cells.length !== data.regions.length) fail('FIXED_TARGET', 'The NYU target must contain one cell for every district. Rebuild the input snapshot.');
    if (target.shape !== 'flat-side' || target.grid?.shape !== target.shape || target.step !== target.grid?.step || !Number.isFinite(target.radius) || target.radius <= 0 || target.radius > target.step / Math.sqrt(3)) fail('FIXED_TARGET', 'The NYU target has invalid orientation, spacing, or drawn radius.');
    const mainland = data.groups.find(g => g.id === 'mainland');
    if (!mainland) fail('INPUT', 'Missing mainland input group.');
    const referenceStep = E.prepare(mainland).referenceStep;
    const ids = new Map(data.regions.map((region, i) => [String(region.id), i]));
    if (ids.size !== data.regions.length || data.regions.some(r => !Array.isArray(r.center) || r.center.length !== 2 || !r.center.every(Number.isFinite))) fail('INPUT', 'District IDs must be unique and original centers finite.');
    const neighbors = data.regions.map((region, i) => [...new Set((region.neighbors || []).map(id => ids.get(String(id))).filter(j => j !== undefined && j !== i))]);
    neighbors.forEach((list, i) => list.forEach(j => { if (!neighbors[j].includes(i)) fail('INPUT', 'Original district adjacency must be reciprocal.'); }));
    if (target.cells.some(c => String(c.originalId) !== String(c.id))) fail('FIXED_TARGET', 'NYU cells must retain their original district identifiers.');
    const validity = E.validate({regions: data.regions}, target.cells, target.grid);
    return {target, referenceStep, validity, mainland};
  }

  function fixedParameters(parameters, mode = 'nyu-fixed') {
    const result = {mode, noise: parameters.noise ?? 0, transform: parameters.transform ?? 1, smooth: 0, shift: 'none', shape: 'flat-side', seed: parameters.seed ?? 42};
    if (!Number.isFinite(result.noise) || result.noise < 0 || result.noise > 2) fail('OPTIONS', 'Noise must be between 0 and 2.');
    if (!Number.isFinite(result.transform) || result.transform < 0 || result.transform > 1) fail('OPTIONS', 'Transform must be between 0 and 1.');
    if (!Number.isInteger(result.seed)) fail('OPTIONS', 'Seed must be an integer.');
    return result;
  }

  function fixedResult(data, input, parameters, transformed, assignment, baseline) {
    const {target, referenceStep} = input;
    // Copy exact aligned source coordinates. Neither cells nor the fitted target
    // transformation are recomputed when district labels change.
    const cells = assignment.map((cellIndex, i) => {
      const cell = target.cells[cellIndex];
      return {...cell, id: String(data.regions[i].id), targetId: String(cell.originalId)};
    });
    const validity = E.validate({regions: data.regions}, cells, target.grid);
    const evaluation = E.evaluate({regions: data.regions}, cells, transformed, target.step, referenceStep);
    return {
      mode: parameters.mode, baseline, parameters, cells, grid: target.grid, step: target.step, radius: target.radius, referenceStep,
      boundary: null, transformedCenters: transformed, metrics: evaluation.metrics, perRegion: evaluation.perRegion,
      diagnostics: {
        ...evaluation.diagnostics, ...displacementSummary(cells, data.regions, referenceStep), validity,
        fullCoverage: cells.length, uniqueCells: new Set(cells.map(key)).size,
        fixedGeometry: true, fixedTarget: 'NYU Congressional District Health Dashboard',
        fixedTargetRadius: target.radius, targetChanged: false,
        assignmentScope: 'All districts and all target cells; no state or inset assignment restrictions.',
        roughnessGeometry: 'Occupied grid-cell footprint; display gaps between hexagons are excluded.',
        changedAssignments: cells.filter(cell => cell.id !== cell.targetId).length,
        centroidIterations: baseline || !parameters.transform ? 0 : 30,
        fitIterations: 0, boundarySamples: 0
      },
      signature: `nyu:${cells.map(cell => `${cell.id}:${cell.targetId}`).join(';')}`
    };
  }

  function runFixed(data, parameters) {
    const input = fixedInput(data), options = fixedParameters(parameters);
    // Share the generated mode's source transformation and noise realization.
    // Only the target geometry changes; assignment still spans all 436 cells.
    const mainCenters = E.transformCenters(E.prepare(input.mainland), options, input.mainland.id).transformed;
    const byId = new Map(input.mainland.regions.map((region, i) => [String(region.id), mainCenters[i]]));
    const transformed = data.regions.map(region => (byId.get(String(region.id)) || region.center).slice());
    if (transformed.some(point => !point.every(Number.isFinite))) fail('ASSIGNMENT', 'The transformed district centers are not finite.');
    const costs = transformed.map(center => Float64Array.from(input.target.cells, cell => d2(center, [cell.x, cell.y])));
    return fixedResult(data, input, options, transformed, E.hungarian(costs), false);
  }

  function originalNyu(data) {
    const input = fixedInput(data), index = new Map(input.target.cells.map((cell, i) => [String(cell.originalId), i]));
    const assignment = data.regions.map(region => index.get(String(region.id)));
    const options = fixedParameters({noise: 0, transform: 0}, 'nyu-original');
    return fixedResult(data, input, options, data.regions.map(region => region.center.slice()), assignment, true);
  }

  function runOne(data, parameters) {
    if (parameters.mode === 'nyu-fixed') return runFixed(data, parameters);
    if (parameters.mode && parameters.mode !== 'generated') fail('OPTIONS', 'Unknown layout mode.');
    const mainland = data.groups.find(g => g.id === 'mainland');
    if (!mainland) throw new Error('Missing mainland input group.');
    const raw = E.generate(mainland, parameters);
    const full = placeInsets(data, raw);
    const referenceStep = raw.referenceStep || Math.sqrt(Math.abs(E.polygonArea(mainland.boundary)) / mainland.regions.length);
    const evaluation = E.evaluate({id: 'all', regions: data.regions}, full.cells, full.transformed, raw.step, referenceStep);
    // Relative axial positions describe the labeled layout independently of translation/scale.
    const anchor = full.cells[0];
    const signature = parameters.shape + ':' + full.cells.map(c => `${c.id}:${c.q - anchor.q},${c.r - anchor.r}`).join(';');
    return {
      mode: 'generated', parameters, cells: full.cells, grid: raw.grid, step: raw.step, radius: raw.step / Math.sqrt(3), referenceStep,
      boundary: raw.boundary, transformedCenters: full.transformed,
      metrics: evaluation.metrics, perRegion: evaluation.perRegion,
      diagnostics: {...raw.diagnostics, ...evaluation.diagnostics, fullCoverage: full.cells.length, uniqueCells: new Set(full.cells.map(key)).size, insets: full.insetDetails,
        ...displacementSummary(full.cells, data.regions, referenceStep)},
      signature
    };
  }

  function combinations(input) {
    const result = [];
    if (input.mode === 'nyu-fixed') {
      for (const noise of input.noise) for (const transform of input.transform) result.push(fixedParameters({noise, transform, seed: 42}));
      return result;
    }
    if (input.mode && input.mode !== 'generated') fail('OPTIONS', 'Unknown layout mode.');
    for (const noise of input.noise) for (const transform of input.transform) for (const smooth of input.smooth) for (const shift of input.shift) {
      result.push({...(input.mode ? {mode: input.mode} : {}), noise, transform, smooth, shift, shape: input.shape, seed: 42});
    }
    return result;
  }
  return {runOne, combinations, originalNyu};
});
