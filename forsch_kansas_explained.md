# forsch_kansas.html, explained

`forsch_kansas.html` shows one district, Kansas's 1st, turning into its hexagon in two ways at once:

- **Left:** our linear baseline.
- **Right:** the morph computed by the code of Forsch, Kemna, Langetepe and Haunert (2024), "Polyline Morphing for Animated Schematic Maps".

Both sides share one clock and end on the same hexagon at its grid position. The page is a single 29 KB file with its data built in. It needs no internet and no libraries.

## What's on the page

Play runs the morph over 4 seconds, and the t slider scrubs it by hand: t = 0 is the district, t = 1 is the hexagon. The clock runs at a constant rate with no easing, so the constant speeds of their method show up as constant speeds on screen.

Each panel draws three things:

- **Gray outline:** the Census border of the district, left in place as a reference.
- **Dashed hexagon:** where the morph ends.
- **Blue shape:** the outline at the current t. It turns red if the outline crosses itself.

**Paths** draws the route of every vertex over the whole morph. On the left these are straight lines. On the right they're bent lines through the keyframes described below.

**Slide to grid position** only affects the right side. Step 3 explains it.

Under each panel are two numbers that update with t:

- **On allowed directions:** the share of the outline's length whose edges point at 0°, 30°, 90° or 150°, within 1°. Those are the hexagon's three edge angles plus horizontal. `forsch/allowed_directions.md` covers this number in detail.
- **Crosses itself:** the same test as index.html. Two edges that properly cross count. Edges that only touch don't.

"How the right side was made" at the bottom opens a short version of this document. The footer cites the paper, their code and our data sources.

## The left side: linear baseline

This is the pairing code from index.html, section 3, applied to one district. The outline (133 points) and the hexagon are both closed loops, so the only choice is which outline point goes to which part of the hexagon. The code samples 60 points evenly along the outline and tries 240 offsets around the hexagon. It keeps the offset where the paired points line up best, which for Kansas's 1st is offset 120, halfway round. The 6 points that become the hexagon's corners are added to the outline's 133. One of them lands on an existing point, which leaves 138 pairs.

Each pair then moves in a straight line at constant speed:

```js
x(t) = src.x + (dst.x - src.x) * t
```

Every point takes the shortest route to its partner, but nothing controls the edges between points. Neighbouring points head off at different angles, so the edges rotate. Halfway through, almost none of the outline's edges are on the hexagon's angles.

## The right side: how it was made

There are five steps, each a file in `forsch/`.

### 1. The same outline

`input/kansas_1st_screen.json` holds the district's outline and its hexagon exactly as index.html draws them: the Census shape projected with d3.geoAlbersUsa, and the hex grid fitted onto the map. Both sides of the page start from this file.

### 2. Squash and simplify (`prep_input.cjs`)

Their code only moves outlines whose edges point in a fixed set of directions. It knows two sets: rectilinear (0° and 90°) and octilinear (every 45°). A hexagon's slanted sides sit at 30° and 150°, which neither set contains.

The fix is to squash the coordinates before the run. Every point is measured from the district's centroid (CX, CY), x is multiplied by tan 30° (0.577), and y is flipped to point up:

```js
X = (x - CX) * Math.tan(Math.PI / 6)
Y = -(y - CY)
```

A 30° side climbs 1 for every √3 across. After squashing it climbs 1 for every 1 across, so it sits at 45° and the hexagon's sides become octilinear. Their octilinear mode then runs unchanged, and the result is stretched back afterwards. Stretched back, the octilinear angles 0°, 45°, 90° and 135° become 0°, 30°, 90° and 150°. That's four of the six line directions on a hex grid. The two it misses, 60° and 120°, aren't needed, because the hexagon has no edges there.

In the squashed space the Census outline is then made schematic:

1. Douglas-Peucker with tolerance 2 cuts the 133 points to 18.
2. Each remaining edge is replaced by at most two segments at the allowed angles either side of it. That makes a small staircase with its corner on the outside.
3. Pieces shorter than 2 units are folded away by extending their neighbours until they meet, and collinear runs are merged.

That leaves 24 segments: 7 horizontal, 8 vertical, 3 at 30° and 6 at 150°. The paper starts from outlines that are already schematic, so this step is ours.

It costs some detail. The jagged county-line staircase in the east becomes a few diagonals. The schematic shape's area is 3,962 px², against 3,640 px² for the Census shape.

### 3. Place the hexagon and pick the cut (`prep_input.cjs`)

Their method morphs between outlines that are nested (one inside the other) or that overlap, because it moves vertices through the region between the two. Kansas's 1st and its hexagon don't touch. The hexagon sits about 3.3 hex steps (80 px) to the northwest, because the hex layout packs districts differently from the map.

So the morph happens in two layers:

