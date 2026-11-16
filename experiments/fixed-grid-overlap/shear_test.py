#!/usr/bin/env python3
# Neighbour-shear test: is Linear morph overlap made by map neighbours sliding past each other?
#
#   python experiments/fixed-grid-overlap/shear_test.py
#
# Needs pairs/<set>_pairs.csv and pairs/<set>_frames.csv from pair_overlap.cjs for candidates and
# candidates_extended (and, optionally, pairs/friday_* for the NYU layout).
#
# For a pair of map neighbours A, B, in hex steps: m = centroid_B - centroid_A on the map and
# h = cell_B - cell_A in the layout. Their relative motion during the morph is v = h - m.
#   direction error  angle between m and h, degrees (as in evaluate_layouts.py)
#   sliding          the part of v across the line A-B: |h| sin(angle). Sliding along the shared
#                    border is the hypothesised cause of overlap.
#   approach         the part of v along A-B, sign flipped: |m| - |h| cos(angle); positive when the
#                    two centres end closer together than they start
#   size             sqrt(area_A * area_B) on the map, a control: large districts can overlap more
# Fixed in advance:
#   pair-level test   inside each candidate, over its 1,136 neighbour pairs, the Spearman partial
#                     correlation of pair overlap with sliding, approach and size held fixed
#   layout-level test inside each Noise level, the partial correlation of overlap with direction
#                     error when mean sliding is held fixed, and the reverse
# Writes results/shear_pairs.csv, results/shear_layouts.csv and results/shear_test.html.
import csv, html, importlib.util, json, math, os, statistics, sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
spec = importlib.util.spec_from_file_location("analyze", os.path.join(HERE, "analyze.py"))
A = importlib.util.module_from_spec(spec)
spec.loader.exec_module(A)
OUT, PAIRS = A.OUT, os.path.join(HERE, "pairs")


# ---------------------------------------------------------------- statistics
def solve(M, b):
    n = len(b)
    M = [row[:] + [b[i]] for i, row in enumerate(M)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(M[r][c]))
        M[c], M[p] = M[p], M[c]
        if abs(M[c][c]) < 1e-12:
            return None
        for r in range(n):
            if r != c:
                f = M[r][c] / M[c][c]
                M[r] = [x - f * y for x, y in zip(M[r], M[c])]
    return [M[i][n] / M[i][i] for i in range(n)]


def residuals(y, controls):
    X = [[1.0] + [c[i] for c in controls] for i in range(len(y))]
    k = len(X[0])
    XtX = [[sum(X[i][a] * X[i][b] for i in range(len(y))) for b in range(k)] for a in range(k)]
    Xty = [sum(X[i][a] * y[i] for i in range(len(y))) for a in range(k)]
    beta = solve(XtX, Xty)
    if beta is None:
        return None
    return [y[i] - sum(beta[a] * X[i][a] for a in range(k)) for i in range(len(y))]


def partial(x, y, controls):
    # Spearman partial correlation: Pearson of rank residuals after regressing on the ranked controls
    rc = [A.ranks(c) for c in controls]
    ex, ey = residuals(A.ranks(x), rc), residuals(A.ranks(y), rc)
    return None if ex is None or ey is None else A.pearson(ex, ey)


def summary(values):
    v = sorted(x for x in values if x is not None)
    return {"median": statistics.median(v), "min": v[0], "max": v[-1], "positive": sum(x > 0 for x in v), "n": len(v)}


# ---------------------------------------------------------------- data
def ring_area(ring):
    return abs(sum(ring[i][0] * ring[i - 1][1] - ring[i - 1][0] * ring[i][1] for i in range(len(ring)))) / 2


