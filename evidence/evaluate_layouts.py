#!/usr/bin/env python3
# One score sheet for hex layouts: every published grid-map quality facet, per layout.
#
#   python evidence/evaluate_layouts.py [LAYOUTS.json ...] [--regions FILE] [--morph CSV] [--out DIR]
#
# Defaults: evidence/friday_layouts.json, regions from hex-layouts/data.json (whose nyuTarget is
# scored as the baseline "NYU"), morph scores from evidence/morph_scores.csv
# (made by node evidence/morph_scores.cjs), outputs into evidence/.
# Standard library only. Writes:
#   layout_metrics.csv             one row per layout, every metric
#   layout_metrics_per_region.csv  one row per layout and region, the per-region values
#   layout_metrics_summary.md      definitions, headline table, Pareto set, checks
#   layout_scorecard.svg           the one-picture version of the headline table
#
# Inputs, so the same script runs on counties later:
#   regions file  {"regions": [{"id", "state", "center": [x, y], "neighbors": [ids],
#                  "rings": [[[x, y], ...], ...]}], "nyuTarget": optional layout}
#                 in projected screen units (x right, y down). hex-layouts/prepare-data.mjs makes it.
#   layout files  hex-layout-lab-v2 exports (layout-import.js has the schema): per candidate a
#                 grid {origin, step, shape} and cells [{id, q, r}], in the same screen units.
#
# Every metric is defined in METRIC_DOCS below; the summary prints those definitions.
import argparse, csv, json, math, os, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SQRT3 = math.sqrt(3)
DIRS = [(1, 0), (0, 1), (-1, 1), (-1, 0), (0, -1), (1, -1)]
KS = [5, 15, 50, 100, 0]          # 0 means every other region ("all")
ROW_H = 0.25                      # scanline spacing for the footprint IoU, in screen units
EPS_CELL = 1e-9                   # "same x / same y" tolerance for cells, in hex steps
EPS_SITE = 1e-9                   # and for region centroids, in screen units

# Unit lattice (spacing 1) of each orientation, matching gridDefinition in hex-layouts/engine.js.
BASIS = {"flat-side": ((1.0, 0.0), (0.5, SQRT3 / 2)),
         "flat-base": ((SQRT3 / 2, 0.5), (0.0, 1.0))}
PHASE = {"flat-side": math.pi / 6, "flat-base": 0.0}   # hexCorners in engine.js


# ---------------------------------------------------------------- loading
def load_regions(path, group=None):
    data = json.load(open(path, encoding="utf-8"))
    regions = sorted(data["regions"], key=lambda r: r["id"])
    if group:                                   # score one group only, e.g. the mainland counties
        found = [g for g in data.get("groups", []) if g["id"] == group]
        if not found:
            sys.exit("no group %r in %s" % (group, path))
        keep = {r["id"] for r in found[0]["regions"]}
        regions = [r for r in regions if r["id"] in keep]
    ids = [r["id"] for r in regions]
    if len(set(ids)) != len(ids):
        sys.exit("duplicate region ids in " + path)
    known = set(ids)
    nb = defaultdict(set)
    for r in regions:
        for n in r["neighbors"]:
            if n in known and n != r["id"]:
                nb[r["id"]].add(n); nb[n].add(r["id"])
    return data, regions, nb


def layout_from(cand, ids, name):
    grid = cand["grid"]
    shape, step, origin = grid["shape"], float(grid["step"]), grid["origin"]
    if shape not in BASIS:
        sys.exit("%s: unsupported hex orientation %r" % (name, shape))
    u, v = BASIS[shape]
    cells, seen = {}, set()
    for c in cand["cells"]:
        q, r = int(c["q"]), int(c["r"])
        if (q, r) in seen or c["id"] in cells:
            sys.exit("%s: two districts share a cell, or a district appears twice" % name)
        seen.add((q, r))
        lx, ly = q * u[0] + r * v[0], q * u[1] + r * v[1]          # position in hex steps
        cells[c["id"]] = {"q": q, "r": r, "lat": (lx, ly),
                          "xy": (origin[0] + step * lx, origin[1] + step * ly)}
    if set(cells) != set(ids):
        sys.exit("%s: cells don't cover exactly the %d regions" % (name, len(ids)))
    return {"name": name, "shape": shape, "step": step, "cells": cells}


# ---------------------------------------------------------------- helpers
def stats(values):
    v = sorted(values)
    n = len(v)

    def pct(p):                       # linear interpolation between ranks, as numpy's default
        x = (n - 1) * p
        lo = math.floor(x)
        hi = min(lo + 1, n - 1)
        return v[lo] + (v[hi] - v[lo]) * (x - lo)
    return {"mean": sum(v) / n, "median": pct(0.5), "p90": pct(0.9), "max": v[-1]}


def hex_pairs(lay):
    at = {(c["q"], c["r"]): i for i, c in lay["cells"].items()}
    out = set()
    for i, c in lay["cells"].items():
        for dq, dr in DIRS:
            j = at.get((c["q"] + dq, c["r"] + dr))
            if j is not None:
                out.add(tuple(sorted((i, j))))
    return out


def angle_between(ax, ay, bx, by):
    d = abs(math.atan2(ay, ax) - math.atan2(by, bx)) % (2 * math.pi)
    return math.degrees(min(d, 2 * math.pi - d))