1. **Place the hexagon.** It goes inside the district where it has the most room. A grid search over candidate centres keeps the one with the largest gap to the outline, 8.9 px, in the wide western part.
2. **Morph onto it.** Their code morphs the outline onto that placed hexagon.
3. **Slide on top.** The page shifts every point by t × (−73.5, −33.1) px, which carries the placed hexagon to its grid position exactly at t = 1.

Moving a whole shape doesn't change its edge angles or create crossings, so the slide keeps both properties. On screen, though, each vertex's speed is their speed plus the slide's. Untick "Slide to grid position" to see their morph alone, ending on the placed hexagon.

Closed outlines need one more step, the cut:

- **Why a cut.** Their code works on lines with a start and an end. So each ring is cut open at one point, and the two cut points are joined by a straight "cut line". The first and last vertex of the outline travel along it.
- **What the paper does.** It cuts at the closest pair of vertices and asks for a cut line that is itself schematic. Here a straight line between the closest vertices would have been slanted.
- **What we did instead.** From each hexagon corner, a ray goes out in each of the 8 allowed directions, and the shortest ray that reaches the outline is used. It runs horizontally for 8.9 px from the hexagon's upper-left corner to the district's west border.
- **The new vertex.** The point where the ray lands becomes a new vertex of the outline. It sits on an existing edge, so the shape doesn't change. Both rings start there.

This step writes three files:

- `input/source.wkt`: the outline, 25 vertices.
- `input/target.wkt`: the hexagon.
- `input/transform.json`: everything needed to undo the squash and add the slide later.

### 4. Their code (`MorphApp`)

`get_forsch.ps1` downloads their repository at the tag "publication", the version that goes with the paper, plus the nine libraries it needs. Their source is compiled unchanged, but the build differs from theirs in two ways:

- It skips their three `module-info.java` files and compiles on the plain classpath.
- `shims/` stands in for the eight GeoTools and GeoAPI classes the code imports. Two of them do real work: they hand out a default JTS geometry factory and a WKT reader, which is all the algorithm asks GeoTools for. The rest only let a shapefile export compile, and MorphApp never calls that export.

It runs as

```
java ... MorphApp -s input/source.wkt -t input/target.wkt -o out -S OCTILINEAR -T GEODESIC
```

on Java 11 in the Linux workspace on your PC, in a few seconds. A second run on Java 21 produced a byte-identical `morph.svg`.

Inside, it works in four stages, matching the paper.

**Morph region.** The area between the outline and the hexagon. Every vertex stays inside it for the whole morph, which the paper calls self-contained.

**Traces.** For every outline vertex and every hexagon vertex, the code finds the shortest path between them that stays inside the region. It searches a visibility graph for these paths.

**Correspondence.** A dynamic program walks along both outlines and pairs them up using three operations:

- **Match:** moves an outline segment onto a hexagon segment. It's only allowed when both point the same way, so the segment can slide there parallel to itself.
- **Delete:** shrinks an outline segment to a point.
- **Insert:** grows a hexagon segment out of a point.

The program picks the sequence with the lowest cost, which is the distance vertices travel along their traces, weighted by segment length. For Kansas's 1st it found 3 matches, 3 inserts and 22 deletes:

| Hexagon side | Comes from |
|---|---|
| West (vertical) | the district's west border, shrinking from 41 px to 13 px |
| East (vertical) | an 11 px vertical edge in the district's eastern part |
| Upper-left (30°) | the short 30° edge at the district's northwest corner |
| Upper-right, lower-left, lower-right | grown from single points |

Every other outline segment shrinks away, including all 7 horizontal ones, since a pointy-top hexagon has no horizontal sides.

**Timing.** The paper requires every segment to move parallel to itself at its own constant speed. A segment may start late and stop early, but while it moves its speed doesn't change. To arrange that, the code does two things:

1. It splits the region into transition cells, areas where the segments inside start and stop together. There are 6 here.
2. It solves a small linear system for when each cell starts and ends.

The output is the outline's shape ("keyframe") at each moment something starts or stops. Between two keyframes every vertex moves in a straight line at constant speed.

The program writes these files to `out/`:

- `morph.svg`: the keyframes as an animation.
- `stats.csv`: its own checks, which report no self-crossings and a self-contained morph.
- Three drawings for the Ipe editor.

### 5. Into the page (`parse_morph_svg.cjs`, `build_page.cjs`)

`parse_morph_svg.cjs` reads the keyframes back out of `morph.svg`. It undoes three things:

1. a 20% pause their SVG writer adds at each end;
2. the y flip that SVG needs;
3. the squash from step 2.

Then it checks three things:

- the first keyframe passes through every vertex of the schematic outline;
- the last keyframe passes through every hexagon corner;
- every edge in every keyframe is octilinear. The worst case is off by 0.00002°.

