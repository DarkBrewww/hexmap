# Staged timing experiment

Does the linear morph overlap less when a district's travel and its change of outline are separated in time?

`index.html` here is a copy of the morph page with one more method, **Staged linear**. The Linear and Forsch hybrid methods are unchanged, and the copy loads `hexmap_data.js`, `forsch_map_data.js` and `layout-import.js` from the repository root.

## The change

In the linear morph every outline point moves on a straight line to its hexagon point, so position, size and shape change together. Staged linear writes each point as its district's centre plus an offset and gives the two their own clocks over the same total time:

```
p(t) = src + (dst - src) a(t) + (cell centre - map centroid) (b(t) - a(t))
```

`a` is the outline clock and `b` the position clock. With `a = b = t` this is the linear morph exactly. Every part of a district uses the district's one pair of centres, so island rings travel with the main ring.

With stagger `s` between 0 and 1, the first clock runs over `[0, 1 - s/2]` and the second over `[s/2, 1]`. `s = 0` is the linear morph; at `s = 1` one clock runs in the first half and the other in the second.

| Rule | Outline clock | Position clock |
| --- | --- | --- |
| Outline first | first, for every district | second |
| Travel small | first for a district larger than its hexagon, second for a smaller one | the other clock |
| Three phases | phase 0 for a larger district, phase 2 for a smaller one | phase 1 for a larger district, phase 0 for a smaller one |

Three phases was added after the first two rules were scored. Large districts shrink while small ones travel, then the large ones travel, then the small ones grow. Phase `k` = 0, 1, 2 runs over `[k s/3, k s/3 + 1 - 2s/3]`, so at `s = 1` each phase has a third of the time, and `s = 0` is again the linear morph.

## Steps

Run from the repository root. Node.js needs `playwright` and `d3` in `node_modules`; Python 3 needs only the standard library. Set `HEXMAP_CHROMIUM` to a local Chrome or Chromium executable to skip Playwright's browser download.

```sh
node experiments/staged-timing/make_layouts.cjs
node experiments/staged-timing/staged_scores.cjs
python experiments/staged-timing/staged_analyze.py
```

1. `make_layouts.cjs` copies four candidates from `experiments/fixed-grid-overlap/` into `layouts.json`: the lowest Linear overlap peak of the 126, two more low ones, a middle one and the highest. The NYU layout is built into the page. It needs that folder's `candidates.json` and `candidates_extended.json`, which its `make_candidates.cjs` writes.
2. `staged_scores.cjs` opens this folder's page in headless Chromium and records, for each layout, the page's 101 frames for Linear and for Staged linear under every rule at stagger 0, 0.25, 0.5, 0.75 and 1. For every staged run it also compares the outlines at `t = 0` and `t = 1` with Linear's, checks that no outline leaves the rectangle the page scores, and measures the overlap of every pair of districts at 51 moments. It writes `runs/staged_frames.csv`, `runs/staged_runs.csv` and `runs/staged_pairs.csv`.
3. `staged_analyze.py` runs the checks and writes `results/checks.txt`, `results/summary.csv` and `results/staged_timing.html`.

## What is stored

The scripts, the page, `results/`, and the per-frame and per-run tables in `runs/` are in the repository. `layouts.json` and `runs/staged_pairs.csv` (the overlap of every pair of districts in every run) are large and are written again by steps 1 and 2, so they are not stored.

## Checks fixed in advance

- Stagger 0 reproduces the Linear scores of the same run, and those match `evidence/morph_scores.csv` and the fixed-grid experiment's `candidates*_morph.csv`.
- The outlines at `t = 0` and `t = 1` are identical to Linear's.
- Primary outcome: the Linear overlap peak as a function of stagger under the Travel small rule.
- For Three phases: the scores of the first two rules must not change when the third is added, and the overlap is read as a share, as an area and next to the emptiest moment of the run.

## Reading the overlap

The page reports overlap as a share of the area covered at that moment. A staged morph shrinks districts early, which lowers the covered area, so the share can rise while less area overlaps. `staged_analyze.py` therefore also reports the overlapping area in percent of the map's covered area at `t = 0`, and the emptiest moment of each run.

## Viewing the staged morph

Serve the repository root (`python -m http.server 8000 --bind 127.0.0.1`) and open `http://127.0.0.1:8000/experiments/staged-timing/`. Select **Staged linear**, then a rule and a stagger.
