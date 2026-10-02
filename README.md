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

The page runs the linear baseline: Map and Hexes buttons, a t slider and Play. The Overlaps checkbox paints every spot covered by two or more districts. The panel on the right scores 51 frames on overlap, self-crossing outlines and area change, and the scores download as CSV. Clicking a district shows its neighbours on both maps, on the map only and on the hex grid only. In the browser console, `window.hexmap` exposes the districts, the fit, `render(t)`, `select(d)` and the scores.

To rebuild `hexmap_data.js` from `cb_2024_us_cd119_20m.zip` and `cdhd_hex_119.geojson`, run `npm install` and then `npm run build`. The build checks that all 436 districts join, rounds coordinates to 5 decimals, adds each district's neighbours on the Census map (`map_neighbors`), and stops if any outline crosses itself.

`hexmap_linear_baseline.mp4` is a 10-second recording of the morph with the overlap layer on. `.gitignore` keeps it, `papers/` and `node_modules/` out of the repo.

`district_morph.html` shows one district at a time: its outline, its hexagon and the straight path of every point, with Play, a t slider and a phase slider. It runs the same pairing code as `index.html`, works offline, and lists all 436 districts plus four examples (Kansas's 1st, Texas's 4th, Louisiana's 3rd, Michigan's 1st).
