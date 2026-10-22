# Side-by-side picture of hex layouts, coloured by state, state borders drawn thick.
#   python3 render_layouts.py OUT.html  NAME=path.tsv ...   (dashboard always first)
import sys, math, json
sys.path.insert(0, __import__("os").path.dirname(__file__))
import score_layout as S

R = 12.0
out = sys.argv[1]
lays = [("Dashboard (CDHD)", S.dashboard)] + [(a.split("=")[0], S.tsv_layout(a.split("=")[1])) for a in sys.argv[2:]]
st = {f: S.D[f]["state"] for f in S.D}
states = sorted(set(st.values()))
# a fixed qualitative palette cycled over states, with neighbouring states pushed apart by a greedy colouring
pal = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac"]
spairs = {tuple(sorted((st[a], st[b]))) for a, b in S.MAP if st[a] != st[b]}
nb = {s: set() for s in states}
for a, b in spairs:
    nb[a].add(b); nb[b].add(a)
col = {}
for s in sorted(states, key=lambda s: -len(nb[s])):
    used = {col[t] for t in nb[s] if t in col}
    col[s] = next(c for c in pal if c not in used)

def corners(x, y, r):
    return [(x + r * math.cos(math.radians(60 * k - 30)), y + r * math.sin(math.radians(60 * k - 30))) for k in range(6)]

panels = []
for name, lay in lays:
    xs = [p[0] for p in lay.values()]; ys = [-p[1] for p in lay.values()]
    x0, x1, y0, y1 = min(xs) - 20, max(xs) + 20, min(ys) - 20, max(ys) + 20
    cells = {}
    parts = []
    for f, (x, y) in lay.items():
        Y = -y
        pts = corners(x, Y, R)
        parts.append('<polygon points="%s" fill="%s" stroke="#fff" stroke-width="0.6"/>' % (" ".join("%.2f,%.2f" % p for p in pts), col[st[f]]))
    # thick border where neighbouring hexes belong to different states
    keys = {f: (x, -y) for f, (x, y) in lay.items()}
    for a, b in S.hex_pairs(lay):
        if st[a] != st[b]:
            (xa, ya), (xb, yb) = keys[a], keys[b]
            mx, my = (xa + xb) / 2, (ya + yb) / 2
            dx, dy = xb - xa, yb - ya
            L = math.hypot(dx, dy)
            ux, uy = -dy / L, dx / L
            h = R / 2
            parts.append('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="#222" stroke-width="1.6"/>' % (mx + ux * h, my + uy * h, mx - ux * h, my - uy * h))
    # state labels at the mean of their hexes
    for s in states:
        pts = [keys[f] for f in keys if st[f] == s]
        cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
        parts.append('<text x="%.1f" y="%.1f" font-size="9" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" fill="#111">%s</text>' % (cx, cy, s))
    sc = S.score(name, lay)
    cap = "%s: map neighbours kept %d/%d (%.1f%%), state borders kept %d/%d, states split %s, distance RMS %.2f, max %.1f hex steps" % (
        name, sc["map_pairs_kept"][0], sc["map_pairs_kept"][1], sc["map_pairs_kept"][2], sc["state_borders_kept"][0], sc["state_borders_kept"][1],
        ",".join(sc["states_split"]) or "none", sc["distance_hex_steps"]["rms"], sc["distance_hex_steps"]["max"])
    panels.append('<figure><svg viewBox="%.1f %.1f %.1f %.1f" width="760">%s</svg><figcaption>%s</figcaption></figure>' % (x0, y0, x1 - x0, y1 - y0, "".join(parts), cap))
html = '<!doctype html><meta charset="utf-8"><body style="font:13px sans-serif;background:#fff;margin:10px">%s</body>' % "".join(panels)
open(out, "w").write(html)
print("wrote", out)
