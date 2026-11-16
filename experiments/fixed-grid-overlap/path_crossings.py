#!/usr/bin/env python3
# Path-crossing test: do the candidates with more overlap have more districts whose paths cross?
#
#   python experiments/fixed-grid-overlap/path_crossings.py
#
# In the Linear morph every outline vertex moves on a straight line at the same pace, so each
# district's centre travels (close to) a straight line from its map centroid to its cell centre.
# For every candidate this script measures those straight paths:
#   crossing pairs        pairs of districts whose paths cross (primary measure, fixed in advance)
#   crossing neighbours   the same, only pairs that are neighbours on the map
#   close passes          pairs whose centres come within theta hex steps of each other part-way
#                         through the morph (minimum strictly between start and end), theta = 0.25,
#                         0.5, 1; this one also uses timing, since all districts move together
#   path length           mean centre path length, in hex steps
# and correlates them with the morph overlap and with direction error, as analyze.py does.
# Writes results/path_crossings.csv, results/path_crossings_correlations.csv and
# results/path_crossings.html. Standard library only; reuses helpers from analyze.py.
import csv, html, importlib.util, json, math, os, statistics, sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
spec = importlib.util.spec_from_file_location("analyze", os.path.join(HERE, "analyze.py"))
A = importlib.util.module_from_spec(spec)
spec.loader.exec_module(A)
OUT = A.OUT

THETAS = [0.25, 0.5, 1.0]
TARGETS = A.TARGETS
PROXIES = [("crossings", "Crossing pairs (primary)"),
           ("crossings_nb", "Crossing pairs, map neighbours only")] + \
          [("close_%s" % str(t).replace(".", "p"), "Close passes, within %g hex step" % t) for t in THETAS] + \
          [("path_mean", "Mean path length (hex steps)"),
           ("dir_mean", "Direction error, mean (deg), for reference")]
LABEL = dict(PROXIES)


# ---------------------------------------------------------------- geometry
def orient(ax, ay, bx, by, cx, cy):
    v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    return (v > 0) - (v < 0)


def cross(p, q):
    (ax, ay, bx, by), (cx, cy, dx, dy) = p, q
    return (orient(ax, ay, bx, by, cx, cy) * orient(ax, ay, bx, by, dx, dy) < 0 and
            orient(cx, cy, dx, dy, ax, ay) * orient(cx, cy, dx, dy, bx, by) < 0)


def angle(ax, ay, bx, by):
    d = abs(math.atan2(ay, ax) - math.atan2(by, bx)) % (2 * math.pi)
    return math.degrees(min(d, 2 * math.pi - d))


def measure(ids, center, target, pairs_nb, step):
    seg = [(center[i][0], center[i][1], target[i][0], target[i][1]) for i in ids]
    box = [(min(s[0], s[2]), max(s[0], s[2]), min(s[1], s[3]), max(s[1], s[3])) for s in seg]
    n = len(ids)
    crossings, crossing_pairs = 0, []
    close = {t: 0 for t in THETAS}
    for a in range(n):
        sa, ba = seg[a], box[a]
        ax0, ay0, ax1, ay1 = sa
        for b in range(a + 1, n):
            sb, bb = seg[b], box[b]
            if not (ba[1] < bb[0] or bb[1] < ba[0] or ba[3] < bb[2] or bb[3] < ba[2]) and cross(sa, sb):
                crossings += 1
                crossing_pairs.append((ids[a], ids[b]))
            # relative position of b seen from a: d0 + s * v for s in [0, 1]
            d0x, d0y = sb[0] - ax0, sb[1] - ay0
            vx, vy = (sb[2] - sb[0]) - (ax1 - ax0), (sb[3] - sb[1]) - (ay1 - ay0)
            vv = vx * vx + vy * vy
            if vv == 0:
                continue
            s = -(d0x * vx + d0y * vy) / vv
            if 0 < s < 1:
                dmin = math.hypot(d0x + s * vx, d0y + s * vy) / step
                for t in THETAS:
                    if dmin < t:
                        close[t] += 1
    nb = [p for p in crossing_pairs if tuple(sorted(p)) in pairs_nb]
    flipped = sum(1 for i, j in nb if angle(center[j][0] - center[i][0], center[j][1] - center[i][1],
                                              target[j][0] - target[i][0], target[j][1] - target[i][1]) > 90)
    out = {"crossings": crossings, "crossings_nb": len(nb), "crossings_nb_flipped": flipped,
           "path_mean": statistics.fmean(math.hypot(s[2] - s[0], s[3] - s[1]) for s in seg) / step}
    for t in THETAS:
        out["close_%s" % str(t).replace(".", "p")] = close[t]
    return out


