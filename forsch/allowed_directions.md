# What "allowed directions" means

This note explains the "On allowed directions" number under each side of `forsch_kansas.html`.

## Direction means the angle of an edge, not the direction of motion

A district's border is a chain of short straight edges. Each edge sits at some angle. "Direction" here refers to that angle: which way the edge points on the page, measured from horizontal and ignoring which end is which. So 30° and 210° count as the same direction.

It has nothing to do with which way the outline is moving. That's a separate question, covered below.

## The four allowed directions

A pointy-top hexagon has edges at only three angles: 30°, 90° and 150°. We also allow horizontal (0°). Their code needed it, and Kansas has long east-west borders.

So the allowed set is 0°, 30°, 90° and 150°. An outline drawn only with edges at those angles looks like it belongs on the hex grid. One with edges at arbitrary angles looks like a hand-drawn blob.

## How the number is computed

For the outline at a given moment t, the page goes through every edge, measures its angle, and checks whether it's within 1° of an allowed direction. It then reports the share of the outline's total length made up of edges that pass:

```
on allowed directions = (length of edges within 1° of 0°, 30°, 90° or 150°) / (total length)
```

Zero-length edges are skipped. The 1° tolerance absorbs rounding.

## Why the linear morph scores low

In the linear morph every point on the outline travels in a straight line to its own partner on the hexagon. Partners sit in different places, so neighbouring points head off at different angles and different speeds. The edge between two such points rotates as they move.

```
t = 0            t = 0.5            t = 1
a -------- b      a                  a ---- b
                    \                 (hex edge, 30°)
                      ------ b
```

Every edge rotates a little, each by a different amount. Halfway through, almost none of them line up with the four angles. For Kansas's 1st:

| t | Linear | Forsch |
|---|---|---|
| 0 | 27% | 100% |
| 0.25 | 23% | 100% |
| 0.5 | 5% | 100% |
| 0.75 | 5% | 100% |
| 1 | 100% | 100% |

The linear side starts at 27% because the real Census border has some nearly horizontal and vertical stretches. It ends at 100% because the final shape is the hexagon. In between it drops to 5%: the shape is neither the map outline nor the hexagon.

## Why the Forsch side stays at 100%

The method of Forsch et al. (2024) adds one rule: an edge may only slide sideways, parallel to itself. It never rotates, so a horizontal edge stays horizontal and a 30° edge stays at 30° for the whole morph. Edges the hexagon doesn't need shrink to zero length and disappear. Each edge also moves at its own constant speed.

There's one precondition. The starting outline must already use only allowed directions. That's why the district is schematized first, from 133 Census points to 24 segments, before their code runs. From then on, every in-between frame is drawn with the same four angles. The page checked 2,001 in-between frames: every edge stays within 0.05° of an allowed direction.

## What about the direction of motion?

Different points move in different directions in both morphs. Nothing moves in lockstep.

- **Linear:** each point goes straight to its partner, all at once.
- **Forsch:** each vertex follows a path inside the region between the start and end shapes. The path can bend, and different parts of the outline start and stop moving at different times.
- **Slide:** with "Slide to grid position" ticked, every point also gets the same constant drift toward the hexagon's grid position. Shifting the whole shape changes no edge angles, so the 100% holds with or without it.

## Why it matters

A reader following one district from the map to the hex grid sees a clean shape at every moment instead of a smeared one. Together with "no self-crossings", it's a property we can measure frame by frame and compare across morph methods. That's the per-frame scoring the project is built around.
