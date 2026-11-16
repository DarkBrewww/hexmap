# Experiments

Each folder holds the scripts, the saved results and a README with the commands to run them again. Run the commands from the repository root.

| Folder | Question | Main result page |
| --- | --- | --- |
| `fixed-grid-overlap/` | On one fixed grid, which layout metrics go with morph overlap? Includes the path-crossing and neighbour-shear tests. | `fixed-grid-overlap/results/report.html`, `path_crossings.html`, `shear_test.html` |
| `staged-timing/` | Does the Linear morph overlap less when a district's travel and its change of outline are separated in time? | `staged-timing/results/staged_timing.html` |
| `weighted-ranking/` | A copy of `hex-layouts/` with a five-term ranking score, rescaled within the batch before weighting. | Open the page; see its README |

The first two use `evidence/morph_scores.cjs` and `evidence/evaluate_layouts.py` for the scores. `staged-timing/` builds on the candidates of `fixed-grid-overlap/`, so run that one first.