# Scanline footprints. A footprint is a list of shapes, each a list of closed rings; a point is
# inside a shape by the even-odd rule over its rings, and inside the footprint if inside any shape.
# For each scanline y the footprint becomes a sorted list of disjoint x-intervals.
class Footprint:
    def __init__(self, shapes, y0, rows):
        self.y0, self.rows = y0, rows
        self.buckets = defaultdict(list)          # row -> [(shape index, x1, y1, x2, y2)]
        self.cache = {}
        for si, rings in enumerate(shapes):
            for ring in rings:
                m = len(ring)
                for k in range(m):
                    (x1, y1), (x2, y2) = ring[k], ring[(k + 1) % m]
                    if y1 == y2:
                        continue
                    a = max(0, math.floor((min(y1, y2) - y0) / ROW_H))
                    b = min(rows - 1, math.floor((max(y1, y2) - y0) / ROW_H))
                    for row in range(a, b + 1):
                        self.buckets[row].append((si, x1, y1, x2, y2))

    def intervals_at(self, y):
        if y in self.cache:
            return self.cache[y]
        self.cache[y] = out = self._intervals_at(y)
        return out

    def _intervals_at(self, y):
        row = math.floor((y - self.y0) / ROW_H)
        xs = defaultdict(list)
        for si, x1, y1, x2, y2 in self.buckets.get(row, ()):
            if (y1 <= y < y2) or (y2 <= y < y1):            # half-open: vertices count once
                xs[si].append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
        spans = []
        for v in xs.values():
            v.sort()
            spans.extend((v[k], v[k + 1]) for k in range(0, len(v) - 1, 2))
        spans.sort()
        merged = []
        for a, b in spans:
            if merged and a <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], b)
            else:
                merged.append([a, b])
        return merged


def overlap_len(p, q):
    i = j = 0
    total = 0.0
    while i < len(p) and j < len(q):
        lo, hi = max(p[i][0], q[j][0]), min(p[i][1], q[j][1])
        if hi > lo:
            total += hi - lo
        if p[i][1] < q[j][1]:
            i += 1
        else:
            j += 1
    return total


# ---------------------------------------------------------------- the metrics
class Context:
    """Everything about the regions that doesn't depend on the layout."""
    def __init__(self, regions, nb):
        self.ids = [r["id"] for r in regions]
        self.n = len(self.ids)
        self.center = {r["id"]: tuple(r["center"]) for r in regions}
        self.state = {r["id"]: r.get("state", "") for r in regions}
        self.nb = nb
        self.map_pairs = {tuple(sorted((a, b))) for a in nb for b in nb[a]}
        cross = {p for p in self.map_pairs if self.state[p[0]] != self.state[p[1]]}
        self.state_borders = {tuple(sorted((self.state[a], self.state[b]))) for a, b in cross}
        self.cross_pairs = cross
        self.by_state = defaultdict(list)
        for i in self.ids:
            self.by_state[self.state[i]].append(i)
        # k nearest neighbours on the map, by centroid distance (ties broken by id)
        self.knn = {}
        for i in self.ids:
            xi, yi = self.center[i]
            others = sorted((math.hypot(self.center[j][0] - xi, self.center[j][1] - yi), j)
                            for j in self.ids if j != i)
            self.knn[i] = [j for _, j in others]
        # map footprint, for the outline-shape measure
        self.rings = {r["id"]: r["rings"] for r in regions}
        ys = [p[1] for r in regions for ring in r["rings"] for p in ring]
        xs = [p[0] for r in regions for ring in r["rings"] for p in ring]
        self.map_box = (min(xs), min(ys), max(xs), max(ys))


def fit_location(ctx, lay):
    # least squares: centroid ~ s * cell + t (uniform scale, translation), McNeill & Hale 2017
    P = [lay["cells"][i]["xy"] for i in ctx.ids]
    C = [ctx.center[i] for i in ctx.ids]
    n = len(P)
    pm = (sum(p[0] for p in P) / n, sum(p[1] for p in P) / n)
    cm = (sum(c[0] for c in C) / n, sum(c[1] for c in C) / n)
    num = sum((p[0] - pm[0]) * (c[0] - cm[0]) + (p[1] - pm[1]) * (c[1] - cm[1]) for p, c in zip(P, C))
    den = sum((p[0] - pm[0]) ** 2 + (p[1] - pm[1]) ** 2 for p in P)
    s = num / den
    t = (cm[0] - s * pm[0], cm[1] - s * pm[1])
    placed = {i: (s * p[0] + t[0], s * p[1] + t[1]) for i, p in zip(ctx.ids, P)}
    disp = {i: math.hypot(placed[i][0] - ctx.center[i][0], placed[i][1] - ctx.center[i][1]) / (s * lay["step"])
            for i in ctx.ids}
    return s, placed, disp


def deform(ctx, lay, i, nbrs):
    # Meulemans 2026 Deformation (GridMapPipeline analyze/analyzers/Deformation.java):
    # desired d_j = centroid_j - centroid_i, realized r_j = cell_j - cell_i (hex steps);
    # cost = min over scale s of mean_j |s d_j - r_j|^2.
    ci, li = ctx.center[i], lay["cells"][i]["lat"]
    a = b = c = 0.0
    for j in nbrs:
        dx, dy = ctx.center[j][0] - ci[0], ctx.center[j][1] - ci[1]
        lj = lay["cells"][j]["lat"]
        rx, ry = lj[0] - li[0], lj[1] - li[1]
        a += dx * dx + dy * dy
        b -= 2 * (dx * rx + dy * ry)
        c += rx * rx + ry * ry
    s = -b / (2 * a)
    return max(0.0, a * s * s + b * s + c) / len(nbrs)


def sgn(v):
    return (v > 0) - (v < 0)


def ortho(ctx, lay, i, nbrs):
    # Meulemans 2026 OrthogonalOrder (analyze/analyzers/OrthogonalOrder.java): count neighbours
    # whose left/right relation to i differs between map and grid, plus those whose above/below
    # relation differs. A tie (same x, or same y) on either side never counts. Max 2k.
    ci, li = ctx.center[i], lay["cells"][i]["lat"]
    flips = 0
    for j in nbrs:
        cj, lj = ctx.center[j], lay["cells"][j]["lat"]
        for axis in (0, 1):
            g, m = lj[axis] - li[axis], cj[axis] - ci[axis]
            if abs(g) <= EPS_CELL or abs(m) <= EPS_SITE:
                continue
            if sgn(g) != sgn(m):
                flips += 1
    return flips


