/* Candidate ranking, partial exports, and independent saved-layout snapshots. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HexLayoutCollection = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';
  const METRICS = ['distance', 'adjacency', 'angle', 'roughness'];
  const clone = value => typeof structuredClone === 'function'
    ? structuredClone(value) : JSON.parse(JSON.stringify(value));

  function score(result, weights = {}) {
    const total = METRICS.reduce((sum, name) => {
      const weight = weights[name] ?? 1, value = result.metrics?.[name];
      if (!Number.isFinite(weight) || weight < 0 || !Number.isFinite(value) || value < 0) {
        throw new Error('Ranking requires finite, nonnegative weights and metrics.');
      }
      return sum + weight * value;
    }, 0);
    if (!Number.isFinite(total)) throw new Error('The weighted score exceeds the supported range.');
    return total;
  }

  function compareIds(a, b) {
    const left = String(a ?? ''), right = String(b ?? '');
    if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
      const delta = Number(left) - Number(right);
      if (Number.isFinite(delta) && delta) return delta;
    }
    return left < right ? -1 : left > right ? 1 : 0;
  }

  function rank(results, weights = {}) {
    return results.map((result, order) => ({result, order, score: score(result, weights)}))
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

  function rankedEntries(entries, weights) {
    // For identical saved scores, preserve the order in which layouts were saved.
    return entries.map((entry, order) => ({entry, order, score: score(entry.result, weights)}))
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
        score(result);
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
    return rankedEntries(entries, weights).map((entry, index) => ({
      ...clone(entry.result),
      id: entry.key,
      rank: index + 1,
      score: score(entry.result, weights),
      sourceCandidateId: entry.originalId,
      sourceBatchId: entry.batchId
    }));
  }

  return {score, rank, selectedInRankOrder, create, exportCandidates};
});
