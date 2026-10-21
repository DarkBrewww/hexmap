# Hex Map Layouts

A browser application for generating, ranking, and comparing hexagonal layouts of the 119th U.S. congressional districts. It supports a McNeill-and-Hale-based generation pipeline and district reassignment on the fixed NYU Congressional District Health Dashboard grid.

## Requirements and usage

A modern browser is sufficient to view the supplied data and generate layouts. The application has no CDN dependencies and does not require Java, Node.js, or a package installation for browser use.

Serve the project directory with any static HTTP server. For example, with Python 3 installed:

```sh
python -m http.server 8001 --bind 127.0.0.1
```

Open [http://127.0.0.1:8001/](http://127.0.0.1:8001/). HTTP serving enables background computation in a Web Worker. Opening `index.html` directly uses a main-thread fallback, which may make the interface less responsive during generation.

Alternatively, serve the repository root on port 8000 and open [http://127.0.0.1:8000/hex-layouts/](http://127.0.0.1:8000/hex-layouts/). The morph comparison remains available at the root URL. Export layouts here, then import the JSON file using **Import layout JSON** in the morph viewer.

1. Choose **Generated grid** or **Fixed NYU grid**.
2. Enter comma-separated parameter values and select **Generate layouts**.
3. Compare candidates with **Original geography** or **Original NYU hex map**.
4. Adjust the four ranking weights and select **Update ranking**. This changes the ordering, not the generated geometry or raw metrics.
5. Use **Save** to collect candidates in **Saved layouts**. **View** previews a saved candidate; **Remove** removes that saved copy.

State colors remain consistent across views. **Highlight state** isolates a state's districts without changing assignments or metrics.

## Generation modes

### Generated grid

The implementation follows the main steps of McNeill and Hale's *Generating Tile Maps*: centroid perturbation, synchronous position updates, boundary transformation and smoothing, exact-count grid fitting, and minimum-cost assignment with the Hungarian algorithm.

| Parameter | Meaning |
| --- | --- |
| Noise | Deterministic random centroid displacement, from 0 to 2. Zero disables perturbation. |
| Transform | Interpolation between original and transformed centroid positions, from 0 to 1. |
| Smooth | Boundary basis-function count: 3 to 128, or 0 to disable smoothing. Fewer basis functions generally produce a smoother boundary. |
| Shift | Half-step grid offset: `none`, `x`, `y`, or `xy`. |
| Hex orientation | Flat-side, with vertical sides, or flat-base, with horizontal bases. |

The 433 mainland districts use a common containing boundary. Alaska and Hawaii are placed near their projected insets on the same lattice, with the same hex size. This inset placement is an application-specific adaptation. The mainland boundary is the largest exterior Census ring, resampled to 512 points; small offshore components and holes do not constrain generation.

The random seed is 42. The same Noise value uses a shared perturbation sample across other parameter choices and both modes. Distinct parameter combinations can produce identical arrangements.

### Fixed NYU grid

This mode preserves the original NYU grid's 436 occupied cells, orientation, spacing, and drawn radius. Only district assignments change. The original grid is aligned to the geographic map once, using the morph viewer's uniform scale, translation, and vertical flip; it is not refitted for each candidate.

Noise and Transform use the same mainland centroid transformation as generated mode. A single Hungarian assignment then minimizes squared distance from all 436 transformed district centers to the fixed cells. There are no state or inset assignment restrictions. Smooth, Shift, and orientation are locked. Roughness is constant because the occupied-cell geometry does not change.

## Metrics and ranking

All four ranking metrics are lower-is-better and include all 436 districts. The weighted score is the sum of each metric multiplied by its weight; it is not divided by the sum of weights.

| Metric | Definition |
| --- | --- |
| Distance | Mean distance from transformed centroids to assigned cell centers, divided by the original mainland grid reference step. |
| Adjacency | Mean fraction of each district's original neighbors that are no longer adjacent. |
| Orientation | Mean angular error to original geographic neighbors, averaged within each district and then across districts, in radians. |
| Roughness | Occupied-grid perimeter divided by the perimeter of an equal-area circle, minus one. Drawing gaps between individual hexagons are excluded. |

**Original movement** is reported separately: mean distance from original geographic centroids to assigned cell centers, divided by the same reference step in both modes. It is not part of the weighted score.

Distance excludes the movement introduced by Transform itself. The original NYU reference uses untransformed geographic centers, so its Distance and weighted score are not strictly comparable with candidates that use transformed centers. A lower score alone does not establish better geographic fidelity. Ranking weights apply after assignment; they do not change the Hungarian objective or optimize the four metrics jointly.

## Saved layouts and JSON exports

**Export JSON** offers two scopes for the active batch:

- **All layouts:** every accepted candidate, in current rank order.
- **Selected layouts:** checked candidates, in current rank order, retaining their displayed rank numbers. The order of checkbox clicks does not affect export order.

**Export saved group** exports the saved collection in its current weighted rank order. Saved groups can combine modes and generation batches. Candidate IDs in a saved export are unique across batches; `sourceCandidateId` and `sourceBatchId` preserve their original identities. A mixed group has file-level `mode: "mixed"`, while each candidate retains its own mode.

Saving and checking for partial export are separate actions. Saved candidates are independent snapshots and survive mode changes or new generation batches. They are held in memory and are cleared when the page is reloaded. Export them before leaving the page.

Exports use `hex-layout-lab-v2` and contain district assignments, grid geometry, parameters, metrics, and source metadata. They can be imported by Hexmap Morph Comparison without changing their coordinates. The saved collection is limited to 512 candidates; exports larger than 64 MiB are rejected to match the morph viewer's import limit.

## Data and coordinates

The supplied snapshot contains 435 congressional districts and the District of Columbia from the Census `cb_2024_us_cd119_20m` geometry used by the morph viewer. Original adjacency comes from shared Census boundary segments; corner-only contacts and water connections are not added.

Coordinates use the unchanged defaults of `d3.geoAlbersUsa()` and representative centers from `d3.geoPath(projection).centroid(feature)`. Screen coordinates increase rightward and downward. Source geography, generated candidates, and the fixed NYU reference share these coordinate units. Generated hex size may differ from the NYU grid.

The NYU layout is the design of the Department of Population Health, NYU Langone Health, Congressional District Health Dashboard. Preserve that attribution when sharing derived figures or data, and check the dashboard's terms and permissions before publication.

## Validation and limitations

- Every accepted layout assigns each district exactly once to a unique, finite cell on a regular hexagonal lattice with disjoint tile interiors.
- These checks do not guarantee preserved adjacency, a connected footprint, absence of holes, or an optimal layout.
- Generated containing boundaries with self-intersections are rejected.
- Grid fitting is bounded to 50 iterations. A failed combination does not prove that no suitable grid exists.
- A batch tests the Cartesian product of the supplied parameter values, up to 512 combinations. It does not enumerate all district-to-cell permutations or all optimal assignments.
- Boundary sampling, numerical implementation, and inset handling are adaptations; this is not the authors' official software or a claim of pixel-identical reproduction of their demonstration.
- State colors use a deterministic HSL rule: `H = (150 + 137.508 * i) % 360`, `S = 36%`, `L = 68%`, with `i` the zero-based index of the sorted state abbreviations. These colors are not NYU's palette or thematic data. Similar hues can be difficult to distinguish; use state highlighting when necessary.

## Project structure

| File | Purpose |
| --- | --- |
| `index.html`, `style.css`, `app.js` | Interface, map rendering, controls, ranking, and downloads. |
| `engine.js` | Generation algorithm, geometric validation, and metrics. |
| `jobs.js` | Full-map assembly, fixed-cell reassignment, and NYU reference evaluation. |
| `collection.js` | Ranking, selection, and saved-layout snapshots. |
| `worker.js` | Background batch processing. |
| `data.js`, `data.json` | Equivalent browser and development input snapshots. |
| `prepare-data.mjs` | Rebuilds both snapshots from the morph viewer's source data. |
| `*-tests.cjs` | Algorithm, geometry, collection, and export compatibility checks. |

## Development

Use Node.js 18 or newer to run the checks from this directory:

```sh
node engine-tests.cjs
node integration-tests.cjs
node fixed-target-tests.cjs
node collection-tests.cjs
```

For a larger generated-layout sweep:

```sh
node integration-tests.cjs --full
```

The export compatibility check uses the morph viewer's `layout-import.js` in the parent directory:

```sh
node export-integration-tests.cjs
```

To rebuild `data.js` and `data.json`, first run `npm install` at the repository root, then run from this directory:

```sh
node prepare-data.mjs
```

Snapshot preparation reads `hexmap_data.js` and uses the morph project's D3 installation. It writes only this project's two data snapshots. These development dependencies are not needed to run the browser application with the supplied snapshots.

The scripts use the repository root by default. For a different source checkout, pass `--source-dir=/path/to/hexmap` to snapshot preparation or `--morph-dir=/path/to/hexmap` to the export compatibility check.

## References

- McNeill, G. and Hale, S. A. (2017). *Generating Tile Maps*. [DOI: 10.1111/cgf.13200](https://doi.org/10.1111/cgf.13200). [Authors' demonstration](https://gjmcn.github.io/tile-maps-eurovis-demo/).
- Department of Population Health, NYU Langone Health. [Congressional District Health Dashboard](https://www.congressionaldistricthealthdashboard.org/). Hex layout accessed September 26, 2026.
- U.S. Census Bureau. [2024 cartographic boundary files: congressional districts](https://www2.census.gov/geo/tiger/GENZ2024/shp/).
