#!/usr/bin/env python3
# County regions file for the layout tools, in the same schema and coordinates as the district file.
#
#   python evidence/build_county_regions.py [--out evidence/data/county_regions.json]
#
# Input: evidence/data/counties-albers-10m.json (us-atlas 3.0.1: Census 2017 cartographic county
# boundaries, 1:10m, as TopoJSON projected with d3.geoAlbersUsa().scale(1300).translate([487.5, 305])).
# Output: the schema of hex-layouts/data.json (written by hex-layouts/prepare-data.mjs), so
# evidence/evaluate_layouts.py reads it with --regions and the groups can go to engine.generate():
#   regions  [{id, name, state, center, neighbors, rings, path}] for 3,142 counties (50 states + DC)
#   groups   mainland (lower 48 + DC), alaska, hawaii: {id, label, regions, boundary, boundaryRings,
#            anchor, metadata}, the boundary being the dissolved outline of the group's counties
#   viewBox, metadata
# There's no nyuTarget: the dashboard has no county hex layout.
#
# Coordinates: the district file uses d3.geoAlbersUsa() with its defaults (scale 1070, translate
# [480, 250]). Every part of geoAlbersUsa, the two insets included, is k * raw + translate, so
# p_district = (p_atlas - [487.5, 305]) * 1070 / 1300 + [480, 250] maps the atlas coordinates onto
# the district frame exactly. Counties and districts therefore line up, and hex steps mean the same.
#
# Neighbours: two counties share a boundary arc, a stretch of border and not just a corner, which is
#   the rule used for districts and in county_stats.py.
# Centre: the planar area-weighted centroid of all rings, the same formula as d3.geoPath().centroid().
# Standard library only. The output is deterministic: rerunning gives the same bytes.
import argparse, hashlib, json, math, os, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ATLAS_SCALE, ATLAS_TRANSLATE = 1300.0, (487.5, 305.0)
D3_SCALE, D3_TRANSLATE = 1070.0, (480.0, 250.0)          # d3.geoAlbersUsa() defaults
TERRITORIES = {"60", "66", "69", "72", "78"}
STATE = {"01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE",
         "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA",
         "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
         "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM",
         "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
         "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
         "54": "WV", "55": "WI", "56": "WY"}


def decode(topo):
    k = D3_SCALE / ATLAS_SCALE
    (sx, sy), (tx, ty) = topo["transform"]["scale"], topo["transform"]["translate"]
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx; y += dy
            ax, ay = x * sx + tx, y * sy + ty
            pts.append(((ax - ATLAS_TRANSLATE[0]) * k + D3_TRANSLATE[0], (ay - ATLAS_TRANSLATE[1]) * k + D3_TRANSLATE[1]))
        arcs.append(pts)
    return arcs


def oriented(arcs, i):
    return arcs[i] if i >= 0 else arcs[~i][::-1]


def ring_points(arcs, refs):
    pts = []
    for i in refs:
        a = oriented(arcs, i)
        pts.extend(a if not pts else a[1:])
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts.pop()
    out = []
    for p in pts:                                      # drop repeated points, as prepare-data.mjs does
        if not out or out[-1] != p:
            out.append(p)
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out


def signed_area(ring):
    return sum(ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1] for i in range(len(ring))) / 2


def centroid(rings):
    # d3-geo path/centroid.js for polygons: sum over ring edges of z = x0*y - x*y0, X += z*(x0+x), ...
    # and like d3, when the area is zero fall back to the length-weighted centroid of the outline,
    # then to the mean of its points.
    X = Y = Z = 0.0
    for ring in rings:
        if len(ring) < 3:
            continue
        x0, y0 = ring[-1]
        for x, y in ring:
            z = x0 * y - x * y0
            X += z * (x0 + x); Y += z * (y0 + y); Z += z * 3
            x0, y0 = x, y
    if Z:
        return [X / Z, Y / Z]
    X = Y = L = 0.0
    for ring in rings:
        for k in range(len(ring)):
            (x0, y0), (x, y) = ring[k - 1], ring[k]
            d = math.hypot(x - x0, y - y0)
            X += d * (x0 + x) / 2; Y += d * (y0 + y) / 2; L += d
    if L:
        return [X / L, Y / L]
    pts = [p for ring in rings for p in ring]
    return [sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)]


