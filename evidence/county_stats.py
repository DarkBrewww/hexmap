# County-level facts for the states question, next to the same facts for districts.
#   python county_stats.py        (reads data/counties-albers-10m.json and ../hexmap_data.js)
# Standard library only.
#
# Counties: us-atlas 3.0.1, counties-albers-10m.json, which is the Census Bureau's 2017 cartographic
# county boundaries as TopoJSON, projected with d3.geoAlbersUsa (https://github.com/topojson/us-atlas).
# Two counties are neighbours when they share a boundary arc, i.e. a stretch of border, not just a corner.
# That is the same rule as map_neighbors for districts.
# Areas: the lower 48 are drawn with an equal-area Albers projection, so planar area is proportional
# to land area. Alaska and Hawaii are left out of the area comparison (they are resized insets).
import json, os
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
AP = os.path.dirname(HERE)
topo = json.load(open(os.path.join(HERE, "data", "counties-albers-10m.json")))
sx, sy = topo["transform"]["scale"]; tx, ty = topo["transform"]["translate"]
arcs = []
for arc in topo["arcs"]:
    x = y = 0; pts = []
    for dx, dy in arc:
        x += dx; y += dy; pts.append((x * sx + tx, y * sy + ty))
    arcs.append(pts)

def ring(idx):
    pts = []
    for i in idx:
        a = arcs[i] if i >= 0 else arcs[~i][::-1]
        pts.extend(a if not pts else a[1:])
    return pts

def ring_area(p):
    return abs(sum(p[i][0] * p[i + 1][1] - p[i + 1][0] * p[i][1] for i in range(len(p) - 1))) / 2

TERRITORIES = {"60", "66", "69", "72", "78"}
geoms = [g for g in topo["objects"]["counties"]["geometries"] if g["id"][:2] not in TERRITORIES]
arc_owner = defaultdict(set)
area = defaultdict(float)
for g in geoms:
    polys = [g["arcs"]] if g["type"] == "Polygon" else g["arcs"]
    for poly in polys:
        for k, r in enumerate(poly):
            for i in r:
                arc_owner[i if i >= 0 else ~i].add(g["id"])
            a = ring_area(ring(r))
            area[g["id"][:2]] += a if k == 0 else -a

pairs = set()
for owners in arc_owner.values():
    owners = sorted(owners)
    for i in range(len(owners)):
        for j in range(i + 1, len(owners)):
            pairs.add((owners[i], owners[j]))
deg = defaultdict(int)
for a, b in pairs:
    deg[a] += 1; deg[b] += 1
cross = [p for p in pairs if p[0][:2] != p[1][:2]]
per_state = defaultdict(int)
for g in geoms:
    per_state[g["id"][:2]] += 1
counts = sorted(per_state.values())
n = len(geoms)

js = open(os.path.join(AP, "hexmap_data.js"), encoding="utf-8").read()
data = json.loads(js[js.index("{"):js.rstrip().rstrip(";").rindex("}") + 1])
props = {f["properties"]["geo_fips"]: f["properties"] for f in data["features"]}
dpairs = {tuple(sorted((f, m))) for f, p in props.items() for m in p["map_neighbors"]}
dcross = [p for p in dpairs if props[p[0]]["state_abbr"] != props[p[1]]["state_abbr"]]
dper = defaultdict(int)
for f in props:
    dper[f[:2]] += 1
dcounts = sorted(dper.values())
ddeg = defaultdict(int)
for a, b in dpairs:
    ddeg[a] += 1; ddeg[b] += 1

print("%-44s %10s %10s" % ("", "districts", "counties"))
print("%-44s %10d %10d" % ("units (50 states + DC)", len(props), n))
print("%-44s %10d %10d" % ("map neighbour pairs", len(dpairs), len(pairs)))
print("%-44s %10d %10d" % ("pairs across a state line", len(dcross), len(cross)))
print("%-44s %9.1f%% %9.1f%%" % ("share across a state line", 100 * len(dcross) / len(dpairs), 100 * len(cross) / len(pairs)))
print("%-44s %10d %10d" % ("units per state, median", dcounts[len(dcounts) // 2], counts[len(counts) // 2]))
print("%-44s %10s %10s" % ("units per state, min to max", "%d to %d" % (dcounts[0], dcounts[-1]), "%d to %d" % (counts[0], counts[-1])))
print("%-44s %10.2f %10.2f" % ("average map neighbours per unit", 2 * len(dpairs) / len(props), 2 * len(pairs) / n))
over = sum(1 for g in geoms if deg[g["id"]] > 6); dover = sum(1 for f in props if ddeg[f] > 6)
print("%-44s %4d (%2.0f%%) %4d (%2.0f%%)" % ("units with more than 6 map neighbours", dover, 100 * dover / len(props), over, 100 * over / n))

lower = [s for s in area if s not in ("02", "15")]
A = sum(area[s] for s in lower); C = sum(per_state[s] for s in lower); D = sum(dper[s] for s in lower)
tv_c = 50 * sum(abs(per_state[s] / C - area[s] / A) for s in lower)
tv_d = 50 * sum(abs(dper[s] / D - area[s] / A) for s in lower)
print()
print("One tile per unit, lower 48 + DC: share of tiles that would have to move between states")
print("for each state's share of tiles to equal its share of land area")
print("  districts %.1f%%   counties %.1f%%" % (tv_d, tv_c))
ratio = sorted(((per_state[s] / C) / (area[s] / A), (dper[s] / D) / (area[s] / A), s) for s in lower)
print("  state fips, tiles per unit of land area (1 = fair share): counties / districts")
for rc, rd, s in ratio[:3] + ratio[-3:]:
    print("    %s  %6.2f / %6.2f" % (s, rc, rd))
