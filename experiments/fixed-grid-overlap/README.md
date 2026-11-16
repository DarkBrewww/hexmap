# Fixed-grid overlap experiment

Which layout properties go with lower morph overlap when the grid itself does not change?

Every candidate here keeps the 436 NYU cells at the NYU size and spacing (the Fixed NYU grid mode of `hex-layouts/`). Only the assignment of districts to cells differs, so hexagon size and grid shape cannot explain differences in overlap.

## Steps

Run from the repository root. Node.js needs `playwright` and `d3` in `node_modules` (`npm install`); Python 3 needs only the standard library. Set `HEXMAP_CHROMIUM` to a local Chrome or Chromium executable to skip Playwright's browser download.

1. Build the candidates with the generator's own code:

   ```sh
   node experiments/fixed-grid-overlap/make_candidates.cjs --check evidence/friday_layouts.json
   node experiments/fixed-grid-overlap/make_candidates.cjs --seeds 42,1,2,3,4 --out experiments/fixed-grid-overlap/candidates_extended.json
   ```

   The first command writes the discovery set, `candidates.json`: Noise 0, 0.05, 0.1, 0.2, 0.4 by Transform 0, 0.2, 0.4, 0.6, 0.8, 1, seed 42. `--check` compares candidates that share an id with `evidence/friday_layouts.json` cell by cell. The second command adds seeds 1 to 4 for Noise above 0; `analyze.py` uses those 96 extra candidates as the replication set. Each file is read back with `layout-import.js` before it is saved, and a `_manifest.csv` lists every setting and any duplicate assignment that was dropped.

2. Score the morph and the layouts:

   ```sh
   node evidence/morph_scores.cjs experiments/fixed-grid-overlap/candidates.json experiments/fixed-grid-overlap/candidates_morph.csv
   python evidence/evaluate_layouts.py experiments/fixed-grid-overlap/candidates.json --morph experiments/fixed-grid-overlap/candidates_morph.csv --out experiments/fixed-grid-overlap/candidates-metrics
   ```

   Repeat both commands for `candidates_extended` (into `candidates_extended_morph.csv` and `candidates_extended-metrics/`).

3. Analyse:

   ```sh
   python experiments/fixed-grid-overlap/analyze.py
   ```

   Writes `results/correlations.csv`, `results/candidates_table.csv`, `results/noise_levels.csv` (one row per Noise level) and `results/report.html`.

4. Path-crossing test:

   ```sh
   python experiments/fixed-grid-overlap/path_crossings.py
   ```

   Treats each district's centre as moving on a straight line from its map centroid to its cell centre, as in the Linear morph. It counts crossing paths and close passes for every candidate and compares them with overlap and direction error. Writes `results/path_crossings.csv`, `results/path_crossings_correlations.csv` and `results/path_crossings.html`.

5. Neighbour-shear test:

   ```sh
   node experiments/fixed-grid-overlap/pair_overlap.cjs evidence/friday_layouts.json experiments/fixed-grid-overlap/pairs/friday
   node experiments/fixed-grid-overlap/pair_overlap.cjs experiments/fixed-grid-overlap/candidates.json experiments/fixed-grid-overlap/pairs/candidates
   node experiments/fixed-grid-overlap/pair_overlap.cjs experiments/fixed-grid-overlap/candidates_extended.json experiments/fixed-grid-overlap/pairs/candidates_extended
   python experiments/fixed-grid-overlap/shear_test.py
   ```

   `pair_overlap.cjs` reads each district's Linear outline from the morph page, fills the outlines on a pixel grid at 51 moments, and records how much each pair of districts overlaps. It also saves the page's own overlap for the same moments, so the two can be compared. `shear_test.py` asks whether the overlap comes from map neighbours, and whether it follows sliding, approach or direction error. It writes `results/shear_pairs.csv`, `results/shear_layouts.csv` and `results/shear_test.html`.

## What is stored

| In the repository | Purpose |
| --- | --- |
| `make_candidates.cjs`, `pair_overlap.cjs`, `analyze.py`, `path_crossings.py`, `shear_test.py` | The scripts for the steps above. |
| `candidates_manifest.csv`, `candidates_extended_manifest.csv` | Every parameter setting and its candidate id. |
| `candidates_morph.csv`, `candidates_extended_morph.csv` | The morph page's 101 frames per candidate and method, from step 2. |
| `candidates-metrics/layout_metrics.csv`, `candidates_extended-metrics/layout_metrics.csv` | One row per candidate with every layout metric and the overlap summary, from step 2. |
| `results/` | The reports and the tables behind them. |

The candidate files (`candidates.json`, `candidates_extended.json`), the other outputs of `evaluate_layouts.py`, and `pairs/` are large and are written again by steps 1, 2 and 5, so they are not stored. Steps 3 and 4 need the candidate files from step 1; step 5 needs `pairs/`.

## Reproduction check

Before the candidates were scored, `evidence/morph_scores.cjs` and `evidence/evaluate_layouts.py` were rerun on `evidence/friday_layouts.json`. The resulting `morph_scores.csv`, `layout_metrics.csv` and `layout_metrics_per_region.csv` matched the files in `evidence/` line for line, apart from line endings.
