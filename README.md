# CDHD hex layout, 119th Congress

## What's here

- `cdhd_hex_119.geojson`: 436 hexagons (435 districts plus DC), one per district, placed exactly as the Congressional District Health Dashboard draws them.
- `cdhd_hex_119_centers.csv`: the same layout as a table, one row per district.

## Where it came from

The dashboard doesn't offer the hex layout as a download. It was read from the live national Metric Map (Hex Map view) on Sept 26, 2026. On that page the hexes are 436 Leaflet polygons on a Leaflet `CRS.Simple` map, each with a tooltip naming its district. The names were matched against the dashboard's own district list (`/api/geography-reference/districts`) and all 436 matched. Every hex has six vertices and the same radius, so the files here rebuild them exactly from their centers.

The layout is NYU Langone's design. Cite the dashboard wherever it appears, and check with the dashboard team (info@CDhealthdashboard.org) before using it in a paper figure. Their suggested citation: Department of Population Health, NYU Langone Health. Congressional District Health Dashboard. www.congressionaldistricthealthdashboard.org. Accessed Sept 26, 2026.

## Coordinates

These are plain planar units, not longitude and latitude. x runs east and y runs north (y points up), so flip y for SVG or d3.

The grid is pointy-top. Centers in a row sit 20.785 apart and rows sit 18 apart, which is a grid radius of 12. The dashboard draws each hex at radius 11.5, which is where the thin white gaps come from. The layout spans x 197.89 to 851.74 and y 96.5 to 587.5.

To line the hexes up with a projected geographic map (d3 `geoAlbersUsa`, say), fit one uniform scale and a translation, plus the y flip. Hexes stay regular under uniform scaling.

## Fields

- `geo_fips`: the dashboard's district ID. At-large seats use `<state>01` (Alaska is `0201`) and DC is `1101`.
- `census_geoid_119`: the matching `GEOID` in the Census `cb_2024_us_cd119` files, where at-large seats use `<state>00` and DC is `1198`.
- `geo_name`, `state_abbr`, `state_fips`.
- `cx`, `cy`: hex center.
- `col2`, `row`: grid cell in doubled coordinates, where `col2` counts half-steps. The grid neighbours of `(c, r)` are `(c±2, r)` and `(c±1, r±1)`.
- `hex_neighbors` (GeoJSON only): the `geo_fips` of the hexes touching this one. The CSV has the count.

## What the layout looks like

It's packed, with gaps left for the Great Lakes and the Gulf. There are 1,171 neighbouring pairs, 457 of them across state lines. 308 of the 436 hexes have all six neighbours. Alaska is the only isolated hex, Hawaii is a pair, and Michigan comes out as two separate blobs.

## The geographic side

**Census cartographic boundary files, 119th Congress.** Join on `census_geoid_119`.

- https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_cd119_20m.zip is the most simplified, which suits animation.
- `cb_2024_us_cd119_5m.zip` and `cb_2024_us_cd119_500k.zip` at the same path have more detail.
- Drop Puerto Rico and the island areas (state FIPS 60, 66, 69, 72, 78) and any `ZZ` rows (areas with no district defined) to get the same 436.
- mapshaper (mapshaper.org) converts the shapefile to GeoJSON or TopoJSON and simplifies it in the browser.

**The dashboard's own district shapes.** `GET https://www.congressionaldistricthealthdashboard.org/api/geobuf/national/0`, then `/1` and `/2`. Each returns JSON of the form `{"result": "<base64 geobuf>"}`, about 5 MB across the three. Decode with the `geobuf` and `pbf` npm packages. The properties are `unique_geo`, `geo_fips` and `geo_name`, so they join to the hexes on `geo_fips` with no remapping. The dashboard built these by dissolving 2020 census blocks into 119th Congress districts and clipping coastlines with the Census 5m file.

The dashboard uses 119th Congress lines. About ten states redrew their maps for the 2026 elections, so don't mix in newer district files.

