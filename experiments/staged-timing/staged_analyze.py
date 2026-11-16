#!/usr/bin/env python3
# Staged linear morph: does separating travel from outline change lower the overlap, and at what cost?
#
#   python experiments/staged-timing/staged_analyze.py
#
# Reads runs/staged_frames.csv, runs/staged_runs.csv and runs/staged_pairs.csv from staged_scores.cjs.
# Checks fixed in advance:
#   1. stagger 0 reproduces the Linear scores, both those of the same run and the published ones
#      (evidence/morph_scores.csv, experiments/fixed-grid-overlap/candidates*_morph.csv);
#   2. the outlines at t = 0 and t = 1 are identical to Linear's.
# Primary outcome: the Linear overlap peak as a function of stagger under the "small" rule.
# Writes results/summary.csv, results/checks.txt and results/staged_timing.html. Standard library only.
import csv, html, importlib.util, json, math, os, statistics, sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
FIXED = os.path.join(ROOT, "experiments", "fixed-grid-overlap")
spec = importlib.util.spec_from_file_location("analyze", os.path.join(FIXED, "analyze.py"))
A = importlib.util.module_from_spec(spec)
spec.loader.exec_module(A)
OUT = os.path.join(HERE, "results")
RULE_LABEL = {"small": "Travel small", "outline": "Outline first", "three": "Three phases"}
RULE_CLASS = {"small": "s1", "outline": "s2", "three": "s3"}


def speed(rule, stagger):
    # Travel takes 1 - s/2 of the time with two phases and 1 - 2s/3 with three.
    return 1 / (1 - 2 * stagger / 3) if rule == "three" else 1 / (1 - stagger / 2)
# The ten neighbour pairs that most often led the overlap in the fixed-grid experiment (shear_test.html).
HOTSPOTS = [("2101", "2102"), ("3001", "3002"), ("3101", "3103"), ("0803", "0807"), ("5304", "5305"),
            ("1601", "1602"), ("1716", "1717"), ("0803", "4903"), ("0401", "0402"), ("0502", "0504")]