# ---------------------------------------------------------------- data
def overlap_rows(metrics_dir):
    with open(os.path.join(HERE, metrics_dir, "layout_metrics.csv"), encoding="utf-8") as fh:
        return {r["layout"]: r for r in csv.DictReader(fh)}


def partial(x, y, z):
    # Spearman partial correlation of x and y with z held fixed (Pearson on ranks)
    rx, ry, rz = A.ranks(x), A.ranks(y), A.ranks(z)
    rxy, rxz, ryz = A.pearson(rx, ry), A.pearson(rx, rz), A.pearson(ry, rz)
    if None in (rxy, rxz, ryz) or abs(rxz) >= 1 or abs(ryz) >= 1:
        return None
    return (rxy - rxz * ryz) / math.sqrt((1 - rxz ** 2) * (1 - ryz ** 2))


def main():
    os.makedirs(OUT, exist_ok=True)
    data = json.load(open(os.path.join(ROOT, "hex-layouts", "data.json"), encoding="utf-8"))
    ids = sorted(r["id"] for r in data["regions"])
    center = {r["id"]: tuple(r["center"]) for r in data["regions"]}
    pairs_nb = {tuple(sorted((r["id"], n))) for r in data["regions"] for n in r["neighbors"] if n in center}
    step = data["nyuTarget"]["step"]

    layouts = [("NYU", "baseline", None, {c["originalId"]: (c["x"], c["y"]) for c in data["nyuTarget"]["cells"]})]
    for fname, tag, keep in (("candidates.json", "discovery", lambda p: p["seed"] == 42),
                             ("candidates_extended.json", "replication", lambda p: p["seed"] != 42)):
        for c in json.load(open(os.path.join(HERE, fname), encoding="utf-8"))["candidates"]:
            if keep(c["parameters"]):
                layouts.append((c["id"], tag, c["parameters"], {x["id"]: (x["x"], x["y"]) for x in c["cells"]}))

    over = overlap_rows("candidates-metrics")
    over.update(overlap_rows("candidates_extended-metrics"))
    rows = []
    for name, tag, params, target in layouts:
        m = measure(ids, center, target, pairs_nb, step)
        o = over[name]
        row = {"layout": name, "set": tag, "noise": params["noise"] if params else "",
               "transform": params["transform"] if params else "", "seed": params["seed"] if params else "", **m,
               "dir_mean": float(o["dir_mean"])}
        for col, _ in TARGETS:
            row[col] = float(o[col])
        rows.append(row)
        print("measured %s" % name, file=sys.stderr)

    cols = ["layout", "set", "noise", "transform", "seed", "crossings", "crossings_nb", "crossings_nb_flipped"] + \
           ["close_%s" % str(t).replace(".", "p") for t in THETAS] + ["path_mean", "dir_mean"] + [c for c, _ in TARGETS]
    with open(os.path.join(OUT, "path_crossings.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for r in rows:
            w.writerow([("%.6g" % r[c]) if isinstance(r[c], float) else r[c] for c in cols])

    nyu = rows[0]
    disc = [r for r in rows if r["set"] == "discovery"]
    repl = [r for r in rows if r["set"] == "replication"]
    cand = disc + repl
    strata = [[r for r in cand if r["noise"] == nz] for nz in sorted({r["noise"] for r in cand if r["noise"] > 0})]

    corr = []
    for tcol, _ in TARGETS:
        for pcol, plabel in PROXIES:
            rec = {"target": tcol, "proxy": pcol, "label": plabel}
            for tag, rs in (("discovery", disc), ("replication", repl)):
                rec[tag] = A.spearman([r[pcol] for r in rs], [r[tcol] for r in rs])
            lv = [A.spearman([r[pcol] for r in s], [r[tcol] for r in s]) for s in strata]
            lv = [v for v in lv if v is not None]
            rec["within"] = statistics.fmean(lv) if lv else None
            rec["within_min"], rec["within_max"] = (min(lv), max(lv)) if lv else (None, None)
            corr.append(rec)
    # Does crossing account for direction error's link to overlap, or the other way round?
    part = []
    for tcol, tlabel in TARGETS:
        y = [r[tcol] for r in cand]
        rec = {"target": tcol, "label": tlabel,
               "dir_given_cross": partial([r["dir_mean"] for r in cand], y, [r["crossings"] for r in cand]),
               "cross_given_dir": partial([r["crossings"] for r in cand], y, [r["dir_mean"] for r in cand])}
        for key, (xc, zc) in (("dir_given_cross_within", ("dir_mean", "crossings")),
                              ("cross_given_dir_within", ("crossings", "dir_mean"))):
            lv = [partial([r[xc] for r in s], [r[tcol] for r in s], [r[zc] for r in s]) for s in strata]
            lv = [v for v in lv if v is not None]
            rec[key] = statistics.fmean(lv) if lv else None
        part.append(rec)

    with open(os.path.join(OUT, "path_crossings_correlations.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["kind", "target", "proxy", "discovery", "replication", "within_noise_mean", "within_noise_min",
                    "within_noise_max"])
        f = lambda v: "" if v is None else "%.4f" % v
        for r in corr:
            w.writerow(["spearman", r["target"], r["proxy"], f(r["discovery"]), f(r["replication"]), f(r["within"]),
                        f(r["within_min"]), f(r["within_max"])])
        for r in part:
            w.writerow(["partial", r["target"], "dir_mean given crossings", "", f(r["dir_given_cross"]),
                        f(r["dir_given_cross_within"]), "", ""])
            w.writerow(["partial", r["target"], "crossings given dir_mean", "", f(r["cross_given_dir"]),
                        f(r["cross_given_dir_within"]), "", ""])

    # ---- page
    E, show = html.escape, (lambda v: "&ndash;" if v is None else "%.2f" % v)
    P = ['<!doctype html><html lang="en"><head><meta charset="utf-8">'
         '<meta name="viewport" content="width=device-width, initial-scale=1">'
         '<title>Path-Crossing Test</title><style>%s</style></head><body><div class="viz-root">' % A.STYLE]
    P.append("<h1>Path-crossing test</h1><p class=\"muted\">Generated by experiments/fixed-grid-overlap/path_crossings.py "
             "from the same %d candidates as report.html.</p>" % len(cand))
    P.append("<h2>Hypothesis</h2><p>Direction error goes with overlap (report.html). The proposed reason: in the Linear morph "
             "each district moves on a near-straight line to its cell, so two neighbours that swap sides must cross paths and "
             "cover each other on the way. If so, the number of crossing paths should track overlap at least as well as "
             "direction error, and should account for direction error's link to overlap.</p>")
    P.append("<h2>Measures</h2><ul><li><b>Crossing pairs</b> (primary, chosen before looking at results): pairs of districts "
             "whose straight centre paths, map centroid to cell centre, intersect.</li>"
             "<li><b>Crossing pairs, map neighbours only</b>: the same, for the 1,136 neighbour pairs.</li>"
             "<li><b>Close passes</b>: pairs whose centres come within 0.25, 0.5 or 1 hex step of each other part-way "
             "through the morph. Every district moves at the same pace, so this uses timing as well as geometry.</li>"
             "<li><b>Mean path length</b>: how far centres travel, in hex steps (one hex step = %.2f screen units).</li></ul>" % step)

    P.append("<h2>NYU and the candidates</h2><table><tr><th>Measure</th><th>NYU</th><th>Candidates min</th><th>median</th>"
             "<th>max</th></tr>")
    for col in ["crossings", "crossings_nb", "close_0p25", "close_0p5", "close_1p0", "path_mean", "linear_overlap_peak"]:
        v = sorted(r[col] for r in cand)
        lab = LABEL.get(col, dict(TARGETS).get(col, col)).replace(" (primary)", "")
        fm = "%.2f" if isinstance(v[0], float) else "%d"
        P.append("<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>"
                 % (E(lab), fm % nyu[col], fm % v[0], fm % statistics.median(v), fm % v[-1]))
    P.append("</table>")

    P.append("<h2>Correlation with overlap</h2><p>Spearman, as in report.html: discovery (n=%d) / replication (n=%d) / "
             "mean inside one Noise level (%d levels).</p>" % (len(disc), len(repl), len(strata)))
    P.append("<table><tr><th>Measure</th>" + "".join("<th>%s</th>" % E(l) for _, l in TARGETS) + "</tr>")
    by = {(r["target"], r["proxy"]): r for r in corr}
    for pcol, plabel in PROXIES:
        P.append("<tr><td>%s</td>%s</tr>" % (E(plabel), "".join(
            "<td>%s / %s / %s</td>" % (show(by[(t, pcol)]["discovery"]), show(by[(t, pcol)]["replication"]),
                                       show(by[(t, pcol)]["within"])) for t, _ in TARGETS)))
    P.append("</table>")

    P.append("<h2>Which one carries the link?</h2><p>Partial Spearman correlation with overlap, all %d candidates pooled "
             "/ mean inside one Noise level. If crossings explain direction error's link, the first row drops towards 0 "
             "while the second stays.</p><table><tr><th></th>" % len(cand) +
             "".join("<th>%s</th>" % E(l) for _, l in TARGETS) + "</tr>")
    P.append("<tr><td>Direction error, crossings held fixed</td>%s</tr>"
             % "".join("<td>%s / %s</td>" % (show(r["dir_given_cross"]), show(r["dir_given_cross_within"])) for r in part))
    P.append("<tr><td>Crossing pairs, direction error held fixed</td>%s</tr>"
             % "".join("<td>%s / %s</td>" % (show(r["cross_given_dir"]), show(r["cross_given_dir_within"])) for r in part))
    P.append("</table>")

    nb_all = sum(r["crossings_nb"] for r in cand)
    nb_flip = sum(r["crossings_nb_flipped"] for r in cand)
    P.append("<p>Across all candidates, %d of the crossing paths belong to map neighbours; %d of those (%.0f%%) are pairs whose "
             "direction error is above 90 degrees, i.e. the two neighbours swapped sides. NYU: %d of %d.</p>"
             % (nb_all, nb_flip, 100 * nb_flip / nb_all if nb_all else 0, nyu["crossings_nb_flipped"], nyu["crossings_nb"]))

    P.append('<h2>Scatter plots</h2><p>Every candidate from both sets; NYU is not drawn (%d crossing pairs, Linear peak %.1f%%).</p>'
             '<div class="figs">' % (nyu["crossings"], nyu["linear_overlap_peak"]))
    for xcol, ycol in (("crossings", "linear_overlap_peak"), ("dir_mean", "crossings"), ("crossings", "forsch_overlap_peak")):
        xl, yl = LABEL.get(xcol, xcol).replace(" (primary)", "").replace(", for reference", ""), \
                 dict(TARGETS).get(ycol, LABEL.get(ycol, ycol)).replace(" (primary)", "")
        xs, ys = [r[xcol] for r in cand], [r[ycol] for r in cand]
        P.append("<figure>%s<figcaption>Spearman %.2f.</figcaption></figure>"
                 % (A.scatter(xs, ys, [r["layout"] for r in cand], xl, yl, "%s vs %s" % (yl, xl)), A.spearman(xs, ys)))
    P.append("</div>")
    P.append("<h2>Limits</h2><ul><li>Straight centre paths describe the Linear morph; the Forsch hybrid moves outlines "
             "differently, so for it these are rougher proxies.</li><li>A crossing only counts pairs whose paths meet "
             "somewhere; two districts can cross the same spot at different moments.</li><li>Centres stand in for whole "
             "outlines: large districts can overlap without their centres coming close.</li>"
             "<li>Same candidates as report.html: one generator on one fixed grid.</li></ul>")
    P.append("</div></body></html>")
    with open(os.path.join(OUT, "path_crossings.html"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(P).replace("<table>", '<div class="table-wrap"><table>').replace("</table>", "</table></div>"))

    print("NYU: %d crossing pairs, %d among neighbours; candidates median %g" %
          (nyu["crossings"], nyu["crossings_nb"], statistics.median(r["crossings"] for r in cand)))
    for pcol, plabel in PROXIES:
        r = by[("linear_overlap_peak", pcol)]
        print("%-48s disc %s  repl %s  within %s" % (plabel, show(r["discovery"]), show(r["replication"]), show(r["within"])))
    for r in part:
        print("%-45s dir|cross %s / %s   cross|dir %s / %s" % (r["label"], show(r["dir_given_cross"]),
              show(r["dir_given_cross_within"]), show(r["cross_given_dir"]), show(r["cross_given_dir_within"])))
    print("crossing neighbour pairs with direction error > 90 deg: %d of %d" % (nb_flip, nb_all))


if __name__ == "__main__":
    main()