def evaluate(ctx, lay):
    out, per = {}, {i: {} for i in ctx.ids}
    hp = hex_pairs(lay)
    hnb = defaultdict(set)
    for a, b in hp:
        hnb[a].add(b); hnb[b].add(a)

    # 1. location
    s, placed, disp = fit_location(ctx, lay)
    for k, v in stats(disp.values()).items():
        out["loc_" + k] = v
    out["loc_rms"] = math.sqrt(sum(v * v for v in disp.values()) / ctx.n)
    out["loc_worst"] = max(ctx.ids, key=lambda i: disp[i])
    for i in ctx.ids:
        per[i]["displacement"] = disp[i]

    # 2. adjacency (Schiewe 2021: omission T_ON, commission T_CN, islands T_PI)
    kept = ctx.map_pairs & hp
    out["pairs_kept"] = len(kept)
    out["pairs_lost"] = len(ctx.map_pairs) - len(kept)
    out["false_pairs"] = len(hp - ctx.map_pairs)
    out["omission_rate"] = out["pairs_lost"] / len(ctx.map_pairs)
    out["commission_rate"] = out["false_pairs"] / len(hp) if hp else 0.0
    out["isolated_tiles"] = sum(1 for i in ctx.ids if not hnb[i])
    share = []
    for i in ctx.ids:
        per[i]["map_neighbours"] = len(ctx.nb[i])
        per[i]["kept_neighbours"] = len(ctx.nb[i] & hnb[i])
        per[i]["false_neighbours"] = len(hnb[i] - ctx.nb[i])
        if ctx.nb[i]:
            share.append(per[i]["kept_neighbours"] / len(ctx.nb[i]))
            per[i]["kept_share"] = share[-1]
    for k, v in stats(share).items():
        out["kept_share_" + k] = v
    for k, v in stats([per[i]["false_neighbours"] for i in ctx.ids]).items():
        out["false_per_region_" + k] = v

    # 3. direction (Wei et al. 2024): per map-neighbour pair, angle between the centroid
    # direction and the cell direction, both in screen axes
    errs, err_by_region = [], defaultdict(list)
    for a, b in sorted(ctx.map_pairs):
        ca, cb = ctx.center[a], ctx.center[b]
        la, lb = lay["cells"][a]["lat"], lay["cells"][b]["lat"]
        e = angle_between(cb[0] - ca[0], cb[1] - ca[1], lb[0] - la[0], lb[1] - la[1])
        errs.append(e)
        err_by_region[a].append(e); err_by_region[b].append(e)
    for k, v in stats(errs).items():
        out["dir_" + k] = v
    out["dir_over_90"] = sum(e > 90 for e in errs)
    for i in ctx.ids:
        if err_by_region[i]:
            per[i]["direction_error_mean"] = sum(err_by_region[i]) / len(err_by_region[i])

    # 4. multi-scale: Deform-k and OrthoOrder-k (Meulemans 2026)
    for k in KS:
        tag = str(k) if k else "all"
        d_vals, o_vals = [], []
        for i in ctx.ids:
            nbrs = ctx.knn[i] if k == 0 else ctx.knn[i][:k]
            d, o = deform(ctx, lay, i, nbrs), ortho(ctx, lay, i, nbrs)
            per[i]["deform_" + tag], per[i]["ortho_" + tag] = d, o
            d_vals.append(d); o_vals.append(o)
        for k2, v in stats(d_vals).items():
            out["deform_%s_%s" % (tag, k2)] = v
        for k2, v in stats(o_vals).items():
            out["ortho_%s_%s" % (tag, k2)] = v

    # 5. compactness and global shape
    out["hex_pairs"] = len(hp)
    comps, seen = 0, set()
    for i in ctx.ids:
        if i in seen:
            continue
        comps += 1
        stack = [i]; seen.add(i)
        while stack:
            for j in hnb[stack.pop()]:
                if j not in seen:
                    seen.add(j); stack.append(j)
    out["tile_components"] = comps
    perimeter = 6 * ctx.n - 2 * len(hp)                     # hex-layouts/engine.js evaluate()
    min_perimeter = 2 * math.sqrt(math.pi * ctx.n * 3 * SQRT3 / 2)
    out["roughness"] = (perimeter - min_perimeter) / min_perimeter
    iou, outside, dev = shape_scores(ctx, lay, s, placed)
    out["shape_iou"], out["cells_outside_map"] = iou, outside
    for k, v in stats(dev.values()).items():
        out["guide_dev_" + k] = v
    out["cells_fully_outside"] = sum(d >= 0.999 for d in dev.values()) / ctx.n
    for i in ctx.ids:
        per[i]["guide_dev"] = dev[i]

    # 6. state structure (evidence/layout_scores.py)
    split = []
    for st, members in sorted(ctx.by_state.items()):
        seen, stack = {members[0]}, [members[0]]
        while stack:
            for j in hnb[stack.pop()]:
                if ctx.state[j] == st and j not in seen:
                    seen.add(j); stack.append(j)
        if len(seen) < len(members):
            split.append(st)
    touching = {tuple(sorted((ctx.state[a], ctx.state[b]))) for a, b in hp if ctx.state[a] != ctx.state[b]}
    out["states_split"] = len(split)
    out["states_split_list"] = " ".join(split)
    out["state_borders_kept"] = len(ctx.state_borders & touching)
    out["state_contacts_new"] = len(touching - ctx.state_borders)
    return out, per