def contains(ring, p):
    x, y = p
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        (xi, yi), (xj, yj) = ring[i], ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def fmt(v):
    s = "%.3f" % v
    s = s.rstrip("0").rstrip(".")
    return "0" if s == "-0" else s


def svg_path(rings):
    return "".join("M" + "L".join("%s,%s" % (fmt(x), fmt(y)) for x, y in ring) + "Z" for ring in rings)


def simple(ring):
    # True when no two non-adjacent edges cross (sweep over x-sorted edges; fine at a few thousand edges)
    n = len(ring)
    edges = sorted(((min(ring[i][0], ring[(i + 1) % n][0]), max(ring[i][0], ring[(i + 1) % n][0]), i)
                    for i in range(n)))

    def cross(a, b, c, d):
        def o(p, q, r):
            v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
            return (v > 0) - (v < 0)
        return o(a, b, c) * o(a, b, d) < 0 and o(c, d, a) * o(c, d, b) < 0
    active = []
    for lo, hi, i in edges:
        active = [e for e in active if e[1] >= lo]
        for _, _, j in active:
            if abs(i - j) in (1, n - 1):
                continue
            if cross(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n]):
                return False
        active.append((lo, hi, i))
    return True


def dissolve(arcs, geoms):
    # Outline of a set of counties: the arcs only one of them uses, chained end to start in the
    # direction their county uses them. Where two outline arcs leave the same point, prefer the one
    # that follows in the same county ring, which keeps pinch points from joining two loops.
    use = defaultdict(int)
    for g in geoms:
        for poly in g["polys"]:
            for ring in poly:
                for i in ring:
                    use[i if i >= 0 else ~i] += 1
    pieces, after = [], {}
    for g in geoms:
        for poly in g["polys"]:
            for ring in poly:
                outer = [i for i in ring if use[i if i >= 0 else ~i] == 1]
                for k, i in enumerate(ring):
                    if use[i if i >= 0 else ~i] == 1:
                        pieces.append(i)
                        nxt = ring[(k + 1) % len(ring)]
                        if use[nxt if nxt >= 0 else ~nxt] == 1:
                            after[i] = nxt
                del outer
    starts = defaultdict(list)
    for i in pieces:
        starts[oriented(arcs, i)[0]].append(i)
    done, rings = set(), []
    for first in pieces:
        if first in done:
            continue
        refs, cur = [], first
        while True:
            done.add(cur)
            refs.append(cur)
            end = oriented(arcs, cur)[-1]
            options = [i for i in starts[end] if i not in done]
            if not options:
                if end != oriented(arcs, first)[0]:
                    sys.exit("county outline doesn't close")
                break
            pref = after.get(cur)
            cur = pref if pref in options else options[0]
        rings.append(ring_points(arcs, refs))
    rings = [r for r in rings if len(r) >= 3]
    return sorted(rings, key=lambda r: -abs(signed_area(r)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--atlas", default=os.path.join(HERE, "data", "counties-albers-10m.json"))
    ap.add_argument("--out", default=os.path.join(HERE, "data", "county_regions.json"))
    ap.add_argument("--districts", default=os.path.join(ROOT, "hex-layouts", "data.json"),
                    help="district file whose mainland outline the mainland group uses (see below)")
    ap.add_argument("--own-outline", action="store_true",
                    help="use the counties' own dissolved mainland outline instead")
    args = ap.parse_args()
    raw = open(args.atlas, "rb").read()
    topo = json.loads(raw)
    arcs = decode(topo)

    geoms = []
    for g in topo["objects"]["counties"]["geometries"]:
        if g["id"][:2] in TERRITORIES:
            continue
        polys = [g["arcs"]] if g["type"] == "Polygon" else g["arcs"]
        geoms.append({"id": g["id"], "name": g["properties"]["name"], "state": STATE[g["id"][:2]], "polys": polys})
    geoms.sort(key=lambda g: g["id"])
    if len({g["id"] for g in geoms}) != len(geoms):
        sys.exit("duplicate county ids")

    owners = defaultdict(set)
    for g in geoms:
        for poly in g["polys"]:
            for ring in poly:
                for i in ring:
                    owners[i if i >= 0 else ~i].add(g["id"])
    nb = defaultdict(set)
    for ids in owners.values():
        for a in ids:
            for b in ids:
                if a != b:
                    nb[a].add(b)

    regions, outside, degenerate = [], [], []
    for g in geoms:
        raw_rings = [ring_points(arcs, r) for poly in g["polys"] for r in poly]
        c = centroid(raw_rings)
        rings = [r for r in raw_rings if len(r) >= 3 and signed_area(r) != 0]
        if not all(math.isfinite(v) for v in c):
            sys.exit("no centroid for " + g["id"])
        if not rings:
            degenerate.append(g["id"])
        elif not any(contains(r, c) for r in rings):
            outside.append(g["id"])
        regions.append({"id": g["id"], "name": "%s, %s" % (g["name"], g["state"]), "state": g["state"],
                        "center": c, "neighbors": sorted(nb[g["id"]]), "rings": rings, "path": svg_path(rings)})

    by_id = {r["id"]: r for r in regions}
    pairs = sum(len(r["neighbors"]) for r in regions) // 2
    cross = sum(1 for r in regions for n in r["neighbors"] if n > r["id"] and by_id[n]["state"] != r["state"])

    seen, components = set(), []
    for r in regions:
        if r["id"] in seen:
            continue
        comp, todo = [], [r["id"]]
        seen.add(r["id"])
        while todo:
            i = todo.pop()
            comp.append(i)
            for j in by_id[i]["neighbors"]:
                if j not in seen:
                    seen.add(j); todo.append(j)
        components.append(sorted(comp))
    components.sort(key=lambda c: (-len(c), c[0]))

    groups = []
    specs = [("mainland", "Contiguous US + DC", lambda s: s not in ("AK", "HI")),
             ("alaska", "Alaska inset", lambda s: s == "AK"), ("hawaii", "Hawaii inset", lambda s: s == "HI")]
    for gid, label, keep in specs:
        sub = [g for g in geoms if keep(g["state"])]
        ids = {g["id"] for g in sub}
        members = [r for r in regions if r["id"] in ids]
        rings = dissolve(arcs, sub)
        boundary, method = rings[0], "Arcs used by only one county of the group, chained into rings; largest ring selected for the single-boundary generator."
        # The generator (hex-layouts/engine.js prepare) resamples the outline to 512 points. At 1:10m the
        # counties' mainland outline has a narrow inlet south-east of DC that folds under that resampling,
        # so by default the mainland group fills the district file's mainland outline: same coastline, same
        # frame, and district and county layouts then fill the same shape. boundaryRings keeps the counties'.
        if gid == "mainland" and not args.own_outline:
            district_groups = json.load(open(args.districts, encoding="utf-8"))["groups"]
            boundary = next(g for g in district_groups if g["id"] == "mainland")["boundary"]
            method = ("Selected boundary is the mainland outline of %s (Census 2024 1:20m, dissolved districts), "
                      "because the 1:10m county outline folds when the generator resamples it to 512 points; "
                      "boundaryRings are the counties' own dissolved outline." % os.path.relpath(args.districts, ROOT))
        groups.append({
            "id": gid, "label": label,
            "regions": [{"id": r["id"], "name": r["name"], "state": r["state"], "center": r["center"],
                         "neighbors": [n for n in r["neighbors"] if n in ids]} for r in members],
            "boundary": boundary, "boundaryRings": rings,
            # math.fsum, not sum: Python 3.12 changed float sum(), and the output should be the same bytes on any version
            "anchor": [math.fsum(r["center"][0] for r in members) / len(members), math.fsum(r["center"][1] for r in members) / len(members)],
            "metadata": {"count": len(members),
                         "boundaryMethod": method,
                         "originalBoundaryRingCount": len(rings), "selectedBoundaryVertexCount": len(boundary),
                         "selectedBoundarySimple": simple(boundary),
                         "centersOutsideSelectedBoundary": [r["id"] for r in members if not contains(boundary, r["center"])]}})

    xs = [p[0] for r in regions for ring in r["rings"] for p in ring]
    ys = [p[1] for r in regions for ring in r["rings"] for p in ring]
    pad = 12
    view = [min(xs) - pad, min(ys) - pad, max(xs) - min(xs) + 2 * pad, max(ys) - min(ys) + 2 * pad]
    data = {"regions": regions, "groups": groups, "viewBox": view, "metadata": {
        "schemaVersion": 2,
        "unit": "county",
        "source": "us-atlas 3.0.1 counties-albers-10m.json: Census Bureau 2017 cartographic county boundaries, 1:10m; 3,142 counties and county equivalents in the 50 states and DC (territories dropped).",
        "sourceUrl": "https://github.com/topojson/us-atlas",
        "sourceSha256": hashlib.sha256(raw).hexdigest(),
        "projection": "d3.geoAlbersUsa() with unchanged defaults, the same frame as the district file: the atlas's d3.geoAlbersUsa().scale(1300).translate([487.5, 305]) coordinates mapped exactly by (p - [487.5, 305]) * 1070/1300 + [480, 250].",
        "coordinateSystem": "Projected screen units; x right, y down.",
        "projectionScale": D3_SCALE, "projectionTranslate": list(D3_TRANSLATE),
        "representativePoint": "Planar area-weighted centroid of all rings (the d3.geoPath centroid formula).",
        "centersOutsideOwnPolygon": outside,
        "noAreaAtThisScale": degenerate,
        "noAreaNote": "These counties shrink to fewer than three points at the atlas's 1:10m precision, so they have no rings; their centre is d3's fallback (outline length-weighted centroid, else mean of points) and they keep their shared-border neighbours.",
        "adjacency": "Counties sharing a TopoJSON boundary arc: a stretch of border, not corner-only contact. No water connections.",
        "adjacencyPairs": pairs, "crossStatePairs": cross,
        "highDegreeRegionCount": sum(1 for r in regions if len(r["neighbors"]) > 6),
        "connectedComponentSizes": [len(c) for c in components],
        "isolatedRegions": [c[0] for c in components if len(c) == 1],
        "builtBy": "evidence/build_county_regions.py"}}
    text = json.dumps(data, separators=(",", ":")) + "\n"
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(text)

    print("counties %d (Alaska %d, Hawaii %d)" % (len(regions), groups[1]["metadata"]["count"], groups[2]["metadata"]["count"]))
    print("neighbour pairs %d, across a state line %d (%.1f%%)" % (pairs, cross, 100 * cross / pairs))
    print("counties with more than 6 neighbours %d" % data["metadata"]["highDegreeRegionCount"])
    print("connected components by neighbours: %d, sizes %s" % (len(components), data["metadata"]["connectedComponentSizes"][:8]))
    print("isolated counties (no neighbour): %s" % " ".join(data["metadata"]["isolatedRegions"]))
    print("centroid outside its own county: %d (%s)" % (len(outside), " ".join(outside)))
    print("no area at 1:10m (centre from the outline): %s" % " ".join("%s %s" % (i, by_id[i]["name"]) for i in degenerate))
    for g in groups:
        m = g["metadata"]
        print("group %-8s %4d counties, outline rings %d, largest %d vertices, simple %s, centres outside it %d"
              % (g["id"], m["count"], m["originalBoundaryRingCount"], m["selectedBoundaryVertexCount"],
                 m["selectedBoundarySimple"], len(m["centersOutsideSelectedBoundary"])))
    print("viewBox %s" % " ".join("%.2f" % v for v in view))
    print("wrote %s (%.1f MB)" % (os.path.relpath(args.out, ROOT), len(text) / 1e6))


if __name__ == "__main__":
    main()