## The morph viewer

`index.html` draws the 436 districts with d3 and morphs them into the hex layout. Open it in a browser. It loads d3 from cdnjs, so it needs internet, and `hexmap_data.js` has to sit next to it.

The page offers Linear and Forsch hybrid modes, with Map and Hexes buttons, a t slider and Play. The Overlaps checkbox paints every spot covered by two or more districts. The panel on the right scores 101 samples on overlap, self-crossing outlines and area change, and the scores download as CSV. These are diagnostic time samples, not the animation's frame rate or a continuous-time proof. Clicking a district shows its neighbours on both maps, on the map only and on the hex grid only. In the browser console, `window.hexmap` exposes the districts, the fit, `render(t)`, `select(d)` and the scores. Forsch mode also reads `forsch_map_data.js` next to the page.

To rebuild `hexmap_data.js` from `cb_2024_us_cd119_20m.zip` and `cdhd_hex_119.geojson`, run `npm install` and then `npm run build`. The build checks that all 436 districts join, rounds coordinates to 5 decimals, adds each district's neighbours on the Census map (`map_neighbors`), and stops if any outline crosses itself.

`hexmap_linear_baseline.mp4` is a 10-second recording of the morph with the overlap layer on. `.gitignore` keeps it, `papers/` and `node_modules/` out of the repo.

`district_morph.html` shows one district at a time: its outline, its hexagon and the straight path of every point, with Play, a t slider and a phase slider. It runs the same pairing code as `index.html`, works offline, and lists all 436 districts plus four examples (Kansas's 1st, Texas's 4th, Louisiana's 3rd, Michigan's 1st).

`district_morph.html` and `forsch/input/kansas_1st_screen.json` keep their own copy of the screen geometry that `index.html` computes: each district's outline after `d3.geoAlbersUsa` and its hexagon after the fit. `npm run extract` rewrites both from `index.html` itself. It opens the page in headless Chromium, records the outlines the same way the page does, and writes them into the data block of `district_morph.html` (3 decimals) and into the Kansas file (full precision). It serves the d3 version the page pins from `node_modules`, so it runs offline. Before the first run, install the browser with `npx playwright install chromium`.

## Forsch et al. on one district

`forsch_kansas.html` plays Kansas's 1st two ways, side by side: the linear baseline on the left, and on the right the morph computed by the code of Forsch, Kemna, Langetepe and Haunert (2024), "Polyline Morphing for Animated Schematic Maps". Their method keeps every in-between outline schematic and free of self-crossings. Under each side the page shows how much of the outline runs in an allowed direction and whether it crosses itself. It works offline.

Three things differ from the paper's own setting, and the page's "How the right side was made" box explains each. Their code only morphs schematic outlines, so the district is schematized first (`forsch/prep_input.cjs`, 133 points to 49 segments). Their code only knows octilinear directions, so x is squashed by tan 30° before the run and stretched back after it, which gives directions of 0°, 30°, 90° and 150°. Their method expects outlines that are nested or overlap, so the hexagon is placed inside the district and a constant-speed slide to its grid position is added on top.

To rerun it you need a JDK 11 or newer and Node. On Windows, `forsch/get_forsch.ps1` downloads their code (tag "publication") into `forsch/src` and the nine jars it needs into `forsch/lib`; elsewhere, fetch the files the script lists. The rest is bash, run from `forsch/`:

```
node prep_input.cjs 0.4 0.5 write
mkdir -p build && find src shims -name '*.java' ! -name module-info.java > build/sources.txt
javac --release 11 -d build/classes -cp "lib/*" @build/sources.txt
java -cp "build/classes:lib/*" de.geoinfobonn.traveltimemaps.schematicmorph.MorphApp -s input/source.wkt -t input/target.wkt -o out -S OCTILINEAR -T GEODESIC
node parse_morph_svg.cjs
node build_page.cjs
```