def shape_scores(ctx, lay, s, placed):
    # Outline shape: the layout's footprint (touching hexes at the location fit) against the map's
    # footprint (union of all region polygons). IoU = shared area / combined area, by scanlines.
    # Also the share of cells whose fitted centre falls outside the map footprint.
    rad = s * lay["step"] / SQRT3
    ph = PHASE[lay["shape"]]
    hexes = [[[(x + rad * math.cos(ph + k * math.pi / 3), y + rad * math.sin(ph + k * math.pi / 3))
               for k in range(6)]] for x, y in placed.values()]
    y_lo = min(ctx.map_box[1], min(y for _, y in placed.values()) - rad)
    y_hi = max(ctx.map_box[3], max(y for _, y in placed.values()) + rad)
    rows = int(math.ceil((y_hi - y_lo) / ROW_H)) + 1
    fmap = Footprint([ctx.rings[i] for i in ctx.ids], y_lo, rows)
    fhex = Footprint(hexes, y_lo, rows)
    inter = union = 0.0
    for row in range(rows):
        y = y_lo + (row + 0.5) * ROW_H
        a, b = fmap.intervals_at(y), fhex.intervals_at(y)
        both = overlap_len(a, b)
        inter += both
        union += sum(q - p for p, q in a) + sum(q - p for p, q in b) - both
    outside = 0
    for x, y in placed.values():
        if not any(p <= x <= q for p, q in fmap.intervals_at(y)):
            outside += 1
    # Guide-Dev, adapted from Meulemans 2026 Section 7: the fraction of each cell's hexagon that
    # the map footprint doesn't cover, with the cell placed by the location fit.
    dev = {}
    for (i, (x, y)), ring in zip(placed.items(), hexes):
        r0 = max(0, math.floor((y - rad - y_lo) / ROW_H))
        r1 = min(rows - 1, math.floor((y + rad - y_lo) / ROW_H))
        cell = covered = 0.0
        for row in range(r0, r1 + 1):
            yy = y_lo + (row + 0.5) * ROW_H
            xs = sorted(x1 + (yy - y1) * (x2 - x1) / (y2 - y1)
                        for (x1, y1), (x2, y2) in zip(ring[0], ring[0][1:] + ring[0][:1])
                        if (y1 <= yy < y2) or (y2 <= yy < y1))
            if len(xs) < 2:
                continue
            span = [[xs[0], xs[-1]]]
            cell += xs[-1] - xs[0]
            covered += overlap_len(span, fmap.intervals_at(yy))
        dev[i] = 1 - covered / cell if cell else 1.0
    return inter / union, outside / ctx.n, dev


# ---------------------------------------------------------------- morph scores
def morph_summary(path):
    by = defaultdict(list)
    with open(path, encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            by[(row["layout"], row["method"])].append(row)
    out = defaultdict(dict)
    for (layout, method), rows in by.items():
        ov = [float(r["overlap_pct"]) for r in rows]
        cr = [int(r["self_crossing_districts"]) for r in rows]
        ar = [float(r["area_change_rate"]) for r in rows]
        peak = max(range(len(ov)), key=lambda k: ov[k])
        m = out[layout]
        m[method + "_overlap_peak"] = ov[peak]
        m[method + "_overlap_peak_t"] = float(rows[peak]["t"])
        m[method + "_overlap_mean"] = sum(ov) / len(ov)
        m[method + "_crossing_peak"] = max(cr)
        m[method + "_area_change_mean"] = sum(ar) / len(ar)
        m[method + "_area_change_peak"] = max(ar)
        m[method + "_frames"] = len(rows)
    return out


# ---------------------------------------------------------------- headline, Pareto, picture
# (column, better, label, format). These are the metrics the Pareto set and the picture use:
# one or two per facet. Everything else is in the CSV.
HEADLINE = [
    ("loc_mean", "min", "Location: mean cell displacement, hex steps", "%.2f"),
    ("pairs_kept", "max", "Adjacency: map neighbour pairs kept", "%d"),
    ("false_pairs", "min", "Adjacency: hex pairs that aren't map neighbours", "%d"),
    ("dir_mean", "min", "Direction: mean angle error, degrees", "%.1f"),
    ("deform_15_mean", "min", "Deform-15 (local), mean", "%.2f"),
    ("deform_all_mean", "min", "Deform-all (global), mean", "%.2f"),
    ("ortho_15_mean", "min", "OrthoOrder-15 (local), mean flips of 30", "%.2f"),
    ("ortho_all_mean", "min", "OrthoOrder-all (global), mean flips", "%.1f"),
    ("roughness", "min", "Compactness: roughness", "%.2f"),
    ("shape_iou", "max", "Shape: footprint IoU with the map", "%.3f"),
    ("states_split", "min", "States split", "%d"),
    ("state_borders_kept", "max", "State borders kept", "%d"),
    ("linear_overlap_peak", "min", "Morph: Linear overlap peak, %", "%.1f"),
    ("forsch_overlap_peak", "min", "Morph: Forsch hybrid overlap peak, %", "%.1f"),
]
SHORT = {"loc_mean": "Location", "pairs_kept": "Pairs kept", "false_pairs": "False pairs",
         "dir_mean": "Direction", "deform_15_mean": "Deform-15", "deform_all_mean": "Deform-all",
         "ortho_15_mean": "Ortho-15", "ortho_all_mean": "Ortho-all", "roughness": "Roughness",
         "shape_iou": "Shape IoU", "states_split": "States split", "state_borders_kept": "Borders kept",
         "linear_overlap_peak": "Overlap, Linear", "forsch_overlap_peak": "Overlap, Forsch"}


def better(a, b, sense):
    return a < b if sense == "min" else a > b


def wins(a, b, head):
    return sum(better(a[c], b[c], d) for c, d, _, _ in head)


def pareto(rows, cols):
    front, beaten_by = [], {}
    for r in rows:
        doms = []
        for o in rows:
            if o is r:
                continue
            if all(not better(r[c], o[c], d) for c, d in cols) and any(better(o[c], r[c], d) for c, d in cols):
                doms.append(o["layout"])
        beaten_by[r["layout"]] = doms
        if not doms:
            front.append(r["layout"])
    return front, beaten_by


def scorecard_svg(rows, cols, front, path, base=None):
    # Heatmap table: one row per layout, one column per headline metric. Shade is the layout's
    # place between the worst (light) and best (dark) value in that column; the number is printed.
    ramp = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7",
            "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95"]
    cw, rh, lw, top = 74, 30, 236, 136
    W, H = lw + cw * len(cols) + 90, top + rh * len(rows) + 92
    all_front = len(front) == len(rows)
    esc = lambda t: str(t).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    pareto_note = (" All %d layouts are Pareto-optimal on these %d columns: none is beaten on every one." % (len(rows), len(cols))
                   if all_front else " ★ = Pareto-optimal on all %d columns." % len(cols))
    o = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d" '
         'font-family="Helvetica, Arial, sans-serif">' % (W, H, W, H),
         '<rect width="100%%" height="100%%" fill="#fcfcfb"/>',
         '<text x="16" y="28" font-size="17" font-weight="700" fill="#0b0b0b">Hex layouts scored on every published facet</text>',
         '<text x="16" y="48" font-size="12" fill="#52514e">Darker = better within each column (best to worst among these %d layouts). '
         'Numbers are the scores.%s</text>' % (len(rows), pareto_note)]
    if base is not None:
        others = [wins(r, base, cols) for r in rows if r is not base]
        o.append('<text x="16" y="66" font-size="12" fill="#52514e">Against %s, every other layout is better on %d to %d of the %d columns.</text>'
                 % (esc(base["layout"]), min(others), max(others), len(cols)))
    for k, (c, sense, label, _fmt) in enumerate(cols):
        x = lw + k * cw + cw / 2
        o.append('<text transform="translate(%.1f,%d) rotate(-35)" font-size="11.5" fill="#0b0b0b">%s</text>'
                 % (x - 4, top - 10, esc(SHORT[c])))
        o.append('<text x="%.1f" y="%d" font-size="10" fill="#898781" text-anchor="middle">%s</text>'
                 % (x, top + rh * len(rows) + 16, "lower" if sense == "min" else "higher"))
    o.append('<text x="%d" y="%d" font-size="10" fill="#898781" text-anchor="end">better is</text>'
             % (lw - 8, top + rh * len(rows) + 16))
    for r_i, r in enumerate(rows):
        y = top + r_i * rh
        star = "\u2605 " if r["layout"] in front and not all_front else ""
        o.append('<text x="%d" y="%.1f" font-size="12" fill="#0b0b0b" text-anchor="end">%s%s</text>'
                 % (lw - 8, y + rh / 2 + 4, star, esc(r["layout"])))
        for k, (c, sense, label, fmt) in enumerate(cols):
            vals = [q[c] for q in rows]
            lo, hi = min(vals), max(vals)
            g = 0.5 if hi == lo else ((r[c] - lo) / (hi - lo) if sense == "max" else (hi - r[c]) / (hi - lo))
            step = int(round(g * (len(ramp) - 1)))
            fill = ramp[step]
            ink = "#ffffff" if step >= 7 else "#0b0b0b"
            x = lw + k * cw
            o.append('<g><title>%s: %s = %s</title><rect x="%.1f" y="%.1f" width="%d" height="%d" rx="3" fill="%s"/>'
                     '<text x="%.1f" y="%.1f" font-size="11.5" fill="%s" text-anchor="middle">%s</text></g>'
                     % (esc(r["layout"]), esc(label), fmt % r[c], x + 1, y + 1, cw - 2, rh - 2, fill,
                        x + cw / 2, y + rh / 2 + 4, ink, fmt % r[c]))
    note_y = top + rh * len(rows) + 42
    o.append('<text x="16" y="%d" font-size="11" fill="#52514e">Units: location in hex steps; direction in degrees; Deform in hex steps²; '
             'Ortho in flipped relations; overlap in %% of covered area at the worst frame.</text>' % note_y)
    o.append('<text x="16" y="%d" font-size="11" fill="#52514e">Geometric scores are not reader performance: Schiewe 2021 found they '
             'did not match users’ judgements. Made by evidence/evaluate_layouts.py.</text>' % (note_y + 18))
    o.append("</svg>")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(o) + "\n")


