/* Candidate ranking, partial exports, and independent saved-layout snapshots. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HexLayoutCollection = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';
  // The five score terms. Lower is better for each. Distance to the transformed centre stays in
  // result.metrics as a diagnostic and is not scored.
  const TERMS = [
    {key: 'originalMovement', label: 'Original movement', value: result => result.diagnostics?.originalDisplacementMean},
    {key: 'adjacency', label: 'Adjacency', value: result => result.metrics?.adjacency},
    {key: 'angle', label: 'Orientation', value: result => result.metrics?.angle},
    {key: 'roughness', label: 'Roughness', value: result => result.metrics?.roughness},
    {key: 'statesSplit', label: 'States split', value: result => result.stateMetrics?.statesSplit?.length}
  ];
  const clone = value => typeof structuredClone === 'function'
    ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const invalid = () => { throw new Error('Ranking requires finite, nonnegative weights and metrics.'); };

  function termValues(result) {
    const values = {};
    for (const term of TERMS) {
      const value = term.value(result);
      if (!Number.isFinite(value) || value < 0) invalid();
      values[term.key] = value;
    }
    return values;
  }

  // The range of every term over a pool of layouts. Scores are relative to one pool: the current
  // batch, or the saved group.
  function scale(results) {
    const min = {}, max = {};
    for (const term of TERMS) { min[term.key] = Infinity; max[term.key] = -Infinity; }
    for (const result of results) {
      const values = termValues(result);
      for (const term of TERMS) {
        min[term.key] = Math.min(min[term.key], values[term.key]);
        max[term.key] = Math.max(max[term.key], values[term.key]);
      }
    }
    const constant = TERMS.filter(term => !(max[term.key] > min[term.key])).map(term => term.key);
    return {count: results.length, min, max, constant};
  }

  // 0 is the best value in the pool and 1 the worst. A layout outside the pool, such as the NYU
  // reference, can fall below 0 or above 1. A term that is constant in the pool cannot be rescaled.
  function normalized(result, poolScale) {
    const values = termValues(result), output = {};
    for (const term of TERMS) {
      const low = poolScale.min[term.key], range = poolScale.max[term.key] - low;
      output[term.key] = range > 0 ? (values[term.key] - low) / range : null;
    }
    return output;
  }

  // Weighted mean of the rescaled terms. Terms that are constant in the pool are left out.
  function score(result, weights = {}, poolScale) {
    if (!poolScale || !poolScale.min || !poolScale.max) throw new Error('Scoring requires the scale of a pool of layouts.');
    const values = normalized(result, poolScale);
    let total = 0, weightSum = 0;
    for (const term of TERMS) {
      const weight = weights[term.key] ?? 1;
      if (!Number.isFinite(weight) || weight < 0) invalid();
      if (values[term.key] === null) continue;
      total += weight * values[term.key];
      weightSum += weight;
    }
    const output = weightSum > 0 ? total / weightSum : 0;
    if (!Number.isFinite(output)) throw new Error('The weighted score exceeds the supported range.');
    return output;
  }

  function compareIds(a, b) {
    const left = String(a ?? ''), right = String(b ?? '');
    if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
      const delta = Number(left) - Number(right);
      if (Number.isFinite(delta) && delta) return delta;
    }
    return left < right ? -1 : left > right ? 1 : 0;
  }

  function rank(results, weights = {}, poolScale = scale(results)) {
    return results.map((result, order) => ({result, order, score: score(result, weights, poolScale)}))
      .sort((a, b) => a.score - b.score ||
        ((Number.isFinite(a.result.index) ? a.result.index : Number.MAX_SAFE_INTEGER) -
         (Number.isFinite(b.result.index) ? b.result.index : Number.MAX_SAFE_INTEGER)) ||
        compareIds(a.result.id, b.result.id) || a.order - b.order)
      .map(entry => entry.result);
  }

  function selectedInRankOrder(results, weights, selectedIds) {
    const selected = new Set(Array.from(selectedIds || [], id => String(id)));
    return rank(results, weights).filter(result => selected.has(String(result.id)));
  }

  function token(value, label) {
    const text = String(value);
    if (!/^[A-Za-z0-9_]{1,24}$/.test(text)) {
      throw new Error(`${label} must be a short alphanumeric identifier.`);
    }
    return text;
  }

  function keyFor(result, batchId) {
    const mode = result.mode || 'generated';
    if (!['generated', 'nyu-fixed'].includes(mode)) throw new Error('Only candidate layouts can be saved.');
    return `${token(batchId, 'Batch ID')}-${mode}-${token(result.id, 'Candidate ID')}`;
  }

  // Saved layouts are rescaled against each other, whichever batches they came from.
  function rankedEntries(entries, weights) {
    const poolScale = scale(entries.map(entry => entry.result));
    // For identical saved scores, preserve the order in which layouts were saved.
    return entries.map((entry, order) => ({entry, order, score: score(entry.result, weights, poolScale)}))
      .sort((a, b) => a.score - b.score || a.order - b.order)
      .map(item => item.entry);
  }

  function create() {
    const entries = new Map();
    return {
      get size() { return entries.size; },
      add(result, batchId) {
        const key = keyFor(result, batchId);
        if (entries.has(key)) return entries.get(key);
        if (entries.size >= 512) throw new Error('Saved layouts are limited to 512. Remove a layout before adding another.');
        termValues(result);
        const entry = {key, batchId, originalId: result.id, result: clone(result)};
        entries.set(key, entry);
        return entry;
      },
      has(result, batchId) { return entries.has(keyFor(result, batchId)); },
      get(key) { return entries.get(key); },
      remove(key) { return entries.delete(key); },
      list(weights = {}) { return rankedEntries([...entries.values()], weights); }
    };
  }

  function exportCandidates(entries, weights = {}) {
    const poolScale = scale(entries.map(entry => entry.result));
    return rankedEntries(entries, weights).map((entry, index) => ({
      ...clone(entry.result),
      id: entry.key,
      rank: index + 1,
      score: score(entry.result, weights, poolScale),
      sourceCandidateId: entry.originalId,
      sourceBatchId: entry.batchId
    }));
  }

  const terms = TERMS.map(term => ({key: term.key, label: term.label}));
  return {terms, termValues, scale, normalized, score, rank, selectedInRankOrder, create, exportCandidates};
});
