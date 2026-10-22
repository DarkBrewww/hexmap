# Layout scores for a hex layout of the 436 districts, the same way for any layout.
#
#   python3 score_layout.py [RUN.tsv ...]      (no argument: the dashboard's layout only)
#
# A layout is fips -> hex centre in grid units (pointy-top, radius 12, y up), the
# convention of cx/cy in hexmap_data.js.
import sys, json, math
sys.path.insert(0, __import__("os").path.dirname(__file__))
from load import load
from collections import defaultdict

R = 12.0
STEP = math.sqrt(3) * R          # centre-to-centre distance of neighbouring hexes

ds, hd = load()
D = {d["fips"]: d for d in ds}
for d in ds:
    c = d["geom"].centroid       # (x, -y_screen): planar area centroid, as d3's geoPath.centroid
    d["cen"] = (c.x, -c.y)       # back to screen coords, y down

def tsv_layout(path):
    lay = {}
    for line in open(path):
        x, y, fips = line.rstrip("\n").split("\t")
        x, y = int(x), int(y)
        lay[fips] = (R * math.sqrt(3) * (x - y / 2), R * 1.5 * y)
    return lay

dashboard = {d["fips"]: (d["cx"], d["cy"]) for d in ds}

def pairs(nbkey):
    s = set()
    for d in ds:
        for n in d[nbkey]:
            s.add(tuple(sorted((d["fips"], n))))
    return s

MAP = pairs("map_nb")

def hex_pairs(lay):
    cells = {}
    for f, (x, y) in lay.items():
        cells[(round(x, 3), round(y, 3))] = f
    out = set()
    items = list(lay.items())
    by = defaultdict(list)
    for f, (x, y) in items:
        by[(math.floor(x / STEP), math.floor(y / STEP))].append(f)
    for f, (x, y) in items:
        gx, gy = math.floor(x / STEP), math.floor(y / STEP)
        for a in (-2, -1, 0, 1, 2):
            for b in (-2, -1, 0, 1, 2):
                for g in by[(gx + a, gy + b)]:
                    if g != f:
                        X, Y = lay[g]
                        if abs(math.hypot(X - x, Y - y) - STEP) < 0.01 * STEP:
                            out.add(tuple(sorted((f, g))))
    return out

def fit(lay):
    # screen = s * (cx, -cy) + (tx, ty), least squares against district centroids (index.html section 2)
    P = [(lay[f][0], -lay[f][1]) for f in D]
    C = [D[f]["cen"] for f in D]
    n = len(P)
    pm = (sum(p[0] for p in P) / n, sum(p[1] for p in P) / n)
    cm = (sum(c[0] for c in C) / n, sum(c[1] for c in C) / n)
    num = sum((p[0] - pm[0]) * (c[0] - cm[0]) + (p[1] - pm[1]) * (c[1] - cm[1]) for p, c in zip(P, C))
    den = sum((p[0] - pm[0]) ** 2 + (p[1] - pm[1]) ** 2 for p in P)
    s = num / den
    tx, ty = cm[0] - s * pm[0], cm[1] - s * pm[1]
    dist = {}
    for f, p, c in zip(D, P, C):
        X, Y = s * p[0] + tx, s * p[1] + ty
        dist[f] = math.hypot(X - c[0], Y - c[1]) / (STEP * s)
    return s, dist

def components(fipses, hp):
    nb = defaultdict(set)
    for a, b in hp:
        if a in fipses and b in fipses:
            nb[a].add(b); nb[b].add(a)
    seen, comps = set(), 0
    for f in fipses:
        if f in seen:
            continue
        comps += 1
        stack = [f]
        while stack:
            g = stack.pop()
            if g in seen:
                continue
            seen.add(g)
            stack.extend(nb[g] - seen)
    return comps

def score(name, lay):
    hp = hex_pairs(lay)
    st = {f: D[f]["state"] for f in D}
    kept = MAP & hp
    within = {p for p in MAP if st[p[0]] == st[p[1]]}
    cross = MAP - within
    spairs = {tuple(sorted((st[a], st[b]))) for a, b in cross}
    skept = {tuple(sorted((st[a], st[b]))) for a, b in hp if st[a] != st[b]} & spairs
    sextra = {tuple(sorted((st[a], st[b]))) for a, b in hp if st[a] != st[b]} - spairs
    bystate = defaultdict(set)
    for f in D:
        bystate[st[f]].add(f)
    split = sorted(s for s, fs in bystate.items() if components(fs, hp) > 1)
    s, dist = fit(lay)
    # direction error: for every pair of map neighbours, the angle between the direction
    # from one hex to the other and the direction between the two district centroids
    errs = []
    for a, b in MAP:
        (xa, ya), (xb, yb) = lay[a], lay[b]
        (ca, da), (cb, db) = D[a]["cen"], D[b]["cen"]
        h = math.atan2(yb - ya, xb - xa)            # grid: y up
        g = math.atan2(-(db - da), cb - ca)         # screen y down -> up
        e = abs((h - g + math.pi) % (2 * math.pi) - math.pi)
        errs.append(math.degrees(e))
    errs.sort()
    vals = sorted(dist.values())
    rms = math.sqrt(sum(v * v for v in vals) / len(vals))
    worst = sorted(dist.items(), key=lambda kv: -kv[1])[:5]
    r = {
        "layout": name,
        "hex_pairs": len(hp),
        "map_pairs_kept": [len(kept), len(MAP), round(100 * len(kept) / len(MAP), 1)],
        "within_state_kept": [len(within & hp), len(within), round(100 * len(within & hp) / len(within), 1)],
        "cross_state_kept": [len(cross & hp), len(cross), round(100 * len(cross & hp) / len(cross), 1)],
        "state_borders_kept": [len(skept), len(spairs)],
        "new_state_contacts": len(sextra),
        "hex_pairs_not_map_neighbours": len(hp - MAP),
        "states_split": split,
        "direction_error_deg": {"mean": round(sum(errs) / len(errs), 1), "median": round(errs[len(errs) // 2], 1), "over_90": sum(e > 90 for e in errs)},
        "fit_scale": round(s, 4),
        "distance_hex_steps": {"rms": round(rms, 2), "median": round(vals[len(vals) // 2], 2), "max": round(vals[-1], 2)},
        "farthest": [(D[f]["name"], round(v, 1)) for f, v in worst],
    }
    return r

if __name__ == "__main__":
    results = [score("dashboard", dashboard)]
    for path in sys.argv[1:]:
        results.append(score(path.split("/")[-1].replace(".tsv", ""), tsv_layout(path)))
    for r in results:
        print(json.dumps(r))