# ---------------------------------------------------------------- reproduction checks
def checks(args, ctx, results):
    lines = []
    js_path = os.path.join(ROOT, "hexmap_data.js")
    if os.path.exists(js_path) and ctx.n == 436:
        js = open(js_path, encoding="utf-8").read()
        data = json.loads(js[js.index("{"):js.rstrip().rstrip(";").rindex("}") + 1])
        props = {f["properties"]["geo_fips"]: f["properties"] for f in data["features"]}
        mp = {tuple(sorted((a, b))) for a, p in props.items() for b in p["map_neighbors"]}
        hp = {tuple(sorted((a, b))) for a, p in props.items() for b in p["hex_neighbors"]}
        st_ok = all(props[i]["state_abbr"] == ctx.state[i] for i in ctx.ids)
        lines.append("hexmap_data.js map_neighbors match the regions file: %s (%d pairs)" % (mp == ctx.map_pairs, len(mp)))
        lines.append("hexmap_data.js state_abbr match the regions file: %s" % st_ok)
        if "NYU" in results:
            nyu_hp = hex_pairs(results["NYU"]["_layout"])
            lines.append("NYU hex pairs match hexmap_data.js hex_neighbors: %s (%d pairs)" % (nyu_hp == hp, len(hp)))
    ref = os.path.join(HERE, "layout_scores_output.txt")
    if os.path.exists(ref):
        expected = {}
        for line in open(ref, encoding="utf-8"):
            # rows look like "<layout> <pairs kept> <hex pairs> <states split> <borders> / 107 [states]"
            parts = line.split()
            if "/" not in parts:
                continue
            k = parts.index("/")
            if k >= 5 and all(p.isdigit() for p in parts[k - 4:k]):
                expected[parts[0]] = tuple(int(p) for p in parts[k - 4:k])
        ok_all, compared = True, 0
        for name, (kept, hexp, split, borders) in expected.items():
            if name not in results or ctx.n != 436:
                continue
            compared += 1
            r = results[name]
            got = (r["pairs_kept"], r["hex_pairs"], r["states_split"], r["state_borders_kept"])
            ok = got == (kept, hexp, split, borders)
            ok_all &= ok
            lines.append("layout_scores_output.txt %-28s pairs kept %d, hex pairs %d, states split %d, borders kept %d: %s"
                         % (name, kept, hexp, split, borders, "match" if ok else "MISMATCH, got %s" % (got,)))
        if compared:
            lines.append("all reference rows reproduced: %s" % ok_all)
    if not lines:
        lines.append("no reference numbers for these regions and layouts, so nothing to recompute")
    return lines


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("layouts", nargs="*", default=[os.path.join(HERE, "friday_layouts.json")])
    ap.add_argument("--regions", default=os.path.join(ROOT, "hex-layouts", "data.json"))
    ap.add_argument("--morph", default=os.path.join(HERE, "morph_scores.csv"))
    ap.add_argument("--no-baseline", action="store_true", help="don't score the regions file's nyuTarget")
    ap.add_argument("--group", help="score only this group of the regions file, e.g. mainland")
    ap.add_argument("--out", default=HERE)
    args = ap.parse_args()

    data, regions, nb = load_regions(args.regions, args.group)
    ctx = Context(regions, nb)
    layouts = []
    if not args.no_baseline and data.get("nyuTarget"):
        layouts.append(layout_from(data["nyuTarget"], ctx.ids, "NYU"))
    for path in args.layouts:
        payload = json.load(open(path, encoding="utf-8"))
        if payload.get("format") != "hex-layout-lab-v2":
            sys.exit(path + " is not a hex-layout-lab-v2 export")
        for cand in payload["candidates"]:
            layouts.append(layout_from(cand, ctx.ids, cand["id"]))

    morph = morph_summary(args.morph) if args.morph and os.path.exists(args.morph) else {}
    results, rows, per_rows = {}, [], []
    for lay in layouts:
        out, per = evaluate(ctx, lay)
        out.update(morph.get(lay["name"], {}))
        row = {"layout": lay["name"], **out}
        results[lay["name"]] = dict(row, _layout=lay)
        rows.append(row)
        for i in ctx.ids:
            per_rows.append({"layout": lay["name"], "region": i, "state": ctx.state[i], **per[i]})
        print("scored %s" % lay["name"], file=sys.stderr)

    cols = [c for c in rows[0] if c != "layout"]
    with open(os.path.join(args.out, "layout_metrics.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["layout"] + cols)
        for r in rows:
            w.writerow([r["layout"]] + [("%.6g" % r[c]) if isinstance(r.get(c), float) else r.get(c, "") for c in cols])
    pcols = []
    for r in per_rows:
        for c in r:
            if c not in pcols:
                pcols.append(c)
    with open(os.path.join(args.out, "layout_metrics_per_region.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(pcols)
        for r in per_rows:
            w.writerow([("%.6g" % r[c]) if isinstance(r.get(c), float) else r.get(c, "") for c in pcols])

    head = [h for h in HEADLINE if all(h[0] in r for r in rows)]
    front, beaten_by = pareto(rows, [(c, d) for c, d, _, _ in head])
    best = {r["layout"]: [SHORT[c] for c, d, _, _ in head
                          if r[c] == (min if d == "min" else max)(q[c] for q in rows)] for r in rows}
    scorecard_svg(rows, head, front, os.path.join(args.out, "layout_scorecard.svg"),
                  base=next((r for r in rows if r["layout"] == "NYU"), None))
    check_lines = checks(args, ctx, results)

    # ------------------------------------------------ printed report
    P = []
    P.append("regions %d, map neighbour pairs %d (%d across state lines), state borders %d, layouts %d"
             % (ctx.n, len(ctx.map_pairs), len(ctx.cross_pairs), len(ctx.state_borders), len(rows)))
    P.append("")
    P.append("Checks")
    P.extend("  " + l for l in check_lines)
    P.append("")
    P.append("Headline metrics")
    w0 = max(len(r["layout"]) for r in rows) + 2
    P.append(" " * w0 + "".join("%15s" % SHORT[c] for c, _, _, _ in head))
    for r in rows:
        P.append(r["layout"].ljust(w0) + "".join("%15s" % (f % r[c]) for c, _, _, f in head))
    P.append("")
    P.append("Distributions over regions (mean / median / p90 / max)")
    dist_cols = [("loc", "Location, hex steps", "%.2f"), ("kept_share", "Share of own neighbours kept", "%.2f"),
                 ("false_per_region", "False neighbours per region", "%.2f"), ("dir", "Direction error per pair, deg", "%.1f"),
                 ("guide_dev", "Guide-Dev (share of cell outside the map)", "%.3f")]
    dist_cols += [("deform_%s" % (k or "all"), "Deform-%s" % (k or "all"), "%.3f") for k in KS]
    dist_cols += [("ortho_%s" % (k or "all"), "OrthoOrder-%s" % (k or "all"), "%.2f") for k in KS]
    for key, label, f in dist_cols:
        P.append("  " + label)
        for r in rows:
            P.append("    %s %s" % (r["layout"].ljust(w0), " / ".join(f % r["%s_%s" % (key, s)] for s in ("mean", "median", "p90", "max"))))
    P.append("")
    P.append("Other per-layout numbers")
    for r in rows:
        P.append("  %s location RMS %.2f (worst %s), pairs lost %d, omission %.3f, commission %.3f, isolated tiles %d, "
                 "pairs over 90 deg %d, tile components %d, cells outside map %.3f, cells fully outside %.3f, states split [%s], new state contacts %d"
                 % (r["layout"].ljust(w0), r["loc_rms"], r["loc_worst"], r["pairs_lost"], r["omission_rate"], r["commission_rate"],
                    r["isolated_tiles"], r["dir_over_90"], r["tile_components"], r["cells_outside_map"], r["cells_fully_outside"],
                    r["states_split_list"], r["state_contacts_new"]))
    if morph:
        P.append("")
        P.append("Morph (from %s): overlap peak at t, overlap mean, self-crossing peak, area change mean / peak"
                 % os.path.relpath(args.morph, ROOT))
        for r in rows:
            for m in ("linear", "forsch"):
                if m + "_overlap_peak" in r:
                    P.append("  %s %-7s %5.1f%% at t=%.2f, mean %5.1f%%, crossings %3d, area %.3f / %.3f"
                             % (r["layout"].ljust(w0), m, r[m + "_overlap_peak"], r[m + "_overlap_peak_t"],
                                r[m + "_overlap_mean"], r[m + "_crossing_peak"], r[m + "_area_change_mean"],
                                r[m + "_area_change_peak"]))
    P.append("")
    P.append("Pareto-optimal on the %d headline metrics: %s" % (len(head), ", ".join(front)))
    for r in rows:
        if beaten_by[r["layout"]]:
            P.append("  %s is beaten on every headline metric by: %s" % (r["layout"], ", ".join(beaten_by[r["layout"]])))
    P.append("Best (or tied best) per layout:")
    for r in rows:
        P.append("  %s %d of %d: %s" % (r["layout"].ljust(w0), len(best[r["layout"]]), len(head), ", ".join(best[r["layout"]]) or "-"))
    P.append("")
    P.append("Head to head: row layout better than column layout on how many of the %d headline metrics (ties count for neither)" % len(head))
    names = [r["layout"] for r in rows]
    P.append(" " * w0 + "".join("%6d" % (k + 1) for k in range(len(rows))))
    for k, r in enumerate(rows):
        P.append(("%d %s" % (k + 1, r["layout"])).ljust(w0) + "".join(
            "%6s" % ("-" if o is r else wins(r, o, head)) for o in rows))
    report = "\n".join(P)
    print(report)

    # ------------------------------------------------ markdown summary
    M = ["# Hex layout evaluation", "",
         "Generated by `python evidence/evaluate_layouts.py` from `%s` with regions from `%s`%s. "
         "Every number here comes from that run; `layout_metrics.csv` has all of them, and "
         "`layout_metrics_per_region.csv` has the per-region values behind the distributions."
         % (", ".join(os.path.relpath(p, ROOT) for p in args.layouts), os.path.relpath(args.regions, ROOT),
            " and morph scores from `%s`" % os.path.relpath(args.morph, ROOT) if morph else ""), "",
         "## Headline table", "",
         "| Layout | " + " | ".join(SHORT[c] for c, _, _, _ in head) + " |",
         "|---|" + "---:|" * len(head),
         "| better is | " + " | ".join("lower" if d == "min" else "higher" for _, d, _, _ in head) + " |"]
    for r in rows:
        M.append("| %s%s | " % ("★ " if r["layout"] in front else "", r["layout"])
                 + " | ".join(f % r[c] for c, _, _, f in head) + " |")
    caption = {
        "loc_mean": "**Location**: average distance from a district's hex to where the district is on the map, after "
                    "the best overall scale and shift, in hex steps.",
        "pairs_kept": "**Pairs kept**: districts that share a border on the map and are still hex neighbours (of {:,} pairs).".format(len(ctx.map_pairs)),
        "false_pairs": "**False pairs**: hex neighbours that don't share a border on the map.",
        "dir_mean": "**Direction**: average angle, in degrees, between the direction from one neighbour to the other on "
                    "the map and in the hex layout; 0 means every neighbour is on the right side.",
        "deform_15_mean": "**Deform-15**: for each district and its 15 nearest districts on the map, how far their hex "
                          "positions are from a scaled copy of the map, averaged over districts (hex steps squared). "
                          "Measures local distortion.",
        "deform_all_mean": "**Deform-all**: the same over all other districts. Measures distortion of the whole country.",
        "ortho_15_mean": "**Ortho-15**: for each district, how many of its 15 nearest districts swap sides, left for "
                         "right or above for below, between the map and the hex layout (0 to 30), averaged over districts.",
        "ortho_all_mean": "**Ortho-all**: the same over all other districts (0 to %d)." % (2 * (ctx.n - 1)),
        "roughness": "**Roughness**: how much longer the tile map's outline is than a circle of the same area; 0 is a "
                     "perfect circle.",
        "shape_iou": "**Shape IoU**: how much the tile map's footprint and the map's footprint overlap, as shared area "
                     "over combined area; 1 means they cover the same ground.",
        "states_split": "**States split**: states whose hexes don't form one connected piece.",
        "state_borders_kept": "**Borders kept**: pairs of states that share a border on the map and still touch in "
                              "the hex layout (of %d)." % len(ctx.state_borders),
        "linear_overlap_peak": "**Overlap, Linear** and **Overlap, Forsch**: the largest share of the drawn area where "
                               "districts overlap at any frame of the morph from the map to the hex layout, with the "
                               "linear morph and with the Forsch hybrid, in percent.",
    }
    M += ["", "*Table 1. One row per layout, one column per metric; the row \"better is\" says which direction "
          "is better. " + " ".join(caption[c] for c, _, _, _ in head if c in caption)
          + " Full definitions are under \"How each metric is computed\".*"]
    M += ["", "★ marks the Pareto-optimal layouts: no other layout is at least as good on every headline metric "
          "and strictly better on one. %d of %d layouts are Pareto-optimal: %s."
          % (len(front), len(rows), ", ".join(front)), ""]
    dominated = [r["layout"] for r in rows if beaten_by[r["layout"]]]
    for name in dominated:
        M.append("- %s is dominated by %s." % (name, ", ".join(beaten_by[name])))
    M += ["", "Head to head: how many of the %d headline metrics the row layout is strictly better on than the column "
          "layout (ties count for neither, so a pair needn't add up to %d)." % (len(head), len(head)), "",
          "| | " + " | ".join(str(k + 1) for k in range(len(rows))) + " |", "|---|" + "---:|" * len(rows)]
    for k, r in enumerate(rows):
        M.append("| %d %s | " % (k + 1, r["layout"]) + " | ".join("-" if o is r else str(wins(r, o, head)) for o in rows) + " |")
    M += ["", "Best or tied best, by layout:", ""]
    for r in rows:
        M.append("- %s: %d of %d (%s)" % (r["layout"], len(best[r["layout"]]), len(head), ", ".join(best[r["layout"]]) or "none"))
    M += ["", "## Distributions over regions", "",
          "Mean / median / 90th percentile / max. Direction is per map-neighbour pair, the rest per region.", "",
          "| Metric | " + " | ".join(r["layout"] for r in rows) + " |", "|---|" + "---|" * len(rows)]
    for key, label, f in dist_cols:
        M.append("| %s | " % label + " | ".join(" / ".join(f % r["%s_%s" % (key, s)] for s in ("mean", "median", "p90", "max"))
                                               for r in rows) + " |")
    M += ["", "## Checks", "", "Before trusting the new metrics, the script recomputes the old ones:", ""]
    M += ["- " + l for l in check_lines]
    M += ["", "## How each metric is computed", "",
          "Positions: region centroids are `center` in the regions file (d3 `geoPath.centroid` of the projected "
          "district, screen units, y down). Cells are placed on the unit hex lattice of their orientation from (q, r), "
          "so cell vectors are in hex steps (centre-to-centre distance of neighbouring hexes = 1).", "",
          "- **Location** (McNeill & Hale 2017): least-squares fit of one uniform scale s and a translation t so "
          "that s·cell + t best matches the centroids over all regions. Displacement of a region = "
          "|s·cell + t − centroid| / (s·step), in hex steps.",
          "- **Adjacency** (Schiewe 2021): map neighbours share a stretch of border (`neighbors`). Pairs kept = map "
          "pairs whose cells are hex neighbours. Omission = pairs lost / map pairs. Commission = hex pairs that aren't "
          "map pairs (\"false pairs\") / hex pairs. Isolated tiles = cells with no hex neighbour. Per region: share of "
          "its own map neighbours kept, and its number of false hex neighbours.",
          "- **Direction** (Wei et al. 2024): for each map-neighbour pair (a, b), the angle between centroid_b − "
          "centroid_a and cell_b − cell_a, 0 to 180 degrees. Over 90 means b is on the wrong side of a.",
          "- **Deform-k** (Meulemans 2026, Section 7; implemented as in GridMapPipeline "
          "`analyze/analyzers/Deformation.java`): for region i take its k nearest regions by centroid distance on "
          "the map (all other regions for k = all; ties broken by id). With d_j = centroid_j − centroid_i and "
          "r_j = cell_j − cell_i (hex steps), Deform-k(i) = min over scalar σ of (1/k) Σ_j |σ d_j − "
          "r_j|², solved in closed form (σ = Σ d·r / Σ|d|²). Units are hex steps squared; 0 "
          "means the neighbourhood is a scaled copy of the map. Only scale is fitted, no rotation or translation, as "
          "in their code and as the paper says (\"uniform scaling is not considered distortion\"). Two small "
          "differences from the paper's wording, both following the code: the paper says \"sum of squares\", the "
          "code (and this script) divides by k, which only rescales each k by a constant; and the paper cites Horn "
          "1987 for the optimal scale, but with only scale to fit the closed form above is the same answer.",
          "- **OrthoOrder-k** (Meulemans 2026; `analyze/analyzers/OrthogonalOrder.java`): same neighbourhood. For "
          "each neighbour j, +1 if j is left of i on the map but right of i in the grid (or the reverse), and +1 if "
          "j is above i on one but below on the other. A tie on either side (same x, or same y, which is common in a "
          "hex grid) never counts (the paper doesn't say how ties are handled; this is the code's rule). Range 0 to 2k, "
          "or 2(n \u2212 1) for k = all, as in the paper. k = 5, 15, 50, 100 and all are the paper's own values.",
          "- **Compactness**: hex pairs = pairs of adjacent cells. Roughness (Paul, `hex-layouts/engine.js` "
          "`evaluate()`) = (P − P_min) / P_min, where P = 6n − 2·(hex pairs) is the footprint's "
          "perimeter in hex sides and P_min is the perimeter of a circle with the same area. Tile components = "
          "connected groups of cells.",
          "- **Shape**: the layout's footprint (touching hexes placed by the location fit) against the map's "
          "footprint (union of all district polygons). IoU = shared area / combined area, by scanlines %.2f units "
          "apart; 1 means the tile map covers the same ground as the map. Guide-Dev (adapted from Meulemans 2026): "
          "for each cell, the fraction of its hexagon that the map footprint doesn't cover; the paper does this per "
          "part against the scaled and translated outline of that part, and here the whole map is the outline and "
          "the location fit is the scaling and translation, so it works for any generator. Cells fully outside = "
          "share of cells with Guide-Dev 100%%. Cells outside map = share of fitted cell centres outside the map "
          "footprint. The paper's Guide-Miss isn't computed: it flags cells against the pipeline's own guiding "
          "shape, which other generators don't have." % ROW_H,
          "- **State structure** (`evidence/layout_scores.py`): a state is split if its cells don't form one "
          "connected group; a state border is kept if two states that share a border on the map still have touching "
          "cells.",
          "- **Morph**: the morph page's own 101 frames per method (`node evidence/morph_scores.cjs`, the same numbers "
          "as its CSV download). Overlap peak and mean over frames, peak self-crossing districts, mean and peak area "
          "change. For the linear morph, self-crossings and area change depend only on the drawn hex size, not on "
          "which district sits where, so only overlap is in the headline set.",
          "",
          "Headline set: the %d metrics in the table, one or two per facet. Distributions use linear interpolation "
          "between ranks for the median and 90th percentile." % len(head), "",
          "## Caveats", "",
          "- Geometric scores are not proof that a layout is better for readers. Schiewe 2021 ran two surveys with 222 "
          "participants each and found the geometric measures showed unclear trends and didn't match what users "
          "expected; minimising centroid distance didn't match their choices. Claiming \"better for readers\" needs a "
          "small task-based study."]
    names = [r["layout"] for r in rows]
    if any(n.startswith(("gen-", "fixed-")) for n in names):
        M += ["- Paul's generated layouts (`gen-*`) are drawn with touching hexes; NYU, his NYU-grid layouts (`fixed-*`) and "
          "ours use the dashboard's 11.5/12 size. That changes overlap but no other metric here.",
          "- The four `gen-*` and `fixed-*` layouts were picked from his generator as the two per mode that kept the "
          "most neighbour pairs, so they are not a random sample of what it makes."]
    if args.group:
        M += ["- Scored on the `%s` group of the regions file only (%d regions); neighbour pairs to regions outside it "
              "don't count." % (args.group, ctx.n)]
    with open(os.path.join(args.out, "layout_metrics_summary.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(M) + "\n")


if __name__ == "__main__":
    main()
