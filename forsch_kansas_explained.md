# Kansas Morph Demonstration

`forsch_kansas.html` compares two ways of transforming Kansas's 1st Congressional District into a hexagon:

- **Linear:** point-to-point interpolation from the geographic outline.
- **Forsch:** keyframes generated with the publication code accompanying Forsch, Kemna, Langetepe, and Haunert (2024), *Polyline Morphing for Animated Schematic Maps*, after adapting the input geometry.

The panels share a clock and end at the same grid hexagon when **Slide to grid position** is enabled. Their starting shapes differ: the linear panel uses the geographic outline, while the Forsch panel uses its schematic approximation. The page embeds its data and runs without external libraries or an internet connection.

## Reading the page

**Play** advances the time parameter at a constant rate. The slider allows inspection at any time between `t = 0` and `t = 1`. There is no additional easing, so the viewer does not distort the solver's keyframe timing. This does not mean that all vertices or edges move together or at the same speed.

Each panel includes:

- A gray reference outline showing the geographic district.
- A dashed target hexagon.
- The current outline in blue, or red when a proper self-crossing is detected.
- An optional orange area centroid and its trajectory.
- Optional vertex trajectories controlled by **Paths**.

The centroid is the polygon's area centroid, not the arithmetic mean of its sampled vertices. It tracks the distribution of area as the shape changes. For self-crossing outlines, signed polygon formulas can produce values that are not the physical centroid of the visible filled region; interpret those samples with care.

**On allowed directions** measures the share of boundary length within one degree of the selected undirected line angles: 0, 30, 90, and 150 degrees. **Crosses itself** tests for proper edge crossings; touching and collinear edges are excluded. See `forsch/allowed_directions.md` for the direction metric.

The area chart reports each panel's area relative to its own starting area, with a readout in squared screen units. A pure translation does not change area, so toggling the slide does not change this chart. The panels have different starting areas because of schematization; compare both normalized and absolute values.

## Linear baseline

The linear implementation uses normalized perimeter position to pair the geographic outline with the hexagon. It searches phase offsets to align the two closed rings and inserts correspondence points for the hexagon's corners. Each pair follows:

```text
p(t) = (1 - t) * source + t * target
```

Individual point trajectories are straight and have constant velocity. The edges connecting them may rotate, shrink, or cross. Straight vertex paths therefore do not by themselves guarantee valid intermediate outlines.

## Forsch pipeline

### 1. Extract screen geometry

`npm run extract`, run from the project directory, updates `forsch/input/kansas_1st_screen.json` from `index.html`. It records the Census outline after the default `d3.geoAlbersUsa()` projection and the original NYU hexagon after the viewer's alignment. This keeps the demonstration consistent with the main viewer's coordinate system.

### 2. Transform and schematize the input

`forsch/prep_input.cjs` converts the input into directions supported by the publication implementation. Its octilinear mode uses multiples of 45 degrees, whereas a flat-side hexagon has diagonal sides at 30 and 150 degrees.

Coordinates are measured relative to a reference center `(CX, CY)`, compressed horizontally, and flipped vertically:

```text
X = (x - CX) * tan(30 degrees)
Y = -(y - CY)
```

This maps the hexagon's sides onto octilinear directions. After the solver runs, the inverse transformation restores screen coordinates. The restored direction set is 0, 30, 90, and 150 degrees. It contains the required hexagon edge directions but is not an implementation of an arbitrary six-direction scheme.

In the transformed space, input preparation applies Douglas-Peucker simplification, replaces nonconforming edges with short allowed-direction chains, merges collinear segments, and removes short features. The tolerance and minimum segment length control this approximation. For example:

```sh
node prep_input.cjs 0.4 0.5 write
```

This preprocessing is an adaptation for geographic boundaries; the paper's core method starts from schematic input. It changes the outline and its area, and its quality must be evaluated separately from the subsequent morph.

### 3. Place the target and cut the rings

The final grid cell can lie far from the geographic district. Input preparation places a copy of the target hexagon inside the schematic district, using a search for interior clearance. The solver morphs to this placed copy. The viewer can then add a translation that carries the copy to its final grid position:

```text
displayed_point(t) = core_point(t) + t * target_offset
```

A whole-shape translation preserves edge angles, area, and self-intersection status at each time. It does not preserve containment inside a fixed screen-space morph region. Disabling **Slide to grid position** reveals the core transition to the placed hexagon.

Closed rings also need a cut before the polyline solver is called. The preparation script searches for a schematic connecting segment between a hexagon corner and the district boundary, adds its boundary endpoint when necessary, and rotates both ring sequences to start at this connection.

This stage writes:

- `input/source.wkt`: the schematic source outline.
- `input/target.wkt`: the placed hexagon.
- `input/transform.json`: the coordinate transformation and target placement metadata.

### 4. Generate the core keyframes

`forsch/get_forsch.ps1` retrieves the authors' publication code and required Java libraries. The build uses a classpath rather than the upstream module descriptors. `forsch/shims/` supplies the GeoTools interfaces needed by this geometry-processing path; it is not a general GeoTools replacement.