The result is `out/forsch_frames.json`: 7 keyframes of 57 points each, in screen coordinates.

`build_page.cjs` does four things in turn:

1. computes the linear pairs;
2. drops the repeated closing point of each keyframe, leaving 56 points;
3. checks 2,001 frames between keyframes for angles and crossings;
4. fills `page_template.html` with all of it to write `forsch_kansas.html`.

## How the right side animates

Both sides use straight-line motion between keyframes. The difference is how many keyframes each has:

- **Left:** two, at t = 0 and t = 1, so every point makes one straight move.
- **Right:** seven, at t = 0, 0.100, 0.335, 0.430, 0.576, 0.701 and 1. Every vertex makes up to six straight moves, and in each one the segments slide parallel to themselves.

```js
let i = 0;
while (i < KT.length - 2 && t > KT[i + 1]) i++;    // which leg t falls in
const u = (t - KT[i]) / (KT[i + 1] - KT[i]);        // how far into that leg
x = A[j].x + (B[j].x - A[j].x) * u + (slide ? SLIDE.x * t : 0);
```

Different parts of the outline move at different times:

| Leg | Points moving (of 56) |
|---|---|
| 1 | 20 |
| 2 | 26 |
| 3 | 30 |
| 4 | 40 |
| 5 | 32 |
| 6 | 48 |

That's their timing at work. On the left, everything moves all the time.

## What the numbers show

| t | Allowed directions, linear | Allowed directions, Forsch | Area, linear (px²) | Area, Forsch (px²) |
|---|---|---|---|---|
| 0 | 27% | 100% | 3,640 | 3,962 |
| 0.25 | 23% | 100% | 2,569 | 3,313 |
| 0.5 | 5% | 100% | 1,682 | 2,619 |
| 0.75 | 5% | 100% | 980 | 1,696 |
| 1 | 100% | 100% | 462 | 462 |

The Forsch side stays schematic at every moment. Across 2,001 checked frames every edge stays within 0.05° of an allowed angle, and the outline never crosses itself. The linear side doesn't cross itself for this district either, but nothing prevents it. In the full-map scores, up to 36 districts cross themselves at t = 0.62.

On Klaus's suggested metric, rate of change of area, Forsch does worse here. It loses area in bursts as groups of segments start and stop:

| | Peak rate of area change (px² per unit of t) | Relative to starting area |
|---|---|---|
| Linear | 4,651 | 1.3× |
| Forsch | 7,703 | 1.9× |

It guarantees the shape and no crossings, and pays for that with less even area change. That trade-off is worth showing alongside the rest.

## Things to know

**The schematization is ours.** Step 2 isn't part of their method, and different settings give different outlines. `node prep_input.cjs 2 2` takes the Douglas-Peucker tolerance and the shortest segment as its two numbers.

**Only four directions.** The outline uses four of the hex grid's six directions, because we ran their octilinear mode on squashed coordinates. Supporting all six would mean changing their code, which this demo avoids.

**The placed hexagon and slide are our workaround** for a district that sits far from its hexagon. With the slide on, "self-contained" holds relative to the placed hexagon, not on screen.

**Their log reports a hole in the morph region.** The cut line has zero width, and the tiny buffer their code applies to the region closes it, so the hexagon becomes a hole. Their code finished normally, and both its checks and ours passed.

**It's one district.** Their method morphs one outline at a time and knows nothing about neighbours, so it doesn't address overlaps between districts, which is the main problem for the full map. Where it could fit is the reshape step of a move-then-reshape morph.

## Files

| File | What it is |
|---|---|
| `forsch_kansas.html` | the page |
| `forsch/input/kansas_1st_screen.json` | the district and its hexagon in index.html's screen coordinates |
| `forsch/prep_input.cjs` | squash, schematize, place the hexagon, pick the cut; writes the next two rows |
| `forsch/input/source.wkt`, `target.wkt` | the outline and the hexagon, as their code reads them |
| `forsch/input/transform.json` | the squash factor, the centroid and the placed hexagon, to undo it all later |
| `forsch/get_forsch.ps1` | downloads their code into `forsch/src` and the jars into `forsch/lib` (both kept out of git) |
| `forsch/shims/` | stand-ins for the GeoTools classes their code imports |
| `forsch/build/` | on your PC only: the compiled code and the run log |
| `forsch/out/` | what their program wrote (`morph.svg`, `stats.csv`, Ipe drawings) plus our `forsch_frames.json` |
| `forsch/parse_morph_svg.cjs` | `morph.svg` back to keyframes in screen coordinates |
| `forsch/build_page.cjs`, `page_template.html` | linear pairs, checks, and the page |
| `forsch/allowed_directions.md` | the "On allowed directions" number in detail |

The commands to rebuild everything are in the README, under "Forsch et al. on one district".
