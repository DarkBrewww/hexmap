# Evidence for the Oct 30 meeting, and the layout evaluation

Each script reads files in this folder or the repository root and prints the numbers used in the meeting notes. The `_output.txt` files are those prints, from running the scripts on Oct 29, so the numbers can be shown without running anything. Scripts need only Python 3 (standard library) or Node.js.

| File | Run | Backs these claims |
|---|---|---|
| `layout_scores.py` | `python layout_scores.py` | Pairs kept, hex pairs, states split and state borders kept for NYU and all six layouts in `friday_layouts.json`; 318 of 1,136 district neighbour pairs cross a state line |
| `county_stats.py` | `python county_stats.py` | The district vs. county table: units, neighbour pairs, share across state lines, units per state, neighbours per unit, and how far a one-tile-per-unit map moves tiles away from land area |
| `hungarian_timing.cjs` | `node hungarian_timing.cjs` | How long the assignment step in `hex-layouts/engine.js` takes for 436 and for 3,142 units |
| `evaluate_layouts.py` | `python evidence/evaluate_layouts.py > evidence/evaluate_layouts_output.txt` | Every grid-map quality facet for NYU and the six layouts: location, adjacency kept and added, direction, Deform-k and OrthoOrder-k (k = 5, 15, 50, 100, all), roughness, footprint shape, state structure, plus the morph scores. Writes `layout_metrics.csv`, `layout_metrics_per_region.csv`, `layout_metrics_summary.md` (definitions, Pareto set, checks) and `layout_scorecard.svg`. Standard library only; first rechecks the numbers in `layout_scores_output.txt` |
| `morph_scores.cjs` | `npm install`, then `node evidence/morph_scores.cjs` | Overlap, self-crossings and area change for every layout and both methods, read from `index.html` in headless Chromium (the page's own 101 frames, as in its CSV download). Writes `morph_scores.csv`, which `evaluate_layouts.py` reads |
| `friday_layouts.json` | import in `index.html` | Our two Meulemans layouts plus four made with `hex-layouts/` at the settings in their IDs (noise n, transform t, smooth s, shift), picked as the two per mode that kept the most neighbour pairs |
| `meulemans_touching.json` | import in `index.html` | Our two layouts drawn with touching hexes, the way generated layouts from `hex-layouts/` are drawn (`node ownlayout/export_layouts.cjs evidence/meulemans_touching.json --radius-ratio=1`) |
| `data/counties-albers-10m.json` | input | Census 2017 cartographic county boundaries as TopoJSON, from us-atlas 3.0.1 (https://github.com/topojson/us-atlas, ISC licence in `data/us-atlas-LICENSE.txt`) |

Neighbours are units that share a stretch of border, not just a corner, for both districts (`map_neighbors` in `hexmap_data.js`) and counties (a shared TopoJSON arc).

State FIPS codes in `county_stats_output.txt`: 04 Arizona, 32 Nevada, 56 Wyoming, 51 Virginia, 44 Rhode Island, 11 DC.