`shims/` stands in for the GeoTools classes their code imports, so GeoTools isn't needed. `out/` holds what their program wrote: `morph.svg` is their own animation of the run (it's in the squashed space, so the hexagon looks narrow), `stats.csv` their checks, and the `.ipe` files open in the Ipe editor. `parse_morph_svg.cjs` turns `morph.svg` back into keyframes in screen coordinates and `build_page.cjs` writes the page. Their code and the jars stay out of the repo (`forsch/src/` and `forsch/lib/` are in `.gitignore`) because their repository doesn't state a licence.

## Rebuilding the full-map Forsch data

`forsch/build_full_map.cjs` is the offline generator for `forsch_map_data.js`.
It reads the screen geometry embedded in `district_morph.html`, prepares each
main outline, invokes the authors' Java `MorphApp`, and collects its keyframes.
It does not build the Kansas page or change `index.html`.

Use Node.js 18 or newer (tested here with Node 24) and a JDK 11 or newer (tested
with JDK 11). Download and compile the Java code as above first. On Windows,
these equivalent PowerShell commands run from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\forsch\get_forsch.ps1
New-Item -ItemType Directory -Force forsch\build\classes | Out-Null
$javaSources = Get-ChildItem forsch\src,forsch\shims -Recurse -Filter *.java | Where-Object Name -ne 'module-info.java'
javac --release 11 -d forsch\build\classes -cp "forsch/lib/*" $javaSources.FullName
```

Make `java` and `javac` available on PATH, or set `JAVA_HOME`. The full-map
generator also accepts `--java=C:/path/to/jdk/bin/java.exe`. No Java installation
is needed just to view the committed animations.

If source geometry, projection, or hex placement changes, run `npm run build`
(for changed raw inputs) and then `npm run extract` before rebuilding the
keyframes. Extraction requires `npm install` and, once,
`npx playwright install chromium`. Viewing existing pages needs none of these
build steps.

Run these from the repository root:

```powershell
# Small test; writes only forsch/fullmap_work/forsch_map_data.limit-5.js.
npm run forsch:build -- --limit=5 --jobs=2

# Build a full candidate without replacing the viewer's current data.
npm run forsch:build -- --jobs=4 --output=forsch/fullmap_work/candidate.js
if ($LASTEXITCODE -ne 0) { throw "Forsch generation failed; current viewer data was not replaced." }
npm run forsch:validate -- --input=forsch/fullmap_work/candidate.js
# Only publish locally after the validator succeeds (PowerShell).
if ($LASTEXITCODE -eq 0) { Copy-Item -LiteralPath forsch/fullmap_work/candidate.js -Destination forsch_map_data.js }

# Validate the committed/current viewer data, without changing it.
npm run forsch:validate
```

The generator's original direct command, `node forsch/build_full_map.cjs
--jobs=4`, writes `forsch_map_data.js` immediately, even if some districts fail.
Use the candidate-and-validation sequence above to retain complete data until
the new run passes. Limited runs are intentionally rejected by the full-coverage
validator. `--jobs` controls parallel Java processes; `--retry` recomputes all
selected districts instead of using cached successes or failures. First runs
can take tens of minutes; matching cached runs are much faster.

Per-district WKT inputs, Java outputs, logs embedded in failure records, and
cached results live under `forsch/fullmap_work/`. The cache fingerprint includes
the generator, compiled classes, jars, and district input. These intermediates
are ignored by Git; upload the scripts, not that directory. The validator checks
full coverage, finite coordinates, keyframe structure/times, and final hex
endpoints. It does not prove absence of overlap or self-crossing at every time.

This remains a hybrid: schematization, temporary source enlargement, an opening
transition, and the slide to the grid are adaptations around MorphApp. The
current `index.html` additionally matches each main outline's area to the linear
morph at the same time. This browser-side area correction does not require
regenerating `forsch_map_data.js`; it also means the result is not the paper's
strict constant-velocity/self-contained construction.
