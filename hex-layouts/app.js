(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const DATA = window.HEX_LAYOUT_INPUT, E = window.McNeillEngine, Jobs = window.HexLayoutJobs, Collection = window.HexLayoutCollection;
  const metricKeys = ['distance', 'adjacency', 'angle', 'roughness'];
  const metricLabels = {distance: 'Distance', adjacency: 'Adjacency', angle: 'Orientation', roughness: 'Roughness'};
  const state = {mode: 'generated', results: [], failures: [], weights: {distance: 1, adjacency: 1, angle: 1, roughness: 1}, selected: null, manualSelection: false, running: false, total: 0, completed: 0, worker: null, batch: 0, batchId: 0, exportIds: new Set(), savedPreview: null, shape: 'flat-side', started: 0, renderPending: false, reference: 'geography', focusState: ''};
  window.HexLayoutLab = {state, data: DATA};
  if (!DATA || !E || !Jobs || !Collection) {
    $('progress-status').textContent = 'Unable to load application files. Keep index.html, data.js, engine.js, jobs.js, collection.js, and app.js in the same folder.';
    $('generate').disabled = true;
    return;
  }
  const regionById = new Map(DATA.regions.map(r => [r.id, r]));
  const shapes = { 'flat-side': 'Flat-side · Vertical sides', 'flat-base': 'Flat-base · Horizontal top and bottom'};
  const colors = new Map([...new Set(DATA.regions.map(r => r.state))].sort().map((s, i) => [s, `hsl(${(i * 137.508 + 150) % 360} 36% 68%)`]));
  const modeLabels = {generated: 'Generated grid', 'nyu-fixed': 'Fixed NYU grid'};
  const batches = new Map();
  const savedLayouts = Collection.create();
  let batchSequence = 0;
  let baseline = null;
  try { baseline = Jobs.originalNyu(DATA); }
  catch (error) {
    $('layout-mode').querySelector('option[value="nyu-fixed"]').disabled = true;
    $('reference-view').querySelector('option[value="nyu-original"]').disabled = true;
    $('progress-status').textContent = `NYU target unavailable: ${error.message} Generated-grid mode is still available.`;
  }
  function saveBatch() {
    batches.set(state.mode, {results: state.results, failures: state.failures, selected: state.selected, manualSelection: state.manualSelection, total: state.total, completed: state.completed, shape: state.shape, reference: state.reference, batchId: state.batchId, exportIds: state.exportIds,
      inputs: Object.fromEntries(['noise', 'transform', 'smooth', 'shift'].map(id => [id, $(id).value])), inputShape: document.querySelector('input[name="shape"]:checked').value, status: $('progress-status').textContent});
  }
  function syncControls() {
    const fixed = state.mode === 'nyu-fixed';
    $('generate-form').querySelectorAll('input, select').forEach(el => { el.disabled = state.running; });
    $('orientation-fields').disabled = state.running || fixed;
    $('smooth').disabled = state.running || fixed; $('shift').disabled = state.running || fixed;
    $('fixed-ranking-note').hidden = !fixed;
    $('mode-note').textContent = fixed ? 'Keep the exact NYU cells; reassign districts using Noise and Transform. Orientation, Smooth, and Shift are locked.' : 'Generate the cell positions and district assignments.';
  }
  function switchMode(mode) {
    if (state.running || mode === state.mode || (mode === 'nyu-fixed' && !baseline)) return;
    saveBatch();
    const saved = batches.get(mode);
    Object.assign(state, {mode, results: [], failures: [], selected: null, manualSelection: false, total: 0, completed: 0, shape: 'flat-side', batchId: 0, exportIds: new Set(), reference: mode === 'nyu-fixed' ? 'nyu-original' : 'geography'}, saved || {});
    state.savedPreview = null;
    const inputs = saved?.inputs || {noise: '0, 0.05', transform: '0.6, 1', smooth: '0', shift: 'none'};
    for (const id of ['noise', 'transform', 'smooth', 'shift']) $(id).value = inputs[id];
    document.querySelector(`input[name="shape"][value="${mode === 'nyu-fixed' ? 'flat-side' : saved?.inputShape || 'flat-side'}"]`).checked = true;
    $('layout-mode').value = mode; $('reference-view').value = state.reference;
    $('progress-status').textContent = saved?.status || '';
    $('progress').max = state.total || 1; $('progress').value = state.completed; $('progress').hidden = !state.total;
    syncControls(); updateCount(); render();
  }
  let commonBounds = DATA.viewBox.slice();
  const sourcePaths = DATA.regions.map(r => ({region: r, path: new Path2D(r.path)}));
  let lazyObserver = null;
  let savedObserver = null;
  const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function numberValues(id, predicate, message) {
    const tokens = $(id).value.trim().split(/[,;\s]+/).filter(Boolean);
    if (!tokens.length) throw new Error(`${id} cannot be empty.`);
    const values = tokens.map(token => {
      if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(token)) throw new Error(`"${token}" is not a valid nonnegative number for ${id}.`);
      const value = Number(token);
      if (!Number.isFinite(value) || !predicate(value)) throw new Error(message);
      return value;
    });
    return [...new Set(values)];
  }
  function readParameters() {
    const noise = numberValues('noise', x => x >= 0 && x <= 2, 'Noise must be between 0 and 2.');
    const transform = numberValues('transform', x => x >= 0 && x <= 1, 'Transform must be between 0 and 1.');
    const fixed = state.mode === 'nyu-fixed';
    const smooth = fixed ? [0] : numberValues('smooth', x => x === 0 || (Number.isInteger(x) && x >= 3 && x <= 128), 'Smooth must be 0 or an integer between 3 and 128.');
    const shift = fixed ? ['none'] : [...new Set($('shift').value.toLowerCase().trim().split(/[,;\s]+/).filter(Boolean))];
    if (!shift.length || shift.some(x => !['none', 'x', 'y', 'xy'].includes(x))) throw new Error('Shift accepts only none, x, y, or xy.');
    const shape = fixed ? 'flat-side' : document.querySelector('input[name="shape"]:checked').value;
    const combinations = Jobs.combinations({noise, transform, smooth, shift, shape, mode: state.mode});
    if (combinations.length > 512) throw new Error(`${combinations.length} combinations exceed the limit of 512. Enter fewer parameter values.`);
    return {noise, transform, smooth, shift, shape, combinations};
  }
  function updateCount() {
    try { const p = readParameters(); $('combination-note').textContent = `${p.combinations.length} combinations`; $('input-error').hidden = true; }
    catch (error) { $('combination-note').textContent = error.message; }
  }
  function score(result) { return Collection.score(result, state.weights); }
  function sortedResults() { return Collection.rank(state.results, state.weights); }
  function paramsText(p) { return p.mode === 'nyu-fixed' ? `Noise ${p.noise} · Transform ${p.transform} · Fixed NYU cells` : `Noise ${p.noise} · Transform ${p.transform} · Smooth ${p.smooth} · Shift ${p.shift}`; }
  function fmt(x) { return Number.isFinite(x) ? x.toFixed(4) : '—'; }
  function element(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function updateBounds() {
    const [x, y, w, h] = DATA.viewBox;
    let minX = x, minY = y, maxX = x + w, maxY = y + h;
    const allResults = [baseline, ...state.results, ...savedLayouts.list(state.weights).map(entry => entry.result)];
    for (const result of allResults.filter(Boolean)) for (const c of result.cells) {
      const radius = (result.radius || result.step / Math.sqrt(3)) + 6;
      minX = Math.min(minX, c.x - radius); maxX = Math.max(maxX, c.x + radius);
      minY = Math.min(minY, c.y - radius); maxY = Math.max(maxY, c.y + radius);
    }
    commonBounds = [minX, minY, maxX - minX, maxY - minY];
  }
  function setupCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const ratio = Math.min(window.devicePixelRatio || 1, 2), width = rect.width, height = rect.height;
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
    const padding = 11, scale = Math.min((width - padding * 2) / commonBounds[2], (height - padding * 2) / commonBounds[3]);
    const tx = (width - commonBounds[2] * scale) / 2 - commonBounds[0] * scale;
    const ty = (height - commonBounds[3] * scale) / 2 - commonBounds[1] * scale;
    ctx.translate(tx, ty); ctx.scale(scale, scale);
    return {ctx, scale, width, height};
  }
  function drawSource() {
    const setup = setupCanvas($('source-map')); if (!setup) return;
    const {ctx, scale} = setup;
    const muted = cssVar('--map-muted'), highlight = cssVar('--map-highlight'), outline = cssVar('--map-outline');
    const paths = state.focusState ? [...sourcePaths].sort((a, b) => Number(a.region.state === state.focusState) - Number(b.region.state === state.focusState)) : sourcePaths;
    for (const item of paths) {
      const highlighted = state.focusState === item.region.state;
      ctx.fillStyle = state.focusState && !highlighted ? muted : colors.get(item.region.state); ctx.fill(item.path);
      ctx.strokeStyle = highlighted ? highlight : outline; ctx.lineWidth = (highlighted ? 1.2 : .35) / scale; ctx.stroke(item.path);
    }
  }
  function drawResult(canvas, result) {
    const setup = setupCanvas(canvas); if (!setup) return;
    const {ctx, scale, width, height} = setup;
    const muted = cssVar('--map-muted'), highlight = cssVar('--map-highlight'), outline = cssVar('--map-outline');
    if (!result) {
      ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      ctx.fillStyle = cssVar('--muted'); ctx.textAlign = 'center'; ctx.font = '13px system-ui'; ctx.fillText('Generated layouts appear here', width / 2, height / 2);
      return;
    }
    const cells = state.focusState ? [...result.cells].sort((a, b) => Number(regionById.get(a.id).state === state.focusState) - Number(regionById.get(b.id).state === state.focusState)) : result.cells;
    for (const cell of cells) {
      const vertices = E.hexCorners(cell, result.radius ? result.radius * Math.sqrt(3) : result.step, result.parameters.shape);
      ctx.beginPath(); vertices.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
      const regionState = regionById.get(cell.id).state, highlighted = state.focusState === regionState;
      ctx.fillStyle = state.focusState && !highlighted ? muted : colors.get(regionState); ctx.fill();
      ctx.strokeStyle = highlighted ? highlight : outline; ctx.lineWidth = (highlighted ? 1.2 : .45) / scale; ctx.stroke();
    }
  }
  function referenceResult() {
    return state.reference === 'nyu-original' && baseline ? {label: 'Original NYU hex map', result: baseline} : null;
  }
  function previewEntry() {
    return state.savedPreview ? savedLayouts.get(state.savedPreview) : null;
  }
  function selectedResult() {
    return previewEntry()?.result || state.results.find(r => r.id === state.selected);
  }
  function saveLayout(result, batchId) {
    try {
      savedLayouts.add(result, batchId);
      $('saved-status').textContent = '';
      render();
    } catch (error) { $('saved-status').textContent = error.message; }
  }
  function metricRow(label, result, selected) {
    const row = element('tr', selected ? 'selected-row' : '');
    const title = element('th', '', label); title.scope = 'row'; row.append(title);
    [score(result), ...metricKeys.map(key => result.metrics[key]), result.diagnostics.originalDisplacementMean].forEach(value => row.append(element('td', '', fmt(value))));
    return row;
  }
  function renderSelected(sorted) {
    const entry = previewEntry(), result = selectedResult();
    $('reference-view').value = state.reference;
    const reference = referenceResult();
    $('reference-title').textContent = reference?.label || 'Original geography';
    $('reference-shape').textContent = reference ? shapes[reference.result.parameters.shape] : 'Census · Albers USA';
    $('source-map').setAttribute('aria-label', `${reference?.label || 'Original geography'}${state.focusState ? `; ${state.focusState} highlighted` : ''}`);
    $('selected-title').textContent = result ? entry ? `Saved layout ${entry.originalId} · Batch ${entry.batchId}` : `Layout ${result.id} · Rank ${sorted.findIndex(r => r.id === result.id) + 1}` : state.mode === 'nyu-fixed' ? 'Reassigned layout' : 'Generated layout';
    $('selected-shape').textContent = result ? modeLabels[result.mode] : '';
    $('selected-map').setAttribute('aria-label', `Selected ${modeLabels[result?.mode || state.mode]} layout${state.focusState ? `; ${state.focusState} highlighted` : ''}`);
    const isSaved = result && savedLayouts.has(result, entry ? entry.batchId : state.batchId);
    $('save-selected').disabled = !result || isSaved;
    $('save-selected').textContent = isSaved ? 'Saved' : 'Save layout';
    $('metrics-body').replaceChildren();
    if (reference) $('metrics-body').append(metricRow(reference.label, reference.result, false));
    $('metrics-comparison').hidden = !result && !reference;
    if (result) {
      $('metrics-body').append(metricRow(`Selected layout ${result.id}`, result, true));
    }
    if (reference) drawResult($('source-map'), reference.result); else drawSource();
    drawResult($('selected-map'), result);
  }
  function renderFailures() {
    $('failure-section').hidden = state.failures.length === 0;
    $('failure-title').textContent = `Rejected combinations · ${state.failures.length}`;
    $('failures').replaceChildren();
    for (const f of state.failures) {
      const div = element('div', 'failure');
      const translations = {BOUNDARY_CROSSING: 'Transformed boundary intersects itself', BOUNDARY_DEGENERATE: 'Degenerate containing boundary', GRID_COUNT: 'Bounded search did not find the exact cell count', GRID_LIMIT: 'Grid density exceeded the safety limit'};
      div.append(element('div', '', `#${f.index + 1} · ${paramsText(f.parameters)}`), element('code', '', `${f.code} · ${translations[f.code] || 'Generation or validation failed'}`), element('div', 'muted', f.message));
      $('failures').append(div);
    }
  }
  function updateExportControls() {
    const count = state.results.filter(result => state.exportIds.has(String(result.id))).length;
    $('selection-count').textContent = `${count} selected`;
    $('select-all').disabled = !state.results.length || count === state.results.length;
    $('clear-selection').disabled = !count;
    $('export').disabled = $('export-scope').value === 'selected' ? !count : !state.results.length;
  }
  function renderSaved() {
    const entries = savedLayouts.list(state.weights);
    $('saved-count').textContent = entries.length;
    $('saved-empty').hidden = entries.length > 0;
    $('export-saved').disabled = entries.length === 0;
    if (savedObserver) savedObserver.disconnect();
    savedObserver = new IntersectionObserver(observations => {
      for (const observation of observations) if (observation.isIntersecting) {
        const entry = savedLayouts.get(observation.target.dataset.saved);
        if (entry) drawResult(observation.target, entry.result);
        savedObserver.unobserve(observation.target);
      }
    }, {rootMargin: '120px'});
    const fragment = document.createDocumentFragment();
    entries.forEach((entry, rank) => {
      const card = element('article', `saved-card${state.savedPreview === entry.key ? ' selected' : ''}`);
      card.dataset.savedKey = entry.key;
      const top = element('div', 'saved-card-top');
      top.append(element('h3', '', `#${rank + 1} · Layout ${entry.originalId}`));
      const remove = element('button', '', 'Remove'); remove.type = 'button';
      remove.setAttribute('aria-label', `Remove saved layout ${entry.originalId} from batch ${entry.batchId}`);
      remove.addEventListener('click', () => {
        savedLayouts.remove(entry.key);
        if (state.savedPreview === entry.key) state.savedPreview = null;
        $('saved-status').textContent = ''; render();
      });
      top.append(remove);
      const canvas = element('canvas'); canvas.dataset.saved = entry.key;
      canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `Saved layout ${entry.originalId}, batch ${entry.batchId}`);
      const description = element('p', 'muted', `${modeLabels[entry.result.mode]} · ${entry.result.parameters.shape} · Batch ${entry.batchId}`);
      const actions = element('div', 'saved-card-actions');
      actions.append(element('span', 'saved-score', `Score ${fmt(score(entry.result))}`));
      const view = element('button', '', state.savedPreview === entry.key ? 'Viewing' : 'View'); view.type = 'button';
      view.addEventListener('click', () => { state.savedPreview = entry.key; render(); $('selected-title').scrollIntoView({behavior: 'smooth', block: 'center'}); });
      actions.append(view); card.append(top, description, canvas, actions); fragment.append(card);
    });
    $('saved-list').replaceChildren(fragment);
    $('saved-list').querySelectorAll('canvas').forEach(canvas => savedObserver.observe(canvas));
  }
  function render() {
    state.renderPending = false; updateBounds();
    const sorted = sortedResults();
    if (!state.manualSelection && sorted.length) state.selected = sorted[0].id;
    renderSelected(sorted);
    $('result-summary').textContent = `${modeLabels[state.mode]} · ${state.completed}/${state.total} processed · ${state.results.length} valid · ${state.failures.length} rejected · ${new Set(state.results.map(r => r.signature)).size} unique layouts`;
    $('empty-state').hidden = state.results.length > 0;
    if (!state.results.length) {
      $('empty-state').querySelector('h3').textContent = state.completed ? 'No valid layouts' : (state.running ? 'Generating layouts…' : 'No layouts yet');
      $('empty-state').querySelector('p').textContent = state.failures.length ? 'Check the rejected combinations below for details.' : (state.running ? 'Results appear as each combination finishes.' : 'Set the parameters and select Generate layouts.');
    }
    updateExportControls();
    if (lazyObserver) lazyObserver.disconnect();
    const fragment = document.createDocumentFragment();
    const firstForSignature = new Map();
    [...state.results].sort((a, b) => a.index - b.index).forEach(r => { if (!firstForSignature.has(r.signature)) firstForSignature.set(r.signature, r.id); });
    const resultById = new Map(sorted.map(r => [String(r.id), r]));
    lazyObserver = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { drawResult(entry.target, resultById.get(entry.target.dataset.result)); lazyObserver.unobserve(entry.target); }
    }, {rootMargin: '300px'});
    sorted.forEach((result, rank) => {
      const card = element('article', `result-card${!state.savedPreview && state.selected === result.id ? ' selected' : ''}${state.exportIds.has(String(result.id)) ? ' export-selected' : ''}`);
      card.dataset.candidate = result.id;
      const top = element('div', 'result-top'), heading = element('div');
      const selection = element('label', 'card-select');
      const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.checked = state.exportIds.has(String(result.id));
      checkbox.setAttribute('aria-label', `Select layout ${result.id} for export`);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) { state.exportIds.add(String(result.id)); $('export-scope').value = 'selected'; }
        else state.exportIds.delete(String(result.id));
        card.classList.toggle('export-selected', checkbox.checked); updateExportControls();
      });
      selection.append(checkbox, element('span', 'rank', `#${rank + 1}`), element('small', '', `Layout ${result.id}`));
      heading.append(selection);
      const scoreLabel = element('span', 'score', fmt(score(result))); scoreLabel.title = 'Weighted score; lower is better'; top.append(heading, scoreLabel);
      const canvas = element('canvas'); canvas.dataset.result = result.id; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `Hex map for layout ${result.id}`);
      const metrics = element('div', 'card-metrics');
      metricKeys.forEach(key => { const div = element('div'); div.append(element('span', '', metricLabels[key]), element('b', '', fmt(result.metrics[key]))); metrics.append(div); });
      const bottom = element('div', 'card-bottom');
      const first = firstForSignature.get(result.signature);
      bottom.append(element('small', '', first === result.id ? `${result.cells.length} districts` : `Same arrangement as layout ${first}`));
      const actions = element('div', 'card-actions');
      const choose = element('button', '', !state.savedPreview && state.selected === result.id ? 'Selected' : 'Compare'); choose.type = 'button';
      choose.addEventListener('click', () => { state.savedPreview = null; state.selected = result.id; state.manualSelection = true; render(); $('selected-title').scrollIntoView({behavior: 'smooth', block: 'center'}); });
      const save = element('button', '', savedLayouts.has(result, state.batchId) ? 'Saved' : 'Save'); save.type = 'button';
      save.disabled = savedLayouts.has(result, state.batchId);
      save.setAttribute('aria-label', `Save layout ${result.id}`);
      save.addEventListener('click', () => saveLayout(result, state.batchId));
      actions.append(choose, save); bottom.append(actions);
      card.append(top, canvas, element('div', 'card-params', paramsText(result.parameters)), metrics, bottom); fragment.append(card);
    });
    $('results').replaceChildren(fragment);
    document.querySelectorAll('.result-card canvas').forEach(canvas => lazyObserver.observe(canvas));
    renderFailures();
    renderSaved();
  }
  function scheduleRender() { if (!state.renderPending) { state.renderPending = true; requestAnimationFrame(render); } }
  function setRunning(running) {
    state.running = running;
    syncControls();
    $('generate').disabled = running; $('cancel').hidden = !running; $('progress').hidden = state.total === 0;
  }
  function handleMessage(message) {
    if (message.type === 'done') { finish(false); return; }
    if (message.type !== 'result' && message.type !== 'failure') return;
    state.completed++;
    if (message.type === 'result') state.results.push({...message.result, index: message.index, id: message.index + 1, elapsed: message.elapsed});
    else state.failures.push(message);
    $('progress').value = state.completed; $('progress').max = state.total;
    $('progress-status').textContent = `Processing ${state.completed}/${state.total} · ${state.results.length} valid · ${state.failures.length} rejected`;
    scheduleRender();
  }
  function finish(cancelled) {
    if (state.worker) { state.worker.terminate(); state.worker = null; }
    setRunning(false);
    $('progress-status').textContent = `${cancelled ? 'Stopped; results retained' : 'Complete'} · ${( (performance.now() - state.started) / 1000).toFixed(1)} s · ${state.results.length} valid / ${state.failures.length} rejected`;
    render();
  }
  async function fallback(data, combinations, batch) {
    $('progress-status').textContent = 'Generating… Progress updates after each layout.';
    for (let i = 0; i < combinations.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 25));
      if (batch !== state.batch || !state.running) return;
      const start = performance.now();
      try { handleMessage({type: 'result', index: i, result: Jobs.runOne(data, combinations[i]), elapsed: performance.now() - start}); }
      catch (error) { handleMessage({type: 'failure', index: i, parameters: combinations[i], code: error.code || 'GENERATION_FAILED', message: error.message}); }
    }
    if (batch === state.batch && state.running) finish(false);
  }
  function run() {
    let input;
    try { input = readParameters(); $('input-error').hidden = true; }
    catch (error) { $('input-error').textContent = error.message; $('input-error').hidden = false; return; }
    state.batch++; state.batchId = ++batchSequence; state.exportIds = new Set(); state.savedPreview = null;
    state.results = []; state.failures = []; state.selected = null; state.manualSelection = false; state.completed = 0; state.total = input.combinations.length; state.shape = input.shape; state.started = performance.now();
    $('export-status').textContent = '';
    const batch = state.batch;
    const data = {groups: DATA.groups.map(g => ({id: g.id, regions: g.regions, boundary: g.boundary})), regions: DATA.regions.map(({id, center, neighbors, name, state}) => ({id, center, neighbors, name, state})), nyuTarget: DATA.nyuTarget};
    setRunning(true); $('progress').value = 0; $('progress').max = state.total; $('progress-status').textContent = 'Generating…'; render();
    if (location.protocol === 'file:') { fallback(data, input.combinations, batch); return; }
    try {
      const worker = new Worker('worker.js'); state.worker = worker;
      worker.onmessage = event => { if (batch === state.batch && state.running) handleMessage(event.data); };
      worker.onerror = event => {
        event.preventDefault(); worker.terminate(); state.worker = null;
        if (!state.completed && state.running) fallback(data, input.combinations, batch);
        else { finish(true); $('progress-status').textContent += ` · Background computation error: ${event.message}`; }
      };
      worker.postMessage({type: 'generate', data, combinations: input.combinations});
    } catch (error) { fallback(data, input.combinations, batch); }
  }
  $('generate-form').addEventListener('submit', event => { event.preventDefault(); run(); });
  $('layout-mode').addEventListener('change', () => switchMode($('layout-mode').value));
  $('reference-view').addEventListener('change', () => { state.reference = $('reference-view').value; renderSelected(sortedResults()); });
  for (const abbreviation of colors.keys()) {
    const count = DATA.regions.filter(r => r.state === abbreviation).length;
    const option = element('option', '', `${abbreviation} (${count} ${count === 1 ? 'district' : 'districts'})`); option.value = abbreviation; $('state-focus').append(option);
  }
  $('state-focus').addEventListener('change', () => {
    state.focusState = $('state-focus').value;
    render();
  });
  $('save-selected').addEventListener('click', () => {
    const result = selectedResult();
    if (result) saveLayout(result, previewEntry()?.batchId || state.batchId);
  });
  $('export-scope').addEventListener('change', updateExportControls);
  $('select-all').addEventListener('click', () => { state.exportIds = new Set(state.results.map(r => String(r.id))); $('export-scope').value = 'selected'; render(); });
  $('clear-selection').addEventListener('click', () => { state.exportIds.clear(); render(); });
  $('generate-form').querySelectorAll('input').forEach(el => el.addEventListener('input', updateCount));
  $('cancel').addEventListener('click', () => { state.batch++; finish(true); });
  $('weights-form').addEventListener('submit', event => {
    event.preventDefault();
    const weights = Object.fromEntries(metricKeys.map(key => [key, Number($(`weight-${key}`).value)]));
    if (metricKeys.some(key => $(`weight-${key}`).value.trim() === '') || Object.values(weights).some(x => !Number.isFinite(x) || x < 0)) { $('weight-error').hidden = false; $('weight-error').textContent = 'Weights must be finite, nonnegative numbers.'; return; }
    try {
      for (const result of [baseline, ...state.results, ...savedLayouts.list(state.weights).map(entry => entry.result)].filter(Boolean)) Collection.score(result, weights);
    } catch (error) { $('weight-error').hidden = false; $('weight-error').textContent = error.message; return; }
    $('weight-error').hidden = true; state.weights = weights; state.manualSelection = false; render();
    $('progress-status').textContent = `Reranked ${state.results.length} layouts.${Object.values(weights).every(x => x === 0) ? ' All weights are zero; showing generation order.' : ''}`;
  });
  function candidateRecord(result, rank) {
    return {rank, id: result.id, mode: result.mode, parameters: result.parameters, metrics: result.metrics, weightedCost: score(result),
      cells: result.cells, grid: result.grid, step: result.step, radius: result.radius, referenceStep: result.referenceStep,
      diagnostics: result.diagnostics, perRegion: result.perRegion,
      sourceCandidateId: result.sourceCandidateId, sourceBatchId: result.sourceBatchId};
  }
  function exportPayload(candidates, scope) {
    const modes = new Set(candidates.map(result => result.mode));
    const includesNyu = modes.has('nyu-fixed');
    return {format: 'hex-layout-lab-v2', mode: modes.size === 1 ? [...modes][0] : 'mixed', algorithm: E.version,
      exportedAt: new Date().toISOString(), source: DATA.metadata, exportScope: scope, exportedCount: candidates.length,
      completed: scope === 'saved' ? candidates.length : state.completed,
      total: scope === 'saved' ? candidates.length : state.total,
      incomplete: scope === 'saved' ? false : state.completed < state.total, weights: {...state.weights},
      failures: scope === 'saved' ? [] : state.failures,
      nyuTarget: includesNyu ? DATA.nyuTarget : undefined,
      originalNyuBaseline: includesNyu && baseline ? {metrics: baseline.metrics, diagnostics: baseline.diagnostics, cells: baseline.cells, radius: baseline.radius} : undefined,
      candidates};
  }
  function downloadExport(output, name, statusId) {
    if (!output.candidates.length) return;
    const blob = new Blob([JSON.stringify(output, null, 2)], {type: 'application/json'});
    if (blob.size > 64 * 1024 * 1024) {
      $(statusId).textContent = 'This group exceeds the morph viewer\'s 64 MiB limit. Select fewer layouts.';
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = element('a'); link.href = url; link.download = `${name}-${Date.now()}.json`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    $(statusId).textContent = `Exported ${output.candidates.length} ${output.candidates.length === 1 ? 'layout' : 'layouts'} in rank order.`;
  }
  $('export').addEventListener('click', () => {
    const scope = $('export-scope').value;
    // Filter after ranking so selected candidates retain their displayed ranks.
    const candidates = sortedResults().map((result, index) => candidateRecord(result, index + 1))
      .filter(result => scope !== 'selected' || state.exportIds.has(String(result.id)));
    downloadExport(exportPayload(candidates, scope), `hex-layout-${state.mode}-${state.shape}-${scope}`, 'export-status');
  });
  $('export-saved').addEventListener('click', () => {
    const candidates = Collection.exportCandidates(savedLayouts.list(state.weights), state.weights)
      .map((result, index) => candidateRecord(result, index + 1));
    downloadExport(exportPayload(candidates, 'saved'), 'hex-layout-saved-group', 'saved-status');
  });
  const main = DATA.groups.find(g => g.id === 'mainland');
  $('boundary-note').textContent = `The mainland boundary uses the largest exterior Census ring: ${main.boundary.length} vertices resampled to 512 equally spaced points. Small offshore rings and holes do not constrain generation; the reference map shows all original geometry. Self-intersecting generated boundaries are rejected.`;
  syncControls(); updateCount(); render();
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 150); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
  window.HexLayoutLab.getRankedResults = sortedResults;
})();
