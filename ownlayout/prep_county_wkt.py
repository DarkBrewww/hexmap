# Builds the Meulemans pipeline input for counties, the same way prep_wkt.py does for districts.
#
#   python3 ownlayout/prep_county_wkt.py OUT.wkt [simplify_tolerance=0.5]
#   python3 ownlayout/prep_noparts.py OUT.wkt OUT_noparts.wkt      (the variant without state walls)
#
# Input: evidence/data/county_regions.json (evidence/build_county_regions.py), which is in the same
# screen coordinates as the district geometry prep_wkt.py reads, so both use y_up = 600 - y.
# One outline per state (simplified together with shapely's coverage_simplify, so neighbouring states
# keep exactly shared borders and the pipeline links them into one joint cartogram); Alaska and Hawaii
# are outlines of their own. Sites are the 3,142 counties.
#
# The rules are prep_wkt.py's, applied to counties:
#   site: centroid of the county's largest piece if it lies inside it, else its pole of inaccessibility;
#         the three Virginia cities with no area at 1:10m use their centre from county_regions.json.
#   holes are dropped (lakes, slivers); a site outside its state after simplification moves to the
#   nearest point just inside.
#   a state in several pieces keeps its counties on the main piece. A county with land on the main
#   piece goes to the centre of that land; a county with none (an island county such as Nantucket)
#   goes to the point of the main piece nearest its own site, just inside the coast.
#   Hawaii: the islands' convex hull, so its counties can touch. Michigan: a bridge across the Straits
#   of Mackinac, as for districts.
import json, math, os, sys
from collections import defaultdict
from shapely import union_all, coverage_simplify, coverage_is_valid, make_valid
from shapely.affinity import scale as _scale
from shapely.geometry import Polygon, MultiPolygon, Point, LineString
from shapely.geometry.polygon import orient
from shapely.ops import polylabel, nearest_points

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1]
TOL = float(sys.argv[2]) if len(sys.argv) > 2 else 0.5
H = 600.0
MIN_GAP = 0.05          # two sites closer than this (px) count as one point; see the check at the end

data = json.load(open(os.path.join(HERE, "..", "evidence", "data", "county_regions.json"), encoding="utf-8"))


def pieces(g):
    if g.is_empty:
        return []
    if isinstance(g, MultiPolygon):
        return list(g.geoms)
    if isinstance(g, Polygon):
        return [g]
    return [q for q in getattr(g, "geoms", []) if isinstance(q, Polygon)]


def inside(poly, p):
    # nearest point just inside poly
    q = nearest_points(poly, p)[0]
    inner = poly.buffer(-0.05)
    return nearest_points(inner, q)[0] if not inner.is_empty else q


cs = []
for r in data["regions"]:
    geom = None
    for ring in r["rings"]:                      # even-odd over rings, as load.py does
        p = make_valid(Polygon([(x, H - y) for x, y in ring]))
        geom = p if geom is None else make_valid(geom.symmetric_difference(p))
    if geom is None or geom.is_empty:
        site = Point(r["center"][0], H - r["center"][1])
    else:
        big = max(pieces(geom), key=lambda p: p.area)
        c = big.centroid
        site = c if big.contains(c) else polylabel(big, tolerance=0.01)
    cs.append({"fips": r["id"], "name": r["name"], "state": r["state"], "geom": geom, "site": site})

bystate = defaultdict(list)
for c in cs:
    bystate[c["state"]].append(c)
states = sorted(bystate)
raw = [union_all([c["geom"] for c in bystate[s] if c["geom"] is not None]) for s in states]
print("coverage valid before simplify:", coverage_is_valid(raw))
simp = list(coverage_simplify(raw, TOL))
print("vertices before/after:", sum(len(p.exterior.coords) for g in raw for p in pieces(g)),
      sum(len(p.exterior.coords) for g in simp for p in pieces(g)))

