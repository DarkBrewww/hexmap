/* Which layout ranks first under different weights?
 *
 *   node weights-demo.cjs [--mode generated|nyu-fixed]
 *
 * Builds one batch with the page's default parameter values (Generated grid: Noise 0, 0.05 x
 * Transform 0.6, 1 x Smooth 20 x Shift none, x, y, xy; Fixed NYU grid: Noise 0, 0.05 x Transform
 * 0.6, 1) and ranks it with the page's own scoring code under several weight settings.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {parseArgs} = require('node:util');
const Jobs = require('./jobs.js');
const Collection = require('./collection.js');
const {values} = parseArgs({options: {mode: {type: 'string', default: 'generated'}}});
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'hex-layouts', 'data.json'), 'utf8'));

const combinations = Jobs.combinations({mode: values.mode, noise: [0, .05], transform: [.6, 1], smooth: [20],
  shift: ['none', 'x', 'y', 'xy'], shape: 'flat-side'});
const results = combinations.map((parameters, index) => ({...Jobs.runOne(data, parameters), index, id: index + 1}));
const keys = Collection.terms.map(term => term.key);
const weights = (base, extra = {}) => ({...Object.fromEntries(keys.map(key => [key, base])), ...extra});
const settings = [
  ['Balanced: every weight 1', weights(1)],
  ['Transition first: Orientation 5', weights(1, {angle: 5})],
  ['Neighbours first: Adjacency 5', weights(1, {adjacency: 5})],
  ['States first: States split 5', weights(1, {statesSplit: 5})],
  ['Compact outline first: Roughness 5', weights(1, {roughness: 5})],
  ['Stay in place first: Original movement 5', weights(1, {originalMovement: 5})],
  ['Orientation only', weights(0, {angle: 1})],
  ['Adjacency only', weights(0, {adjacency: 1})],
  ['States split only', weights(0, {statesSplit: 1})],
  ['Roughness only', weights(0, {roughness: 1})],
  ['Original movement only', weights(0, {originalMovement: 1})]
];
const describe = p => p.mode === 'nyu-fixed' ? `Noise ${p.noise}, Transform ${p.transform}`
  : `Noise ${p.noise}, Transform ${p.transform}, Shift ${p.shift}`;
const scale = Collection.scale(results);
console.log(`${values.mode}: ${results.length} layouts` +
  (scale.constant.length ? `; constant, so not scored: ${scale.constant.join(', ')}` : ''));
console.log(['Weights', 'First', 'Parameters', 'Score', ...Collection.terms.map(term => term.label)].join(' | '));
for (const [name, w] of settings) {
  const first = Collection.rank(results, w)[0], raw = Collection.termValues(first);
  console.log([name, `Layout ${first.id}`, describe(first.parameters), Collection.score(first, w, scale).toFixed(3),
    ...keys.map(key => key === 'statesSplit' ? raw[key] : raw[key].toFixed(3))].join(' | '));
}
const winners = new Set(settings.map(([, w]) => Collection.rank(results, w)[0].id));
console.log(`${winners.size} different layouts rank first across these ${settings.length} settings.`);