def load_pairs(prefix):
    out = {}
    path = os.path.join(PAIRS, prefix + "_pairs.csv")
    if not os.path.exists(path):
        return out
    with open(path, encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            out.setdefault(r["layout"], {})[tuple(sorted((r["a"], r["b"])))] = float(r["overlap_area_frames"])
    return out


def load_frames(prefix):
    path = os.path.join(PAIRS, prefix + "_frames.csv")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as fh:
        return [(r["layout"], float(r["overlap_pct"]), float(r["page_overlap_pct"])) for r in csv.DictReader(fh)]


def angle(ax, ay, bx, by):
    d = abs(math.atan2(ay, ax) - math.atan2(by, bx)) % (2 * math.pi)
    return min(d, 2 * math.pi - d)


def main():
    data = json.load(open(os.path.join(ROOT, "hex-layouts", "data.json"), encoding="utf-8"))
    step = data["nyuTarget"]["step"]
    center = {r["id"]: r["center"] for r in data["regions"]}
    area = {r["id"]: sum(ring_area(g) for g in r["rings"]) for r in data["regions"]}
    nb_pairs = sorted({tuple(sorted((r["id"], n))) for r in data["regions"] for n in r["neighbors"] if n in center})

    layouts = [("NYU", "baseline", None, {c["originalId"]: (c["x"], c["y"]) for c in data["nyuTarget"]["cells"]})]
    for fname, tag, keep in (("candidates.json", "discovery", lambda p: p["seed"] == 42),
                             ("candidates_extended.json", "replication", lambda p: p["seed"] != 42)):
        for c in json.load(open(os.path.join(HERE, fname), encoding="utf-8"))["candidates"]:
            if keep(c["parameters"]):
                layouts.append((c["id"], tag, c["parameters"], {x["id"]: (x["x"], x["y"]) for x in c["cells"]}))
    pairs = {}
    for prefix in ("friday", "candidates", "candidates_extended"):
        pairs.update(load_pairs(prefix))
    frames = load_frames("candidates") + load_frames("candidates_extended")
    over = {}
    for d in ("candidates-metrics", "candidates_extended-metrics"):
        with open(os.path.join(HERE, d, "layout_metrics.csv"), encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                over[r["layout"]] = r

    pair_rows, lay_rows = [], []
    for name, tag, params, cell in layouts:
        if name not in pairs:
            continue
        po = pairs[name]
        th, sl, ap, sz, ov = [], [], [], [], []
        for a, b in nb_pairs:
            mx, my = (center[b][0] - center[a][0]) / step, (center[b][1] - center[a][1]) / step
            hx, hy = (cell[b][0] - cell[a][0]) / step, (cell[b][1] - cell[a][1]) / step
            t = angle(mx, my, hx, hy)
            lm, lh = math.hypot(mx, my), math.hypot(hx, hy)
            th.append(math.degrees(t)); sl.append(lh * math.sin(t)); ap.append(lm - lh * math.cos(t))
            sz.append(math.sqrt(area[a] * area[b])); ov.append(po.get((a, b), 0.0))
        rec = {"layout": name, "set": tag, "noise": params["noise"] if params else ""}
        rec["rho_sliding"] = A.spearman(sl, ov)
        rec["rho_direction"] = A.spearman(th, ov)
        rec["rho_approach"] = A.spearman(ap, ov)
        rec["rho_size"] = A.spearman(sz, ov)
        rec["partial_sliding"] = partial(sl, ov, [ap, sz])          # the pair-level test
        rec["partial_direction"] = partial(th, ov, [ap, sz])
        rec["partial_approach"] = partial(ap, ov, [sl, sz])
        total = sum(po.values())
        nbset = set(nb_pairs)
        rec["share_map_neighbours"] = sum(v for k, v in po.items() if k in nbset) / total if total else 0
        top = sorted(po.values(), reverse=True)
        rec["share_top_10pct_pairs"] = sum(top[:max(1, len(top) // 10)]) / total if total else 0
        rec["pairs_with_overlap"] = len(po)
        pair_rows.append(rec)
        if params:
            o = over[name]
            lay_rows.append({"layout": name, "set": tag, "noise": params["noise"], "transform": params["transform"],
                             "seed": params["seed"], "mean_sliding": statistics.fmean(sl),
                             "mean_approach": statistics.fmean(ap), "dir_mean": float(o["dir_mean"]),
                             "pair_overlap_total": total,
                             "linear_overlap_peak": float(o["linear_overlap_peak"]),
                             "linear_overlap_mean": float(o["linear_overlap_mean"])})

    os.makedirs(OUT, exist_ok=True)
    f = lambda v: ("%.6g" % v) if isinstance(v, float) else v
    with open(os.path.join(OUT, "shear_pairs.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh); cols = list(pair_rows[0]); w.writerow(cols)
        for r in pair_rows:
            w.writerow([f(r[c]) for c in cols])
    with open(os.path.join(OUT, "shear_layouts.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh); cols = list(lay_rows[0]); w.writerow(cols)
        for r in lay_rows:
            w.writerow([f(r[c]) for c in cols])

    # ---- layout level
    disc = [r for r in lay_rows if r["set"] == "discovery"]
    repl = [r for r in lay_rows if r["set"] == "replication"]
    strata = [[r for r in lay_rows if r["noise"] == nz] for nz in sorted({r["noise"] for r in lay_rows if r["noise"] > 0})]
    lay = {}
    for tcol in ("linear_overlap_peak", "linear_overlap_mean"):
        for pcol in ("mean_sliding", "mean_approach", "dir_mean", "pair_overlap_total"):
            within = [A.spearman([r[pcol] for r in s], [r[tcol] for r in s]) for s in strata]
            lay[(tcol, pcol)] = (A.spearman([r[pcol] for r in disc], [r[tcol] for r in disc]),
                                 A.spearman([r[pcol] for r in repl], [r[tcol] for r in repl]),
                                 statistics.fmean(v for v in within if v is not None))
        for x, z in (("dir_mean", "mean_sliding"), ("mean_sliding", "dir_mean")):
            pooled = partial([r[x] for r in lay_rows], [r[tcol] for r in lay_rows], [[r[z] for r in lay_rows]])
            within = [partial([r[x] for r in s], [r[tcol] for r in s], [[r[z] for r in s]]) for s in strata]
            lay[(tcol, x + "|" + z)] = (pooled, statistics.fmean(v for v in within if v is not None))

    # ---- page
    cand = [r for r in pair_rows if r["set"] != "baseline"]
    nyu = next((r for r in pair_rows if r["layout"] == "NYU"), None)
    diffs = [abs(a - b) for _, a, b in frames]
    peaks = {}
    for name, a, b in frames:
        pa, pb = peaks.get(name, (0, 0))
        peaks[name] = (max(pa, a), max(pb, b))
    peak_diff = [a - b for a, b in peaks.values()]
    E, show = html.escape, (lambda v: "&ndash;" if v is None else "%.2f" % v)
    P = ['<!doctype html><html lang="en"><head><meta charset="utf-8">'
         '<meta name="viewport" content="width=device-width, initial-scale=1">'
         '<title>Neighbour Shear Test</title><style>%s</style></head><body><div class="viz-root">' % A.STYLE]
    P.append("<h1>Neighbour-shear test</h1><p class=\"muted\">Generated by experiments/fixed-grid-overlap/shear_test.py from "
             "pair-level overlap measured by pair_overlap.cjs on the same %d candidates as report.html. Linear morph only.</p>"
             % len(cand))
    P.append("<h2>Hypothesis</h2><p>Direction error goes with overlap, but crossing paths do not explain it "
             "(path_crossings.html). Proposed instead: two map neighbours share a border; if their relative position "
             "rotates in the layout, the shared border slides, and part-way through the morph one district pushes into the "
             "other. If so, overlap should come mostly from map-neighbour pairs, and inside a layout the pairs that slide "
             "more should overlap more, with size and approach held fixed.</p>")
    P.append("<h2>Measuring overlap per pair</h2><p>pair_overlap.cjs reads each district's Linear outline from the morph "
             "page (the same vertex arrays the page interpolates), fills every outline on a 1,200-pixel-wide grid at 51 "
             "moments, and adds up the pixels each pair shares. Check against the page's own Linear overlap at the same "
             "moments, over %d frames: mean absolute difference %.2f points, largest %.2f points; peak difference "
             "%.2f to %.2f points (ours slightly higher).</p>" % (len(frames), statistics.fmean(diffs), max(diffs),
                                                                  min(peak_diff), max(peak_diff)))
    P.append("<h2>Where does overlap come from?</h2><table><tr><th>Measure</th><th>NYU</th><th>Candidates median</th>"
             "<th>min</th><th>max</th></tr>")
    for col, lab, pct in (("share_map_neighbours", "Share of overlap from map-neighbour pairs", True),
                          ("share_top_10pct_pairs", "Share from the top 10% of overlapping pairs", True),
                          ("pairs_with_overlap", "Pairs that overlap at some moment", False)):
        s = summary([r[col] for r in cand])
        fm = (lambda v: "%.0f%%" % (100 * v)) if pct else (lambda v: "%d" % v)
        P.append("<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>"
                 % (E(lab), fm(nyu[col]) if nyu else "&ndash;", fm(s["median"]), fm(s["min"]), fm(s["max"])))
    P.append("</table>")

    # Are the same pairs responsible in every layout? Discovery set only, NYU left out.
    disc_names = [r["layout"] for r in pair_rows if r["set"] == "discovery"]
    vec = {n: [pairs[n].get(p, 0.0) for p in nb_pairs] for n in disc_names}
    sims = [A.spearman(vec[a], vec[b]) for i, a in enumerate(disc_names) for b in disc_names[i + 1:]]
    hot = {}
    for n in disc_names:
        for p, _ in sorted(pairs[n].items(), key=lambda kv: -kv[1])[:20]:
            hot[p] = hot.get(p, 0) + 1
    names = {r["id"]: r["name"] for r in data["regions"]}
    P.append("<h2>Are the same pairs responsible in every layout?</h2><p>Discovery set (%d candidates): Spearman "
             "correlation of the neighbour-pair overlap between two candidates, median %.2f (range %.2f to %.2f). "
             "%d pairs are among a candidate's 20 largest overlaps in at least half of the candidates. The ten most "
             "frequent:</p><table><tr><th>Pair</th><th>Map neighbours</th><th>In top 20 of</th></tr>"
             % (len(disc_names), statistics.median(sims), min(sims), max(sims),
                sum(1 for v in hot.values() if v >= len(disc_names) / 2)))
    nbset_all = set(nb_pairs)
    for p, c in sorted(hot.items(), key=lambda kv: -kv[1])[:10]:
        P.append("<tr><td>%s &ndash; %s</td><td>%s</td><td>%d of %d</td></tr>"
                 % (E(names[p[0]]), E(names[p[1]]), "yes" if p in nbset_all else "no", c, len(disc_names)))
    P.append("</table>")

    P.append("<h2>Pair level: inside each layout</h2><p>For every candidate, Spearman correlation over its 1,136 "
             "map-neighbour pairs between the pair's overlap and each property. Shown: median over the %d candidates, "
             "range, and how many of them are above 0. The partial rows hold the other two properties fixed; the "
             "sliding partial is the test fixed in advance.</p><table><tr><th>Property</th><th>NYU</th><th>Median</th>"
             "<th>Range</th><th>Above 0</th></tr>" % len(cand))
    for col, lab in (("rho_sliding", "Sliding"), ("rho_direction", "Direction error"), ("rho_approach", "Approach"),
                     ("rho_size", "Size (control)"), ("partial_sliding", "Sliding, approach and size fixed"),
                     ("partial_direction", "Direction error, approach and size fixed"),
                     ("partial_approach", "Approach, sliding and size fixed")):
        s = summary([r[col] for r in cand])
        P.append("<tr><td>%s</td><td>%s</td><td>%.2f</td><td>%.2f to %.2f</td><td>%d of %d</td></tr>"
                 % (E(lab), show(nyu[col]) if nyu else "&ndash;", s["median"], s["min"], s["max"], s["positive"], s["n"]))
    P.append("</table>")

    P.append("<h2>Layout level: across candidates</h2><p>Spearman, discovery / replication / mean inside one Noise level "
             "(as in report.html), then partial correlations: pooled over all candidates / mean inside one Noise level.</p>"
             "<table><tr><th>Property</th><th>Linear overlap, peak</th><th>Linear overlap, mean over frames</th></tr>")
    for pcol, lab in (("mean_sliding", "Mean sliding over neighbour pairs"), ("mean_approach", "Mean approach"),
                      ("dir_mean", "Direction error, mean"), ("pair_overlap_total", "Pair overlap summed (check)")):
        P.append("<tr><td>%s</td>%s</tr>" % (E(lab), "".join("<td>%s / %s / %s</td>" % tuple(show(v) for v in lay[(t, pcol)])
                                                            for t in ("linear_overlap_peak", "linear_overlap_mean"))))
    for key, lab in (("dir_mean|mean_sliding", "Direction error, mean sliding fixed"),
                     ("mean_sliding|dir_mean", "Mean sliding, direction error fixed")):
        P.append("<tr><td>%s</td>%s</tr>" % (E(lab), "".join("<td>%s / %s</td>" % tuple(show(v) for v in lay[(t, key)])
                                                            for t in ("linear_overlap_peak", "linear_overlap_mean"))))
    P.append("</table>")

    P.append('<h2>Scatter plots</h2><div class="figs">')
    P.append("<figure>%s<figcaption>Every candidate. Spearman %.2f.</figcaption></figure>"
             % (A.scatter([r["mean_sliding"] for r in lay_rows], [r["linear_overlap_peak"] for r in lay_rows],
                          [r["layout"] for r in lay_rows], "Mean sliding (hex steps)", "Linear overlap peak (%)",
                          "Overlap vs mean sliding"),
                A.spearman([r["mean_sliding"] for r in lay_rows], [r["linear_overlap_peak"] for r in lay_rows])))
    P.append("<figure>%s<figcaption>Every candidate. Spearman %.2f.</figcaption></figure>"
             % (A.scatter([r["dir_mean"] for r in lay_rows], [r["mean_sliding"] for r in lay_rows],
                          [r["layout"] for r in lay_rows], "Direction error, mean (deg)", "Mean sliding (hex steps)",
                          "Mean sliding vs direction error"),
                A.spearman([r["dir_mean"] for r in lay_rows], [r["mean_sliding"] for r in lay_rows])))
    P.append("</div>")
    P.append("<h2>Limits</h2><ul><li>Linear morph only: the Forsch hybrid's outlines are computed inside the page and are "
             "not exposed, so its overlap was not split by pair.</li><li>Sliding and approach use centres; the shared "
             "border itself is not traced.</li><li>Pair overlap counts a pixel under three or more districts once, against "
             "the first district drawn there.</li><li>Same candidates as report.html: one generator on one fixed grid.</li></ul>")
    P.append("</div></body></html>")
    with open(os.path.join(OUT, "shear_test.html"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(P).replace("<table>", '<div class="table-wrap"><table>').replace("</table>", "</table></div>"))

    # console summary
    print("frames checked %d: mean |diff| %.3f, max %.3f; peak diff %.2f..%.2f" %
          (len(frames), statistics.fmean(diffs), max(diffs), min(peak_diff), max(peak_diff)))
    for col in ("share_map_neighbours", "share_top_10pct_pairs", "pairs_with_overlap", "rho_sliding", "rho_direction",
                "rho_approach", "rho_size", "partial_sliding", "partial_direction", "partial_approach"):
        s = summary([r[col] for r in cand])
        print("%-24s NYU %-8s median %.3f  range %.3f..%.3f  above0 %d/%d" %
              (col, show(nyu[col]) if nyu else "-", s["median"], s["min"], s["max"], s["positive"], s["n"]))
    for k, v in lay.items():
        print(k, " / ".join(show(x) for x in v))


if __name__ == "__main__":
    main()