moved = {"outside": [], "main_land": [], "island": []}
outlines = []
for s, g in zip(states, simp):
    L = bystate[s]
    ps = [Polygon(p.exterior) for p in pieces(g)]
    ps = [p for i, p in enumerate(ps) if not any(j != i and q.area > p.area and q.contains(p.representative_point()) for j, q in enumerate(ps))]
    home = defaultdict(list)
    for c in L:
        hit = [i for i, p in enumerate(ps) if p.contains(c["site"])]
        if hit:
            home[hit[0]].append(c)
        else:
            i = min(range(len(ps)), key=lambda i: ps[i].distance(c["site"]))
            c["site"] = inside(ps[i], c["site"])
            home[i].append(c)
            moved["outside"].append(c["fips"])
    used = sorted(home)
    if s not in ("HI", "MI") and len(used) > 1:
        main = max(used, key=lambda i: ps[i].area)
        for i in used:
            if i == main:
                continue
            for c in home[i]:
                part = c["geom"].intersection(ps[main]) if c["geom"] is not None else None
                land = [q for q in pieces(part)] if part is not None else []
                land = [q for q in land if q.area > 1e-6]
                if land:
                    big = max(land, key=lambda q: q.area)
                    cc = big.centroid
                    c["site"] = cc if big.contains(cc) and ps[main].contains(cc) else polylabel(big, tolerance=0.01)
                    if not ps[main].contains(c["site"]):
                        c["site"] = inside(ps[main], c["site"])
                    moved["main_land"].append(c["fips"])
                else:
                    c["site"] = inside(ps[main], c["site"])
                    moved["island"].append(c["fips"])
                home[main].append(c)
            del home[i]
        used = [main]
    if s == "HI":
        poly = union_all([ps[i] for i in used]).convex_hull
        outlines.append((s, poly, [c for i in used for c in home[i]]))
    elif s == "MI" and len(used) == 2:
        a, b = ps[used[0]], ps[used[1]]
        pa, pb = nearest_points(a, b)
        bridge = _scale(LineString([pa, pb]), 2.0, 2.0).buffer(0.75, cap_style=2)
        poly = union_all([a, b, bridge])
        others = [h for t, h in zip(states, simp) if t != "MI"]
        clash = sum(poly.difference(union_all([a, b])).intersection(o).area for o in others)
        print("  MI bridge length %.2f px, overlap with other states %.4f px^2" % (pa.distance(pb), clash))
        outlines.append((s, Polygon(poly.exterior), home[used[0]] + home[used[1]]))
    else:
        if len(used) != 1:
            sys.exit("%s: counties on %d pieces" % (s, len(used)))
        outlines.append((s, ps[used[0]], home[used[0]]))

# Two counties must not share a site point (an island county pulled to the coast next to another site,
# or a no-area city inside its neighbour). Nudge the later one inward until it's clear.
for label, poly, L in outlines:
    for k, c in enumerate(L):
        for _ in range(200):
            near = [o for o in L[:k] if o["site"].distance(c["site"]) < MIN_GAP]
            if not near:
                break
            dx, dy = poly.representative_point().x - c["site"].x, poly.representative_point().y - c["site"].y
            n = math.hypot(dx, dy) or 1.0
            c["site"] = Point(c["site"].x + MIN_GAP * dx / n, c["site"].y + MIN_GAP * dy / n)
        else:
            sys.exit("could not separate site of " + c["fips"])

n_sites = sum(len(o[2]) for o in outlines)
assert n_sites == len(data["regions"]), n_sites
for label, poly, L in outlines:
    assert poly.is_valid, label
    bad = [c["fips"] for c in L if not poly.contains(c["site"])]
    assert not bad, (label, bad)
gap = min((a["site"].distance(b["site"]) for _, _, L in outlines for i, a in enumerate(L) for b in L[i + 1:]
           if abs(a["site"].x - b["site"].x) < 1), default=None)
print("%d outlines, %d sites; smallest gap between two sites of one outline %.3f px" % (len(outlines), n_sites, gap))
for k, v in moved.items():
    print("sites moved (%s): %d %s" % (k, len(v), " ".join(v)))

COLORS = [(31,119,180),(255,127,14),(44,160,44),(214,39,40),(148,103,189),(140,86,75),(227,119,194),(127,127,127),(188,189,34),(23,190,207)]
f = lambda v: ("%.4f" % v).rstrip("0").rstrip(".")
lines = ["STAGE 1", "OUTLINES %d" % len(outlines)]
for k, (label, poly, L) in enumerate(outlines):
    poly = orient(poly, 1.0)
    pts = list(poly.exterior.coords)[:-1]
    lp = poly.representative_point()
    col = COLORS[k % len(COLORS)]
    lines.append("OUT %d\t%s\t%s %s\t%d %d %d" % (k, label, f(lp.x), f(lp.y), *col))
    lines.append("\t".join("%s %s" % (f(x), f(y)) for x, y in pts))
    lines.append("SITECOUNT %d" % len(L))
    for j, c in enumerate(L):
        lines.append("SITE %d %d\t%s\t%s %s\t%d %d %d\tsites" % (k, j, c["fips"], f(c["site"].x), f(c["site"].y), *col))
open(OUT, "w").write("\n".join(lines) + "\n")
json.dump({c["fips"]: [c["site"].x, c["site"].y] for c in cs}, open(OUT.replace(".wkt", "_sites.json"), "w"))
print("wrote", OUT)
