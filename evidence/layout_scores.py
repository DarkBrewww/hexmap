# Neighbour and state scores for every layout in a hex-layout-lab-v2 file, plus the NYU layout.
#   python layout_scores.py [LAYOUTS.json]   (default: friday_layouts.json here; reads ../hexmap_data.js)
# Standard library only.
#
# Map neighbours  = map_neighbors in hexmap_data.js (districts sharing a Census border segment).
# Hex neighbours  = cells that are next to each other on the hex grid (axial q, r).
# Pairs kept      = map neighbour pairs that are also hex neighbours.
# States split    = states whose districts don't form one connected group of hexes.
# Borders kept    = pairs of states that share a border on the map and still touch in the layout.
import json, os, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
AP = os.path.dirname(HERE)
layouts_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "friday_layouts.json")

js = open(os.path.join(AP, "hexmap_data.js"), encoding="utf-8").read()
data = json.loads(js[js.index("{"):js.rstrip().rstrip(";").rindex("}") + 1])
props = {f["properties"]["geo_fips"]: f["properties"] for f in data["features"]}
state = {f: p["state_abbr"] for f, p in props.items()}

def pairs(nb):
    return {tuple(sorted((a, b))) for a, ns in nb.items() for b in ns}

MAP = pairs({f: p["map_neighbors"] for f, p in props.items()})
cross = {p for p in MAP if state[p[0]] != state[p[1]]}
map_borders = {tuple(sorted((state[a], state[b]))) for a, b in cross}

def scores(hexpairs):
    nb = defaultdict(set)
    for a, b in hexpairs:
        nb[a].add(b); nb[b].add(a)
    split = []
    for s in sorted(set(state.values())):
        members = [f for f in state if state[f] == s]
        seen, stack = {members[0]}, [members[0]]
        while stack:
            for g in nb[stack.pop()]:
                if state[g] == s and g not in seen:
                    seen.add(g); stack.append(g)
        if len(seen) < len(members):
            split.append(s)
    touching = {tuple(sorted((state[a], state[b]))) for a, b in hexpairs if state[a] != state[b]}
    return len(MAP & hexpairs), len(hexpairs), split, len(map_borders & touching)

DIRS = [(1, 0), (0, 1), (-1, 1), (-1, 0), (0, -1), (1, -1)]
rows = [("NYU (dashboard)", scores(pairs({f: p["hex_neighbors"] for f, p in props.items()})))]
for c in json.load(open(layouts_path, encoding="utf-8"))["candidates"]:
    at = {(cell["q"], cell["r"]): cell["id"] for cell in c["cells"]}
    hp = {tuple(sorted((cell["id"], at[(cell["q"] + dq, cell["r"] + dr)])))
          for cell in c["cells"] for dq, dr in DIRS if (cell["q"] + dq, cell["r"] + dr) in at}
    rows.append((c["id"], scores(hp)))

print("districts %d, map neighbour pairs %d, of which across state lines %d (%.1f%%), state borders %d"
      % (len(props), len(MAP), len(cross), 100 * len(cross) / len(MAP), len(map_borders)))
print()
print("%-30s %10s %10s %13s %14s" % ("layout", "pairs kept", "hex pairs", "states split", "borders kept"))
for name, (kept, hexpairs, split, borders) in rows:
    print("%-30s %10d %10d %13d %9d / %d   %s" % (name, kept, hexpairs, len(split), borders, len(map_borders), ",".join(split)))
