# Hexmap Morph Comparison

Compare linear and Forsch-derived transitions from the 119th Congress geographic map to a hexagonal layout. The application includes 436 districts: 435 congressional districts and the District of Columbia. Targets can use the original Congressional District Health Dashboard layout or a JSON export from Hex Map Layouts.

The [Hex Map Layouts application](hex-layouts/README.md) is included in `hex-layouts/`. It generates and ranks candidate hex layouts using a McNeill-and-Hale-based pipeline, or reassigns districts on the fixed NYU grid. Export candidates as JSON and import them into the morph viewer to compare the resulting transitions.

## Run the application

Serve this directory with any static HTTP server. For example, with Python 3 installed:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Open [http://127.0.0.1:8000/](http://127.0.0.1:8000/) in a modern browser. Keep `index.html`, `hexmap_data.js`, `forsch_map_data.js`, and `layout-import.js` together. The main page loads D3 7.9.0 from cdnjs and therefore needs an internet connection. The server serves files from this directory; it is not a data-processing backend.

With the same server running, open [http://127.0.0.1:8000/hex-layouts/](http://127.0.0.1:8000/hex-layouts/) for the layout generator. It uses bundled data and has no CDN dependencies.

Node.js and Java are not required to view the supplied animations. They are needed only for the build and validation workflows below. `district_morph.html` and `forsch_kansas.html` contain their display data and can also be opened directly for offline viewing.

## Controls and layout imports

- Choose **Linear** or **Forsch hybrid**, use **Map** and **Hexes** to select an endpoint, or use **Play** and the time slider to inspect the transition.
- Enable **Hex outlines** or **Overlaps** to show target cells or overlapping districts.
- Click a district to inspect neighbors retained between maps, neighbors present only in the geographic map, and neighbors present only in the hex layout. Press Escape to clear the selection.
- Hover over a metric chart to inspect a sample; click it to move to that time. **Download scores (CSV)** exports the sampled results and target metadata.
- Default district colors encode movement distance in hex steps, not state identity.

To use a different target, choose **Import layout JSON**, select a `hex-layout-lab-v2` export from Hex Map Layouts, and choose a candidate under **Target layout**. Single-mode batches and saved groups containing multiple layout modes are supported. Choose **Original NYU layout** to restore the reference layout. Imports are held in browser memory and are cleared when the page is reloaded.

An imported candidate must contain exactly the current 436 district IDs, regular hexagonal lattice geometry, and the unchanged default `d3.geoAlbersUsa()` projection metadata. Generated and fixed-NYU layouts, including flat-side and flat-base hexagons, are supported. Exported positions and drawn radii are preserved without refitting. Adjacency is reconstructed from the district assigned to each cell, not from the original occupant of that cell. Images cannot replace JSON because the morph requires district identities and coordinates.

Invalid layouts are rejected without replacing the active target. Imports are limited to 512 candidates and 64 MiB per file. Changing the target invalidates the metric caches. CSV exports include the target identity, file hash when available, candidate parameters, geometry, and raster settings.

## Methods and metrics

### Linear

The main district outline is paired with its target hexagon using normalized arc length and phase alignment, with target corners retained in the correspondence. Corresponding points move along straight lines. Additional island outlines shrink toward the target center.

### Forsch hybrid

The offline pipeline adapts the method of Forsch, Kemna, Langetepe, and Haunert (2024), *Polyline Morphing for Animated Schematic Maps*. Each main outline is schematized in a coordinate system that converts the required directions to octilinear directions. The schematic source is enlarged when necessary to contain a standard target hexagon, and the authors' Java `MorphApp` produces keyframes.

During playback, the first 12% of the transition connects the Census outline to the schematic source. The viewer then replays the keyframes, applies an area correction, and moves the inner hexagon to its assigned cell. Additional island outlines remain linear. A district falls back to linear interpolation if suitable core keyframes are unavailable.

Custom layouts reuse the existing core keyframes and recompute the target translation and area correction. Flat-base targets additionally use a gradual 30-degree rotation. Importing a layout does not rerun the Java solver.

This is an adaptation, not a reproduction of all the paper's guarantees. Schematization, the opening transition, scaling, translation, and rotation change the original setting. In particular, this viewer does not claim the paper's strict constant-velocity or self-contained construction. Validity of an individual outline also does not imply absence of overlap between districts.

### Diagnostic measurements

| Metric | Definition and limitation |
| --- | --- |
| Overlap | Raster estimate of the fraction of covered area occupied by two or more districts. The raster pixel density and alignment are kept fixed across targets; bounds expand when necessary. |
| Self-crossing outlines | Number of districts with a sampled proper crossing in any outline component. Touching or collinear segments are not counted as proper crossings. |
| Area change | Mean normalized absolute finite-difference area change, with each district normalized by its average endpoint area. Hybrid areas are deliberately matched to Linear at the same time, so this is not an independent comparison of the core algorithm's area behavior. |

Metrics use 101 samples from `t = 0` through `t = 1`. This is a diagnostic sampling resolution, not the animation frame rate. Samples and raster estimates do not prove validity at every intermediate time.

## Project files

| File or directory | Purpose |
| --- | --- |
| `index.html` | Full-map comparison, controls, rendering, and metric charts. |
| `layout-import.js` | Import schema validation and target-layout preparation. |
| `hex-layouts/` | Layout generation, ranking, saved candidates, JSON exports, data snapshots, and tests. |
| `hexmap_data.js` | Geographic outlines, original hex layout, district metadata, and adjacency. Generated by `build_data.mjs`. |
| `forsch_map_data.js` | Precomputed full-map core keyframes. Generated by `forsch/build_full_map.cjs`. |
| `district_morph.html` | Single-district linear demonstration with embedded screen geometry. |
| `forsch_kansas.html` | Side-by-side Kansas example, generated from `forsch/page_template.html`. |
| `cb_2024_us_cd119_20m.zip` | Census geographic source data. |
| `cdhd_hex_119.geojson`, `cdhd_hex_119_centers.csv` | Original NYU layout geometry and center table. |
| `build_data.mjs` | Joins the geographic and hex datasets and builds `hexmap_data.js`. |
| `extract_screen_geometry.cjs` | Updates the embedded geometry in `district_morph.html` and the Kansas input. |
| `forsch/` | Input preparation, Java dependency retrieval, compatibility shims, keyframe parsing, page generation, and full-map validation. |
| `layout-import-tests.cjs`, `morph-layout-tests.cjs` | Import and morph geometry regression tests. |

Downloaded Java sources (`forsch/src/`), libraries (`forsch/lib/`), compiled classes (`forsch/build/`), and per-district generation caches (`forsch/fullmap_work/`) are build dependencies or intermediates, not browser assets. They can be recreated and are excluded from the distribution archives and Git tracking.

## Data sources and coordinates

Geographic outlines come from the US Census Bureau's [119th Congress cartographic boundary dataset, 1:20 million](https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_cd119_20m.zip). The original hex layout was read from the national Metric Map's Hex Map view on the [Congressional District Health Dashboard](https://www.congressionaldistricthealthdashboard.org/). It is NYU Langone Health's layout, not a layout generated by this repository.

Suggested attribution:

> Department of Population Health, NYU Langone Health. Congressional District Health Dashboard. https://www.congressionaldistricthealthdashboard.org/. Accessed September 26, 2026.

Check with the dashboard team at `info@CDhealthdashboard.org` about permission and attribution before including its layout in a publication.

The raw NYU coordinates are planar units, not longitude and latitude: x increases eastward and y increases northward. Its flat-side, pointy-top grid uses radius 12, with a drawn radius of 11.5 to leave gutters. The viewer flips y and uses a uniform least-squares scale and translation to align hex centers with projected geographic centroids. Geographic coordinates use the default `d3.geoAlbersUsa()` projection, including its Alaska and Hawaii insets.

Important data fields:

- `geo_fips`: Dashboard district ID. At-large districts use `<state>01`; Alaska is `0201` and DC is `1101`.
- `census_geoid_119`: Matching Census ID. At-large districts use `<state>00`; DC is `1198`.
- `geo_name`, `state_abbr`, `state_fips`: District and state metadata.
- `cx`, `cy`: Raw hex center coordinates.
- `col2`, `row`: Doubled grid coordinates. Neighbors of `(c, r)` are `(c +/- 2, r)` and `(c +/- 1, r +/- 1)`.
- `hex_neighbors`: District IDs sharing hex edges. `map_neighbors` in the generated dataset records geographic adjacency.

Keep the geographic data, district IDs, and layout on the same congressional vintage.

## Development and regeneration

Use Node.js 18 or newer for the scripts. Java regeneration additionally requires a JDK 11 or newer. Install Java so that `java` and `javac` are available on `PATH`; the full-map generator also accepts `JAVA_HOME` or a `--java` executable override.

### Geographic data and screen geometry

From the project directory:

```sh
npm install
npm run build
npx playwright install chromium
npm run extract
```

`npm run build` reads the bundled Census ZIP and NYU GeoJSON, verifies the 436-district join, checks outlines, builds geographic adjacency, and writes `hexmap_data.js`. `npm run extract` uses Chromium and the installed D3 dependency to update the screen geometry in `district_morph.html` and `forsch/input/kansas_1st_screen.json`. Extraction uses the original NYU target, not an imported layout.

Run these steps before regenerating keyframes if the raw data, projection, or original hex placement changes. Viewing the existing pages does not require rebuilding them.

### Java dependencies

The following PowerShell commands run from the project directory:

```powershell
powershell -ExecutionPolicy Bypass -File .\forsch\get_forsch.ps1
if ($LASTEXITCODE -ne 0) { throw "Java dependency download failed." }
New-Item -ItemType Directory -Force forsch\build\classes | Out-Null
$javaSources = Get-ChildItem forsch\src,forsch\shims -Recurse -Filter *.java | Where-Object Name -ne 'module-info.java'
javac --release 11 -d forsch\build\classes -cp "forsch/lib/*" $javaSources.FullName
if ($LASTEXITCODE -ne 0) { throw "Java compilation failed." }
```

`get_forsch.ps1` retrieves the authors' publication sources and required libraries. `forsch/shims/` supplies the small GeoTools compatibility layer used by this pipeline. Downloads require internet access. On other platforms, retrieve the sources and dependencies listed in the script and compile the same modules.

### Full-map keyframes

Generate and validate a candidate before replacing the viewer's current data:

```powershell
npm run forsch:build -- --jobs=4 --output=forsch/fullmap_work/candidate.js
if ($LASTEXITCODE -ne 0) { throw "Forsch generation failed." }
npm run forsch:validate -- --input=forsch/fullmap_work/candidate.js
if ($LASTEXITCODE -ne 0) { throw "Forsch validation failed." }
Copy-Item -LiteralPath forsch/fullmap_work/candidate.js -Destination forsch_map_data.js
```

The generator reads the embedded geometry in `district_morph.html`, invokes `MorphApp` per main outline, and collects keyframes. `--jobs` sets the number of parallel Java processes. `--retry` ignores cached results. A small run with `--limit=5 --jobs=2` writes a limited dataset under `forsch/fullmap_work/`; the full-coverage validator intentionally rejects limited datasets.

Without `--output` or `--limit`, the generator writes `forsch_map_data.js` directly, including when individual districts fail. Prefer the candidate-and-validation sequence above. Intermediate inputs, Java outputs, failure details, and cached results remain in `forsch/fullmap_work/`.

### Kansas example

After compiling the Java code, run the following from `forsch/` in PowerShell, checking that each command succeeds before continuing:

```powershell
node prep_input.cjs 0.4 0.5 write
java -cp "build/classes;lib/*" de.geoinfobonn.traveltimemaps.schematicmorph.MorphApp -s input/source.wkt -t input/target.wkt -o out -S OCTILINEAR -T GEODESIC
node parse_morph_svg.cjs
node build_page.cjs
```

Use `:` instead of `;` in the Java classpath on POSIX systems. Input preparation writes the WKT source and target. `MorphApp` writes its animation and statistics under `out/`; the parser writes `out/forsch_frames.json`. The final command regenerates `forsch_kansas.html` from `page_template.html`. Make persistent page changes in the template so regeneration retains them.

## Validation

After installing the Node dependencies, run from the project directory:

```sh
node layout-import-tests.cjs
node morph-layout-tests.cjs
npm run forsch:validate
```

Both test scripts also accept a layout export path as an optional argument. They check imports and geometric behavior without rewriting the datasets or running Java. The full-map validator checks coverage, finite coordinates, keyframe structure and timing, and target endpoints. These checks do not establish continuous-time absence of crossings or overlap.

The morph tests do not require a Git checkout by default. To additionally compare against the committed version, run `node morph-layout-tests.cjs --git-baseline`. An explicit baseline HTML file can be supplied with `--baseline=path/to/index.html` instead.

## References and third-party materials

- Forsch, Kemna, Langetepe, and Haunert (2024). *Polyline Morphing for Animated Schematic Maps*. Publication code: [TravelTimeMaps](https://gitlab.igg.uni-bonn.de/forsch/traveltimemaps).
- [US Census Bureau cartographic boundary files](https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html).
- [Congressional District Health Dashboard](https://www.congressionaldistricthealthdashboard.org/), Department of Population Health, NYU Langone Health.

Third-party datasets, sources, and libraries retain their respective terms. Review the upstream permissions and licenses before redistributing them. Downloaded Forsch sources and Java libraries are not included in the distribution archives; the retrieval script and compatibility shims are retained for reproducibility.
