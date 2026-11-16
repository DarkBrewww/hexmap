'use strict';
importScripts('engine.js', 'jobs.js');
self.onmessage = function (event) {
  if (event.data.type !== 'generate') return;
  const {data, combinations} = event.data;
  for (let i = 0; i < combinations.length; i++) {
    const parameters = combinations[i];
    const start = performance.now();
    try {
      const result = HexLayoutJobs.runOne(data, parameters);
      self.postMessage({type: 'result', index: i, total: combinations.length, result, elapsed: performance.now() - start});
    } catch (error) {
      self.postMessage({type: 'failure', index: i, total: combinations.length, parameters, code: error.code || 'GENERATION_FAILED', message: error.message});
    }
  }
  self.postMessage({type: 'done', total: combinations.length});
};