def read(name):
    with open(os.path.join(HERE, "runs", name), encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def ring_area(ring):
    return abs(sum(ring[i][0] * ring[i - 1][1] - ring[i - 1][0] * ring[i][1] for i in range(len(ring)))) / 2


def reference_linear():
    out = {}
    for path in (os.path.join(ROOT, "evidence", "morph_scores.csv"), os.path.join(FIXED, "candidates_morph.csv"),
                 os.path.join(FIXED, "candidates_extended_morph.csv")):
        with open(path, encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                if r["method"] == "linear":
                    out.setdefault(r["layout"], {})[r["t"]] = (r["overlap_pct"], r["self_crossing_districts"], r["area_change_rate"])
    return out


def line_chart(series, xlabel, ylabel, title, xticks=None, yticks=None, width=330, height=230):
    # series: [(label, css class, [(x, y, tip)])]. Panels of one figure share yticks.
    W, H, L, R, T, B = width, height, 44, 14, 26, 38
    xs = [x for _, _, pts in series for x, _, _ in pts]
    ys = [y for _, _, pts in series for _, y, _ in pts]
    xt = xticks or A.nice_ticks(min(xs), max(xs))
    yt = yticks or A.nice_ticks(0, max(ys))
    x0, x1, y0, y1 = xt[0], xt[-1], yt[0], yt[-1]
    sx = lambda v: L + (v - x0) / (x1 - x0) * (W - L - R)
    sy = lambda v: H - B - (v - y0) / (y1 - y0) * (H - T - B)
    s = ['<svg width="%d" viewBox="0 0 %d %d" role="img" aria-label="%s">' % (W, W, H, html.escape(title))]
    s.append('<text class="title" x="%d" y="14">%s</text>' % (L, html.escape(title)))
    for t in yt:
        s.append('<line class="grid" x1="%g" x2="%g" y1="%g" y2="%g"/>' % (L, W - R, sy(t), sy(t)))
        s.append('<text x="%g" y="%g" text-anchor="end">%s</text>' % (L - 6, sy(t) + 4, A.fmt(t)))
    for t in xt:
        s.append('<text x="%g" y="%g" text-anchor="middle">%s</text>' % (sx(t), H - B + 15, A.fmt(t) if t else "0"))
    s.append('<line class="axis" x1="%g" x2="%g" y1="%g" y2="%g"/>' % (L, W - R, H - B, H - B))
    s.append('<text x="%g" y="%g" text-anchor="middle">%s</text>' % ((L + W - R) / 2, H - 5, html.escape(xlabel)))
    s.append('<text transform="translate(11,%g) rotate(-90)" text-anchor="middle">%s</text>' % ((T + H - B) / 2, html.escape(ylabel)))
    for label, cls, pts in series:
        s.append('<polyline class="ln %s" points="%s"/>' % (cls, " ".join("%g,%g" % (sx(x), sy(y)) for x, y, _ in pts)))
        for x, y, tip in pts:
            if tip is None:
                continue
            s.append('<g class="pt"><title>%s</title><circle class="hit" cx="%g" cy="%g" r="9"/><circle class="%s" cx="%g" cy="%g" r="4"/></g>'
                     % (html.escape("%s\n%s" % (label, tip)), sx(x), sy(y), cls, sx(x), sy(y)))
    s.append("</svg>")
    return "".join(s)


def main():
    os.makedirs(OUT, exist_ok=True)
    frames, runs, pairs = read("staged_frames.csv"), read("staged_runs.csv"), read("staged_pairs.csv")
    layouts = []
    for r in runs:
        if r["layout"] not in layouts:
            layouts.append(r["layout"])
    staggers = sorted({float(r["stagger"]) for r in runs})
    rules = [rule for rule in ("small", "outline", "three") if any(r["rule"] == rule for r in runs)]

    series = {}                       # (layout, method, rule, stagger) -> rows sorted by t
    for r in frames:
        key = (r["layout"], r["method"], r["rule"], float(r["stagger"]) if r["stagger"] != "" else None)
        series.setdefault(key, []).append(r)
    run_info = {(r["layout"], r["rule"], float(r["stagger"])): r for r in runs}

    data = json.load(open(os.path.join(ROOT, "hex-layouts", "data.json"), encoding="utf-8"))
    names = {r["id"]: r["name"] for r in data["regions"]}
    nb = {tuple(sorted((r["id"], n))) for r in data["regions"] for n in r["neighbors"]}
    hex_area = 3 * math.sqrt(3) / 2 * data["nyuTarget"]["radius"] ** 2
    large = {r["id"]: sum(ring_area(g) for g in r["rings"]) > hex_area for r in data["regions"]}
    n_large = sum(large.values())
    pair_tot = {}
    for r in pairs:
        key = (r["layout"], r["rule"], float(r["stagger"]))
        pair_tot.setdefault(key, {})[tuple(sorted((r["a"], r["b"])))] = float(r["overlap_area_frames"])

    # ---------------- checks
    checks, ok_all = [], True
    ref = reference_linear()
    for lay in layouts:
        lin = series[(lay, "linear", "", None)]
        for rule in rules:
            st = series[(lay, "staged", rule, 0.0)]
            same = all(a["overlap_pct"] == b["overlap_pct"] and a["self_crossing_districts"] == b["self_crossing_districts"]
                       and a["area_change_rate"] == b["area_change_rate"] and a["covered_pixels"] == b["covered_pixels"]
                       for a, b in zip(lin, st)) and len(lin) == len(st) == 101
            ok_all &= same
            checks.append("stagger 0, rule %-7s reproduces this run's Linear frames for %-20s %s" % (rule, lay, "yes" if same else "NO"))
        if lay in ref:
            same = all(ref[lay].get(r["t"]) == (r["overlap_pct"], r["self_crossing_districts"], r["area_change_rate"]) for r in lin)
            ok_all &= same
            checks.append("Linear frames match the published scores for %-20s %s" % (lay, "yes" if same else "NO"))
        else:
            checks.append("no published Linear scores found for %s" % lay)
    end = max(max(float(r["endpoint_diff_t0"]), float(r["endpoint_diff_t1"])) for r in runs)
    ok_all &= end == 0
    checks.append("largest difference from Linear's outlines at t = 0 and t = 1, all %d staged runs: %g screen units" % (len(runs), end))
    reach = max(float(r["reach_outside_score_rect"]) for r in runs)
    checks.append("farthest any staged outline reaches outside the scored rectangle: %s"
                  % ("none (largest value %.1f, negative means inside)" % reach if reach <= 0 else "%.1f screen units" % reach))
    count_ok = all(int(r["outline_first_districts"]) == (int(r["districts"]) if r["rule"] == "outline" else n_large) for r in runs)
    checks.append("districts larger than their hexagon: %d of %d (page and this script agree: %s)" % (n_large, len(large), "yes" if count_ok else "NO"))
    checks.append("all checks passed: %s" % ok_all)
    with open(os.path.join(OUT, "checks.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(checks) + "\n")

    # ---------------- summary per run
    def summarise(rows, lay, rule, stagger):
        ov = [float(r["overlap_pct"]) for r in rows]
        cov = [int(r["covered_pixels"]) for r in rows]
        area = [float(r["area_change_rate"]) for r in rows]
        peak = max(range(len(ov)), key=lambda k: ov[k])
        low = min(range(len(cov)), key=lambda k: cov[k])
        # The page's overlap is a share of the area covered at that moment, and the covered area
        # itself shrinks when districts shrink early. The same overlap as an area, in percent of
        # the map's covered area at t = 0:
        absolute = [o * c / cov[0] for o, c in zip(ov, cov)]
        out = {"layout": lay, "rule": rule, "stagger": stagger, "overlap_peak": ov[peak], "overlap_peak_t": float(rows[peak]["t"]),
               "overlap_mean": statistics.fmean(ov), "overlap_area_peak": max(absolute),
               "overlap_area_mean": statistics.fmean(absolute), "area_change_mean": statistics.fmean(area), "area_change_peak": max(area),
               "crossing_peak": max(int(r["self_crossing_districts"]) for r in rows),
               "covered_min_ratio": cov[low] / cov[0], "covered_min_t": float(rows[low]["t"]), "covered_end_ratio": cov[-1] / cov[0]}
        info = run_info[(lay, rule, stagger)]
        mult = speed(rule, stagger)
        out.update({"speed_multiplier": mult, "centre_speed_mean": float(info["dist_mean_hex_steps"]) * mult,
                    "centre_speed_max": float(info["dist_max_hex_steps"]) * mult})
        po = pair_tot.get((lay, rule, stagger), {})
        total = sum(po.values())
        cat = {"large-large": 0.0, "small-small": 0.0, "mixed": 0.0}
        for (a, b), v in po.items():
            cat["large-large" if large[a] and large[b] else "small-small" if not large[a] and not large[b] else "mixed"] += v
        out.update({"pair_total": total, "share_neighbours": sum(v for k, v in po.items() if k in nb) / total if total else 0,
                    "hotspots": sum(po.get(tuple(sorted(p)), 0.0) for p in HOTSPOTS),
                    "pairs_overlapping": len(po), **{"area_" + k: v for k, v in cat.items()}})
        return out

    summary = {}
    for lay in layouts:
        for rule in rules:
            for s in staggers:
                summary[(lay, rule, s)] = summarise(series[(lay, "staged", rule, s)], lay, rule, s)
    cols = list(next(iter(summary.values())))
    with open(os.path.join(OUT, "summary.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for row in summary.values():
            w.writerow([("%.6g" % row[c]) if isinstance(row[c], float) else row[c] for c in cols])

    # ---------------- page
    E = html.escape
    style = A.STYLE + """
svg .ln { fill: none; stroke-width: 2; } svg .ln.s1 { stroke: var(--series-1); } svg .ln.s2 { stroke: var(--series-2); }
svg .ln.s3 { stroke: var(--series-3); } figure { flex: 1 1 300px; max-width: 340px; }
td.best { font-weight: 600; color: var(--text-primary); } .note { color: var(--text-secondary); }
"""
    P = ['<!doctype html><html lang="en"><head><meta charset="utf-8">'
         '<meta name="viewport" content="width=device-width, initial-scale=1">'
         '<title>Staged Timing Test</title><style>%s</style></head><body><div class="viz-root">' % style]
    P.append("<h1>Staged linear morph</h1><p class=\"muted\">Generated by experiments/staged-timing/staged_analyze.py from "
             "the scores of this folder's copy of the morph page. Linear morph only; the Forsch hybrid is unchanged.</p>")
    P.append("<h2>The change</h2><p>In the linear morph every outline point moves straight to its hexagon point, so position, "
             "size and shape change together. Here each point is its district's centre plus an offset, and the two run on "
             "separate clocks over the same total time. With stagger s, the first clock runs over [0, 1 &minus; s/2] and the "
             "second over [s/2, 1]: s = 0 is the linear morph, s = 1 runs one clock in the first half and the other in the second.</p>"
             "<ul><li><b>Outline first</b>: every district turns into its hexagon first and travels afterwards.</li>"
             "<li><b>Travel small</b>: a district larger than its hexagon shrinks first and then travels; a smaller one travels "
             "first and grows afterwards. %d of %d districts are larger than their hexagon.</li>"
             "<li><b>Three phases</b> (follow-up to the first two): large districts shrink while small ones travel, then the "
             "large ones travel, then the small ones grow, so that the large districts travel while the small ones are still "
             "small. Phase k = 0, 1, 2 runs over [k s/3, k s/3 + 1 &minus; 2s/3]; at s = 1 each phase has a third of the time.</li></ul>"
             % (n_large, len(large)))
    zero = [c for c in checks if c.startswith("stagger 0")]
    published = [c for c in checks if c.startswith("Linear frames match")]
    short = ["Stagger 0 reproduces the same run's Linear frames (overlap, self-crossings, area change, covered pixels at all 101 "
             "samples): %d of %d layout and rule combinations." % (sum(c.endswith("yes") for c in zero), len(zero)),
             "Those Linear frames match the published scores (evidence/morph_scores.csv and the fixed-grid experiment): "
             "%d of %d layouts." % (sum(c.endswith("yes") for c in published), len(layouts))]
    short += [c[0].upper() + c[1:] + "." for c in checks if not c.startswith(("stagger 0", "Linear frames match", "no published"))]
    P.append("<h2>Checks</h2><ul>%s</ul><p class=\"muted\">One line per layout is in checks.txt.</p>"
             % "".join("<li>%s</li>" % E(c) for c in short))

    def pivot(title, key, fmt, lower_better=True, note=""):
        P.append("<h3>%s</h3>%s" % (E(title), "<p class=\"note\">%s</p>" % note if note else ""))
        for rule in rules:
            P.append("<table><tr><th>%s</th>%s</tr>" % (E(RULE_LABEL[rule]), "".join("<th>s = %g</th>" % s for s in staggers)))
            for lay in layouts:
                vals = [summary[(lay, rule, s)][key] for s in staggers]
                shown = [fmt % v for v in vals]
                best = fmt % (min(vals) if lower_better else max(vals))   # bold only a best value that is visibly alone
                P.append("<tr><td>%s</td>%s</tr>" % (E(lay), "".join(
                    "<td%s>%s</td>" % (' class="best"' if text == best and shown.count(best) == 1 else "", text) for text in shown)))
            P.append("</table>")

    P.append("<h2>Primary outcome: overlap peak</h2><p>Largest share of the covered area that lies under two or more districts, "
             "over the page's 101 samples, in percent. s = 0 is the linear morph. The lowest value in each row is bold.</p>")
    P.append('<div class="legend">%s</div><div class="figs">' % "".join(
        '<span style="--c: var(--series-%s)">%s</span>' % (RULE_CLASS[rule][1], E(RULE_LABEL[rule])) for rule in rules))
    peak_ticks = A.nice_ticks(0, max(row["overlap_peak"] for row in summary.values()))
    time_ticks = A.nice_ticks(0, max(float(r["overlap_pct"]) for r in frames if r["rule"] in ("small", "three")))
    for lay in layouts:
        ser = [(RULE_LABEL[rule], RULE_CLASS[rule], [(s, summary[(lay, rule, s)]["overlap_peak"],
                                                      "stagger %g: peak %.2f%%" % (s, summary[(lay, rule, s)]["overlap_peak"])) for s in staggers])
               for rule in rules]
        P.append("<figure>%s</figure>" % line_chart(ser, "Stagger", "Overlap peak (%)", lay, xticks=[0, 0.25, 0.5, 0.75, 1], yticks=peak_ticks))
    P.append("</div>")
    pivot("Overlap peak (%)", "overlap_peak", "%.2f")
    pivot("Overlap, mean over the 101 samples (%)", "overlap_mean", "%.2f")
    pivot("Time of the overlap peak", "overlap_peak_t", "%.2f", note="Where in the morph the peak falls.")
    P.append("<h2>The same overlap as an area</h2><p>The page reports overlap as a share of the area covered at that moment. "
             "When districts shrink early the covered area falls, so the share can rise even if less area overlaps. "
             "These tables give the overlapping area itself, in percent of the map's covered area at t = 0.</p>")
    pivot("Overlapping area, peak (% of the map's area at t = 0)", "overlap_area_peak", "%.2f")
    pivot("Overlapping area, mean over the 101 samples (% of the map's area at t = 0)", "overlap_area_mean", "%.2f")

    for rule in [r for r in ("small", "three") if r in rules]:
        P.append("<h2>Overlap over time, %s</h2><div class=\"legend\"><span style=\"--c: var(--series-1)\">s = 0 (Linear)</span>"
                 "<span style=\"--c: var(--series-2)\">s = 0.5</span><span style=\"--c: var(--series-3)\">s = 1</span></div>"
                 "<div class=\"figs\">" % E(RULE_LABEL[rule]))
        for lay in layouts:
            ser = []
            for s, cls in ((0.0, "s1"), (0.5, "s2"), (1.0, "s3")):
                rows = series[(lay, "staged", rule, s)]
                ser.append(("s = %g" % s, cls, [(float(r["t"]), float(r["overlap_pct"]), None) for r in rows]))
            P.append("<figure>%s</figure>" % line_chart(ser, "t", "Overlap (%)", lay, xticks=[0, 0.25, 0.5, 0.75, 1], yticks=time_ticks))
        P.append("</div>")

    P.append("<h2>Costs</h2>")
    pivot("Area change, peak", "area_change_peak", "%.2f",
          note="Mean over districts of |dA/dt| divided by the district's average size, at its highest sample. Shape change is squeezed into less time, so this rises.")
    pivot("Area change, mean over the samples", "area_change_mean", "%.2f")
    pivot("Self-crossing outlines, peak (districts)", "crossing_peak", "%d")
    pivot("Emptiest moment: covered area relative to t = 0", "covered_min_ratio", "%.3f", lower_better=False,
          note="Smallest covered pixel count over the morph divided by the count at t = 0. The hex layout itself covers %s of the map's area."
          % ", ".join("%.3f (%s)" % (summary[(lay, "small", 0.0)]["covered_end_ratio"], lay) for lay in layouts))
    P.append("<h3>Centre speed</h3><p class=\"note\">Travel is squeezed into less of the time (1 &minus; s/2 with two phases, "
             "1 &minus; 2s/3 with three), so every centre moves faster while it moves. Speed relative to Linear:</p>"
             "<table><tr><th>Rule</th>%s</tr>%s</table>"
             % ("".join("<th>s = %g</th>" % s for s in staggers), "".join(
                 "<tr><td>%s</td>%s</tr>" % (E(RULE_LABEL[rule]), "".join("<td>&times;%.2f</td>" % speed(rule, s) for s in staggers))
                 for rule in rules)))

    P.append("<h2>Where the overlap goes</h2><p>Per-pair overlap from 51 moments, as in the neighbour-shear test. "
             "A district is <i>large</i> if its map area exceeds its hexagon's, otherwise <i>small</i>.</p>")
    pivot("Share of the overlap from map-neighbour pairs", "share_neighbours", "%.2f", lower_better=False)
    P.append("<h3>Hotspot pairs</h3><p class=\"note\">Overlap of the ten neighbour pairs that most often led the list in the fixed-grid "
             "experiment (%s), as a percentage of its value at s = 0.</p>" % E("; ".join("%s and %s" % (names[a], names[b]) for a, b in HOTSPOTS)))
    for rule in rules:
        P.append("<table><tr><th>%s</th>%s</tr>" % (E(RULE_LABEL[rule]), "".join("<th>s = %g</th>" % s for s in staggers)))
        for lay in layouts:
            base = summary[(lay, rule, 0.0)]["hotspots"]
            P.append("<tr><td>%s</td>%s</tr>" % (E(lay), "".join("<td>%.0f</td>" % (100 * summary[(lay, rule, s)]["hotspots"] / base) for s in staggers)))
        P.append("</table>")
    P.append("<h3>Overlap by kind of pair</h3><p class=\"note\">Summed pair overlap as a percentage of the layout's total at s = 0, split by "
             "whether the two districts are large or small: large&ndash;large / mixed / small&ndash;small.</p>")
    for rule in rules:
        P.append("<table><tr><th>%s</th>%s</tr>" % (E(RULE_LABEL[rule]), "".join("<th>s = %g</th>" % s for s in staggers)))
        for lay in layouts:
            base = summary[(lay, rule, 0.0)]["pair_total"]
            P.append("<tr><td>%s</td>%s</tr>" % (E(lay), "".join(
                "<td>%.0f / %.0f / %.0f</td>" % tuple(100 * summary[(lay, rule, s)]["area_" + k] / base for k in ("large-large", "mixed", "small-small"))
                for s in staggers)))
        P.append("</table>")

    P.append("<h2>Limits</h2><ul><li>Five layouts on one grid, one stagger parameter and %d rules.</li>" % len(rules) +
             "<li>Three phases was added after the first two rules were scored, to test an idea their results suggested.</li>"
             "<li>Overlap is a raster estimate at 101 samples; pair overlap uses 51 moments.</li>"
             "<li>Nothing here measures how easy the animation is to follow. A staged morph has two phases to watch, "
             "and faster travel; that needs a user study.</li>"
             "<li>The Forsch hybrid is not staged: its precomputed keyframes mix position and outline.</li>"
             "<li>District centres are the map centroid and the cell centre; the outline clock uses the same point pairing as the linear morph.</li></ul>")
    P.append("</div></body></html>")
    with open(os.path.join(OUT, "staged_timing.html"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(P).replace("<table>", '<div class="table-wrap"><table>').replace("</table>", "</table></div>"))

    print("\n".join(checks))
    for key in ("overlap_peak", "overlap_mean", "overlap_area_peak", "overlap_area_mean", "overlap_peak_t", "area_change_peak",
                "crossing_peak", "covered_min_ratio", "share_neighbours"):
        for rule in rules:
            print("\n%s, %s" % (key, RULE_LABEL[rule]))
            for lay in layouts:
                print("  %-20s %s" % (lay, "  ".join("%7.3f" % summary[(lay, rule, s)][key] for s in staggers)))
    for rule in rules:
        print("\nhotspots %% of s=0 | pair overlap %% of the s=0 total (large-large / mixed / small-small), %s" % RULE_LABEL[rule])
        for lay in layouts:
            b = summary[(lay, rule, 0.0)]
            print("  %-20s %s" % (lay, "  ".join("%3.0f|%3.0f/%3.0f/%3.0f" % (
                100 * summary[(lay, rule, s)]["hotspots"] / b["hotspots"],
                *(100 * summary[(lay, rule, s)]["area_" + k] / b["pair_total"] for k in ("large-large", "mixed", "small-small")))
                for s in staggers)))


if __name__ == "__main__":
    main()
