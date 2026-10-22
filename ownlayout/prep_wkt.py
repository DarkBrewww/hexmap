# Builds the Meulemans pipeline input from the district geometry index.html draws.
#
#   python3 prep_wkt.py OUT.wkt [simplify_tolerance]
#
# One outline per state (lower 48 + DC share exact border vertices, so the pipeline's
# dual links them into one joint cartogram), Alaska and Hawaii as separate outlines.
# Sites are the 436 districts. Coordinates: screen px with y flipped (y_up = 600 - y).
import sys, json
sys.path.insert(0, __import__("os").path.dirname(__file__))
from load import load
from collections import defaultdict
from shapely import union_all, coverage_simplify, make_valid
from shapely.ops import polylabel
from shapely.geometry import Polygon, MultiPolygon, Point, LineString
from shapely.ops import nearest_points
from shapely.geometry.polygon import orient

OUT = sys.argv[1]
TOL = float(sys.argv[2]) if len(sys.argv) > 2 else 0.5
H = 600.0

ds, hd = load()

# load() gives (x, -y_screen); shift so y_up = 600 - y_screen is positive.
from shapely.affinity import translate
for d in ds:
    d["geom"] = translate(d["geom"], 0, H)

def pieces(g):
    return list(g.geoms) if isinstance(g, MultiPolygon) else [g]

# Site: area centroid of the district's largest piece if it lies inside that piece,
# otherwise its pole of inaccessibility.
for d in ds:
    big = max(pieces(d["geom"]), key=lambda p: p.area)
    c = big.centroid
    d["site"] = c if big.contains(c) else polylabel(big, tolerance=0.01)

bystate = defaultdict(list)
for d in ds:
    bystate[d["state"]].append(d)
states = sorted(bystate)
raw = [union_all([d["geom"] for d in bystate[s]]) for s in states]

from shapely import coverage_is_valid, coverage_invalid_edges
print("coverage valid before simplify:", coverage_is_valid(raw))
simp = list(coverage_simplify(raw, TOL))
print("vertices before/after:", sum(len(p.exterior.coords) for g in raw for p in pieces(g)),
      sum(len(p.exterior.coords) for g in simp for p in pieces(g)))

outlines = []   # (label, polygon, [districts])
for s, g in zip(states, simp):
    L = bystate[s]
    ps = [Polygon(p.exterior) for p in pieces(g)]          # drop holes (lakes, rounding slivers)
    # a piece inside another piece's hole (e.g. part of CA-42 behind a sliver gap) is covered once holes are dropped
    ps = [p for i, p in enumerate(ps) if not any(j != i and q.area > p.area and q.contains(p.representative_point()) for j, q in enumerate(ps))]
    home = defaultdict(list)
    for d in L:
        hit = [i for i, p in enumerate(ps) if p.contains(d["site"])]
        if hit:
            home[hit[0]].append(d)
        else:   # site fell outside after simplification: nearest piece, pulled inside
            i = min(range(len(ps)), key=lambda i: ps[i].distance(d["site"]))
            q = nearest_points(ps[i], d["site"])[0]
            inner = ps[i].buffer(-0.05)
            d["site"] = nearest_points(inner, q)[0] if not inner.is_empty else q
            home[i].append(d)
            print("  moved site inside:", d["name"])
    used = sorted(home)
    if s not in ("HI", "MI") and len(used) > 1:
        # e.g. CA-42, whose largest part lies across a channel: keep the district on the state's
        # main piece, at the centre of the part of the district that lies in that piece
        main = max(used, key=lambda i: ps[i].area)
        for i in used:
            if i == main:
                continue
            for d in home[i]:
                part = d["geom"].intersection(ps[main])
                part = max(pieces(part) if part.geom_type in ("Polygon", "MultiPolygon") else
                           [q for q in part.geoms if q.geom_type == "Polygon"], key=lambda q: q.area)
                c = part.centroid
                d["site"] = c if part.contains(c) and ps[main].contains(c) else polylabel(part, tolerance=0.01)
                home[main].append(d)
                print("  kept on main piece:", d["name"])
            del home[i]
        used = [main]
    if s == "HI":       # two islands -> one outline so the two districts can touch
        poly = union_all([ps[i] for i in used]).convex_hull
        outlines.append((s, poly, [d for i in used for d in home[i]]))
    elif s == "MI" and len(used) == 2:   # bridge the Straits of Mackinac
        a, b = ps[used[0]], ps[used[1]]
        pa, pb = nearest_points(a, b)
        from shapely.affinity import scale as _scale
        bridge = _scale(LineString([pa, pb]), 2.0, 2.0).buffer(0.75, cap_style=2)
        poly = union_all([a, b, bridge])
        others = [h for t, h in zip(states, simp) if t != "MI"]
        clash = sum(poly.difference(union_all([a, b])).intersection(o).area for o in others)
        print("  MI bridge length %.2f px, overlap with other states %.4f px^2" % (pa.distance(pb), clash))
        poly = Polygon(poly.exterior)
        outlines.append((s, poly, home[used[0]] + home[used[1]]))
    else:
        for i in used:
            outlines.append((s if len(used) == 1 else "%s%d" % (s, i), ps[i], home[i]))

assert sum(len(o[2]) for o in outlines) == 436
for label, poly, L in outlines:
    assert poly.is_valid, label
    assert all(poly.contains(d["site"]) for d in L), label
print(len(outlines), "outlines;", "multi-outline states:", [o[0] for o in outlines if not o[0].isalpha()])

COLORS = [(31,119,180),(255,127,14),(44,160,44),(214,39,40),(148,103,189),(140,86,75),(227,119,194),(127,127,127),(188,189,34),(23,190,207)]
f = lambda v: ("%.4f" % v).rstrip("0").rstrip(".")
lines = ["STAGE 1", "OUTLINES %d" % len(outlines)]
for k, (label, poly, L) in enumerate(outlines):
    poly = orient(poly, 1.0)                          # counter-clockwise, as in their files
    pts = list(poly.exterior.coords)[:-1]
    lp = poly.representative_point()
    col = COLORS[k % len(COLORS)]
    lines.append("OUT %d\t%s\t%s %s\t%d %d %d" % (k, label, f(lp.x), f(lp.y), *col))
    lines.append("\t".join("%s %s" % (f(x), f(y)) for x, y in pts))
    lines.append("SITECOUNT %d" % len(L))
    for j, d in enumerate(L):
        lines.append("SITE %d %d\t%s\t%s %s\t%d %d %d\tsites" % (k, j, d["fips"], f(d["site"].x), f(d["site"].y), *col))
open(OUT, "w").write("\n".join(lines) + "\n")
json.dump({d["fips"]: [d["site"].x, d["site"].y] for d in ds}, open(OUT.replace(".wkt", "_sites.json"), "w"))
print("wrote", OUT)