The generator calls `MorphApp` with octilinear schematization and geodesic traces. Conceptually, the core calculation comprises:

1. **Morph region:** Construct the region through which the transition is allowed to pass.
2. **Traces:** Find paths connecting source and target vertices through that region, using visibility and shortest-path calculations.
3. **Correspondence:** Use dynamic programming to choose segment matches, deletions, and insertions. Matches preserve segment direction; deletions shrink segments to points, and insertions grow segments from points. The objective accounts for travel along traces and segment lengths.
4. **Timing:** Divide the construction into transition cells and solve for their timing so that active segments satisfy the method's motion constraints.

The resulting keyframes mark changes in the construction. Between successive keyframes, the viewer can interpolate vertices linearly. Different groups of segments may start or stop at different times. A constant-speed requirement during a segment's active interval is not a requirement that every segment move continuously throughout the entire animation.

The solver writes `out/morph.svg`, statistics, and Ipe drawings. Solver reports describe the generated core transition, not the validity of every additional transformation in a browser application.

### 5. Convert the output and build the page

`forsch/parse_morph_svg.cjs` extracts the solver's keyframes, removes the endpoint holds inserted by its SVG writer, restores the coordinate orientation, and reverses the horizontal compression. It checks source and target coverage, keyframe structure, timing, and edge directions, then writes `out/forsch_frames.json`.

`forsch/build_page.cjs` computes the linear correspondence, prepares the core keyframes, samples intermediate states for diagnostics, and fills `forsch/page_template.html` to produce `forsch_kansas.html`. Edit the template for page changes that must survive regeneration. Full commands appear in the README under **Development and regeneration**.

## Interpreting the comparison

The experiment separates several questions that should not be reduced to a single visual score:

| Question | What to inspect |
| --- | --- |
| Does the outline remain schematic? | Allowed-direction share and the geometry of intermediate edges. |
| Does it remain simple? | Proper-crossing diagnostics and suspicious intermediate intervals. |
| Does it look temporally smooth? | Segment starts and stops, centroid motion, and vertex trajectories. |
| Does its size change evenly? | Absolute area, normalized area, and the slope of the area curve. |
| Does the adaptation preserve geographic detail? | Difference between the Census boundary and the schematic source. |

High schematicity or the absence of detected self-crossings does not establish perceptual smoothness. Groups of edges can pause while others move; area can change unevenly even when individual active segments satisfy a constant-speed condition. Conversely, a visually smooth linear transition can contain brief crossings.

The metrics and sample values must be recomputed after changing the input or preprocessing parameters. Finite time samples can miss short-lived crossings and do not establish continuous-time guarantees. No particular result, keyframe count, or ranking between the methods is assumed by this document.

This Kansas page also differs from the full-map **Forsch hybrid** in `index.html`: the main viewer adds an opening transition and matches each main outline's area to its linear counterpart. Its area chart therefore cannot be interpreted as an independent measurement of the unmodified core method's area behavior.

## Scope and limitations

- Schematization, target placement, the cut construction, and the screen-space slide are adaptations around the publication implementation.
- The inverse coordinate transformation preserves incidence and whether edges cross, but changes the Euclidean geometry and speed magnitudes relative to the solver's coordinate system.
- A self-contained core transition should not be described as self-contained relative to a fixed screen region after adding the slide.
- One valid district outline does not establish a valid full map. Independent district morphs do not coordinate shared boundaries or prevent districts from overlapping each other.
- Area and centroid calculations require extra care when an outline self-crosses.

## Files and sources

| File | Role |
| --- | --- |
| `forsch_kansas.html` | Generated demonstration. |
| `forsch/input/kansas_1st_screen.json` | Geographic and target geometry extracted from the main viewer. |
| `forsch/prep_input.cjs` | Coordinate transformation, schematization, placement, and ring preparation. |
| `forsch/input/source.wkt`, `forsch/input/target.wkt` | Solver inputs. |
| `forsch/input/transform.json` | Metadata for restoring screen coordinates. |
| `forsch/get_forsch.ps1`, `forsch/shims/` | Dependency retrieval and compatibility layer. |
| `forsch/out/` | Solver outputs and parsed keyframes. |
| `forsch/parse_morph_svg.cjs` | SVG animation to screen-space keyframes. |
| `forsch/build_page.cjs`, `forsch/page_template.html` | Page generation and persistent page source. |
| `forsch/allowed_directions.md` | Definition of the direction diagnostic. |

Method: Forsch, Kemna, Langetepe, and Haunert (2024), *Polyline Morphing for Animated Schematic Maps*. [Publication code](https://gitlab.igg.uni-bonn.de/forsch/traveltimemaps).

Geographic data: US Census Bureau, 119th Congress cartographic boundaries. Target layout: [Congressional District Health Dashboard](https://www.congressionaldistricthealthdashboard.org/), Department of Population Health, NYU Langone Health. See the README for dataset links, attribution, and redistribution considerations.
