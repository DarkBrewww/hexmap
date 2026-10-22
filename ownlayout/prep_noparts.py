# Variant input without state outlines: the lower 48 + DC as one outline (the union of the
# state outlines in IN.wkt, so the same simplified borders), Alaska and Hawaii separate.
#   python3 prep_noparts.py IN.wkt OUT.wkt
import sys
from shapely.geometry import Polygon
from shapely import union_all
from shapely.geometry.polygon import orient
src, dst = sys.argv[1], sys.argv[2]
L = open(src).read().split("\n")
outs = []
i = 2
while i < len(L) and L[i].startswith("OUT "):
    head = L[i].split("\t")
    poly = Polygon([tuple(map(float, p.split(" "))) for p in L[i + 1].split("\t")])
    n = int(L[i + 2].split(" ")[1])
    sites = [L[i + 3 + j].split("\t") for j in range(n)]
    outs.append((head[1], poly, sites))
    i += 3 + n
main = [o for o in outs if o[0] not in ("AK", "HI")]
u = union_all([o[1] for o in main])
print("union type", u.geom_type, "holes", len(u.interiors) if u.geom_type == "Polygon" else "-")
if u.geom_type != "Polygon":
    raise SystemExit("union is not one polygon")
u = orient(Polygon(u.exterior), 1.0)
groups = [("US48", u, [s for o in main for s in o[2]])] + [o for o in outs if o[0] in ("AK", "HI")]
f = lambda v: ("%.4f" % v).rstrip("0").rstrip(".")
lines = ["STAGE 1", "OUTLINES %d" % len(groups)]
for k, (label, poly, sites) in enumerate(groups):
    lp = poly.representative_point()
    lines.append("OUT %d\t%s\t%s %s\t%d %d %d" % (k, label, f(lp.x), f(lp.y), 70, 110, 160))
    lines.append("\t".join("%s %s" % (f(x), f(y)) for x, y in list(poly.exterior.coords)[:-1]))
    lines.append("SITECOUNT %d" % len(sites))
    for j, s in enumerate(sites):
        lines.append("SITE %d %d\t%s\t%s\t%s\tsites" % (k, j, s[1], s[2], s[3]))
open(dst, "w").write("\n".join(lines) + "\n")
print("wrote", dst, "sites", sum(len(g[2]) for g in groups), "outline vertices", len(u.exterior.coords) - 1)
