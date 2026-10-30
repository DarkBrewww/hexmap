# Evidence for the Oct 30 meeting

Each script reads files in this folder or the repository root and prints the numbers used in the meeting notes. The `_output.txt` files are those prints, from running the scripts on Oct 29, so the numbers can be shown without running anything. Scripts need only Python 3 (standard library) or Node.js.

| File | Run | Backs these claims |
|---|---|---|
| `layout_scores.py` | `python layout_scores.py` | Pairs kept, hex pairs, states split and state borders kept for NYU and all six layouts in `friday_layouts.json`; 318 of 1,136 district neighbour pairs cross a state line |
| `county_stats.py` | `python county_stats.py` | The district vs. county table: units, neighbour pairs, share across state lines, units per state, neighbours per unit, and how far a one-tile-per-unit map moves tiles away from land area |
| `hungarian_timing.cjs` | `node hungarian_timing.cjs` | How long the assignment step in `hex-layouts/engine.js` takes for 436 and for 3,142 units |
| `friday_layouts.json` | import in `index.html` | Our two Meulemans layouts plus four made with `hex-layouts/` at the settings in their IDs (noise n, transform t, smooth s, shift), picked as the two per mode that kept the most neighbour pairs |
| `meulemans_touching.json` | import in `index.html` | Our two layouts drawn with touching hexes, the way generated layouts from `hex-layouts/` are drawn (`node ownlayout/export_layouts.cjs evidence/meulemans_touching.json --radius-ratio=1`) |
| `data/counties-albers-10m.json` | input | Census 2017 cartographic county boundaries as TopoJSON, from us-atlas 3.0.1 (https://github.com/topojson/us-atlas, ISC licence in `data/us-atlas-LICENSE.txt`) |

Neighbours are units that share a stretch of border, not just a corner, for both districts (`map_neighbors` in `hexmap_data.js`) and counties (a shared TopoJSON arc).

State FIPS codes in `county_stats_output.txt`: 04 Arizona, 32 Nevada, 56 Wyoming, 51 Virginia, 44 Rhode Island, 11 DC.
