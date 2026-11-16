#!/usr/bin/env python3
# Which layout properties go with lower morph overlap, when the grid is held fixed?
#
#   python experiments/fixed-grid-overlap/analyze.py
#
# Reads the two candidate sets made by make_candidates.cjs and scored by evidence/morph_scores.cjs and
# evidence/evaluate_layouts.py:
#   discovery    candidates.json (seed 42, 30 settings)          candidates-metrics/layout_metrics.csv
#   replication  candidates_extended.json, seeds other than 42   candidates_extended-metrics/layout_metrics.csv
# Every candidate uses the 436 NYU cells at the NYU size, so hexagon size and grid shape are the same
# for all of them; only the district-to-cell assignment differs.
# Writes results/correlations.csv, results/candidates_table.csv, results/noise_levels.csv and results/report.html.
# Standard library only.
import csv, html, json, math, os, statistics

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "results")

TARGETS = [
    ("linear_overlap_peak", "Linear overlap, peak (%)"),
    ("linear_overlap_mean", "Linear overlap, mean over frames (%)"),
    ("forsch_overlap_peak", "Forsch hybrid overlap, peak (%)"),
    ("forsch_overlap_mean", "Forsch hybrid overlap, mean over frames (%)"),
]
# (column, label, source). "eval" columns come from layout_metrics.csv, "gen" from the candidate file.
PREDICTORS = [
    ("loc_mean", "Location, mean (hex steps)", "eval"),
    ("loc_p90", "Location, 90th percentile", "eval"),
    ("loc_max", "Location, max", "eval"),
    ("original_movement", "Original movement (Hex Map Layouts)", "gen"),
    ("distance", "Distance to transformed centre (Hex Map Layouts)", "gen"),
    ("angle", "Orientation (Hex Map Layouts)", "gen"),
    ("adjacency", "Adjacency loss (Hex Map Layouts)", "gen"),
    ("pairs_kept", "Neighbour pairs kept", "eval"),
    ("false_pairs", "False neighbour pairs", "eval"),
    ("dir_mean", "Direction error, mean (deg)", "eval"),
    ("dir_over_90", "Pairs with direction error > 90 deg", "eval"),
    ("deform_5_mean", "Deform-5", "eval"),
    ("deform_15_mean", "Deform-15", "eval"),
    ("deform_50_mean", "Deform-50", "eval"),
    ("deform_100_mean", "Deform-100", "eval"),
    ("deform_all_mean", "Deform-all", "eval"),
    ("ortho_5_mean", "OrthoOrder-5", "eval"),
    ("ortho_15_mean", "OrthoOrder-15", "eval"),
    ("ortho_50_mean", "OrthoOrder-50", "eval"),
    ("ortho_100_mean", "OrthoOrder-100", "eval"),
    ("ortho_all_mean", "OrthoOrder-all", "eval"),
    ("shape_iou", "Shape IoU", "eval"),
    ("guide_dev_mean", "Guide-Dev, mean", "eval"),
    ("states_split", "States split", "eval"),
    ("state_borders_kept", "State borders kept", "eval"),
    ("noise", "Generation parameter: Noise", "gen"),
    ("transform", "Generation parameter: Transform", "gen"),
]
LABEL = dict((c, l) for c, l, _ in PREDICTORS)
LABEL.update(TARGETS)


# ---------------------------------------------------------------- data
def load_set(candidates_file, metrics_dir, keep):
    payload = json.load(open(os.path.join(HERE, candidates_file), encoding="utf-8"))
    gen = {}
    for c in payload["candidates"]:
        p = c["parameters"]
        if not keep(p):
            continue
        gen[c["id"]] = {"noise": p["noise"], "transform": p["transform"], "seed": p["seed"],
                        "distance": c["metrics"]["distance"], "angle": c["metrics"]["angle"],
                        "adjacency": c["metrics"]["adjacency"],
                        "original_movement": c["diagnostics"]["originalDisplacementMean"]}
    rows, nyu = [], None
    with open(os.path.join(HERE, metrics_dir, "layout_metrics.csv"), encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if r["layout"] == "NYU":
                nyu = r
                continue
            if r["layout"] not in gen:
                continue
            row = {"layout": r["layout"]}
            for col, _, src in PREDICTORS:
                row[col] = float(gen[r["layout"]][col] if src == "gen" else r[col])
            for col, _ in TARGETS:
                row[col] = float(r[col])
            row["linear_overlap_peak_t"] = float(r["linear_overlap_peak_t"])
            row["forsch_overlap_peak_t"] = float(r["forsch_overlap_peak_t"])
            row["seed"] = gen[r["layout"]]["seed"]
            rows.append(row)
    if len(rows) != len(gen):
        raise SystemExit("%s: %d candidates but %d scored rows" % (metrics_dir, len(gen), len(rows)))
    return rows, nyu


# ---------------------------------------------------------------- statistics
def ranks(values):
    order = sorted(range(len(values)), key=lambda i: values[i])
    out = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        for k in range(i, j + 1):
            out[order[k]] = (i + j) / 2 + 1          # average rank for ties
        i = j + 1
    return out


def pearson(x, y):
    mx, my = statistics.fmean(x), statistics.fmean(y)
    sxy = sum((a - mx) * (b - my) for a, b in zip(x, y))
    sxx = sum((a - mx) ** 2 for a in x)
    syy = sum((b - my) ** 2 for b in y)
    if sxx == 0 or syy == 0:
        return None
    return sxy / math.sqrt(sxx * syy)


def spearman(x, y):
    return pearson(ranks(x), ranks(y))


def spearman_p(r, n):
    # Two-sided p from the Fisher z approximation with the Fieller-Hartley-Pearson
    # standard error 1.06 / sqrt(n - 3). Approximate; used only to flag strength.
    if r is None or n < 5:
        return None
    r = max(min(r, 0.999999), -0.999999)
    z = math.atanh(r) * math.sqrt(n - 3) / 1.06
    return math.erfc(abs(z) / math.sqrt(2))


def describe(values):
    v = sorted(values)
    return {"min": v[0], "max": v[-1], "mean": statistics.fmean(v), "sd": statistics.pstdev(v)}


# ---------------------------------------------------------------- SVG pieces
STYLE = """
.viz-root { color-scheme: light; --surface-1: #fcfcfb; --surface-2: #f3f2ef; --text-primary: #0b0b0b;
  --text-secondary: #52514e; --text-muted: #77756f; --grid: #e4e3df; --axis: #b9b7b0;
  --series-1: #2a78d6; --series-2: #eb6834; --series-3: #1baf7a; }
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) .viz-root { color-scheme: dark; --surface-1: #1a1a19;
    --surface-2: #232321; --text-primary: #f0efec; --text-secondary: #c3c2b7; --text-muted: #9a988f;
    --grid: #2e2e2b; --axis: #55534d; --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70; }
}
:root[data-theme="dark"] .viz-root { color-scheme: dark; --surface-1: #1a1a19; --surface-2: #232321;
  --text-primary: #f0efec; --text-secondary: #c3c2b7; --text-muted: #9a988f; --grid: #2e2e2b;
  --axis: #55534d; --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70; }
body { margin: 0; background: var(--surface-1); }
.viz-root { background: var(--surface-1); color: var(--text-primary);
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; max-width: 980px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 17px; margin: 32px 0 8px; }
p, li { color: var(--text-secondary); } .muted { color: var(--text-muted); font-size: 12px; }
table { border-collapse: collapse; font-variant-numeric: tabular-nums; font-size: 13px; margin: 8px 0; }
th, td { padding: 4px 10px; border-bottom: 1px solid var(--grid); text-align: right; }
th:first-child, td:first-child { text-align: left; } th { color: var(--text-secondary); font-weight: 600; }
.figs { display: flex; flex-wrap: wrap; gap: 16px; }
figure { margin: 0; flex: 1 1 300px; max-width: 470px; } figcaption { color: var(--text-secondary); font-size: 13px; }
svg { max-width: 100%; height: auto; overflow: visible; display: block; }
.table-wrap { overflow-x: auto; max-width: 100%; }
svg text { fill: var(--text-secondary); font-size: 11px; } svg .title { fill: var(--text-primary); font-size: 12px; font-weight: 600; }
svg .grid { stroke: var(--grid); stroke-width: 1; } svg .axis { stroke: var(--axis); stroke-width: 1; }
svg .zero { stroke: var(--axis); stroke-width: 1.5; }
svg .s1 { fill: var(--series-1); stroke: var(--surface-1); stroke-width: 2; }
svg .s2 { fill: var(--series-2); stroke: var(--surface-1); stroke-width: 2; }
svg .s3 { fill: var(--series-3); stroke: var(--surface-1); stroke-width: 2; }
svg .hit { fill: transparent; stroke: none; } svg g.pt:hover circle:not(.hit) { stroke: var(--text-primary); }
.legend { display: flex; gap: 16px; font-size: 13px; color: var(--text-secondary); margin: 4px 0; }
.legend span::before { content: ""; display: inline-block; width: 10px; height: 10px; border-radius: 50%;
  margin-right: 6px; vertical-align: -1px; background: var(--c); }
@media (max-width: 600px) { table { font-size: 12px; } th, td { padding: 4px 6px; } }
"""


def nice_ticks(lo, hi, count=5):
    if hi == lo:
        hi = lo + 1
    raw = (hi - lo) / count
    mag = 10 ** math.floor(math.log10(raw))
    step = next(m * mag for m in (1, 2, 2.5, 5, 10) if m * mag >= raw)
    start = math.floor(lo / step) * step
    ticks, t = [], start
    while t <= hi + step * 1e-9:
        ticks.append(round(t, 10))
        t += step
    if ticks[-1] < hi:
        ticks.append(round(ticks[-1] + step, 10))
    return ticks


def fmt(v):
    return ("%d" % v) if abs(v - round(v)) < 1e-9 and abs(v) >= 1 else ("%.3g" % v)


def scatter(xs, ys, names, xlabel, ylabel, title):
    W, H, L, R, T, B = 440, 300, 52, 16, 28, 44
    xt, yt = nice_ticks(min(xs), max(xs)), nice_ticks(min(ys), max(ys))
    x0, x1, y0, y1 = xt[0], xt[-1], yt[0], yt[-1]
    sx = lambda v: L + (v - x0) / (x1 - x0) * (W - L - R)
    sy = lambda v: H - B - (v - y0) / (y1 - y0) * (H - T - B)
    s = ['<svg width="%d" viewBox="0 0 %d %d" role="img" aria-label="%s">' % (W, W, H, html.escape(title))]
    s.append('<text class="title" x="%d" y="14">%s</text>' % (L, html.escape(title)))
    for t in yt:
        s.append('<line class="grid" x1="%g" x2="%g" y1="%g" y2="%g"/>' % (L, W - R, sy(t), sy(t)))
        s.append('<text x="%g" y="%g" text-anchor="end">%s</text>' % (L - 6, sy(t) + 4, fmt(t)))
    for t in xt:
        s.append('<text x="%g" y="%g" text-anchor="middle">%s</text>' % (sx(t), H - B + 16, fmt(t)))
    s.append('<line class="axis" x1="%g" x2="%g" y1="%g" y2="%g"/>' % (L, W - R, H - B, H - B))
    s.append('<text x="%g" y="%g" text-anchor="middle">%s</text>' % ((L + W - R) / 2, H - 6, html.escape(xlabel)))
    s.append('<text transform="translate(12,%g) rotate(-90)" text-anchor="middle">%s</text>'
             % ((T + H - B) / 2, html.escape(ylabel)))
    for x, y, n in zip(xs, ys, names):
        tip = "%s\n%s: %s\n%s: %s" % (n, xlabel, "%.4g" % x, ylabel, "%.4g" % y)
        s.append('<g class="pt"><title>%s</title><circle class="hit" cx="%g" cy="%g" r="9"/>'
                 '<circle class="s1" cx="%g" cy="%g" r="4"/></g>' % (html.escape(tip), sx(x), sy(y), sx(x), sy(y)))
    s.append("</svg>")
    return "".join(s)


def dot_plot(rows, n_disc, n_repl):
    # rows: (label, rho discovery, rho replication, rho within Noise); x axis -1..1
    W, L, R, T, rowh = 720, 300, 20, 30, 26
    H = T + rowh * len(rows) + 30
    sx = lambda v: L + (v + 1) / 2 * (W - L - R)
    s = ['<svg width="%d" viewBox="0 0 %d %d" role="img" aria-label="Spearman correlation with Linear overlap peak">' % (W, W, H)]
    for t in (-1, -0.5, 0, 0.5, 1):
        s.append('<line class="%s" x1="%g" x2="%g" y1="%d" y2="%d"/>' % ("zero" if t == 0 else "grid", sx(t), sx(t), T - 6, H - 26))
        s.append('<text x="%g" y="%d" text-anchor="middle">%s</text>' % (sx(t), H - 10, fmt(t) if t else "0"))
    s.append('<text class="title" x="%d" y="14">Spearman correlation with Linear overlap peak</text>' % L)
    for i, (label, a, b, c) in enumerate(rows):
        y = T + rowh * i + rowh / 2
        s.append('<text x="%d" y="%g" text-anchor="end">%s</text>' % (L - 10, y + 4, html.escape(label)))
        s.append('<line class="grid" x1="%g" x2="%g" y1="%g" y2="%g"/>' % (L, W - R, y, y))
        for v, cls, dy, name in ((a, "s1", -6, "Discovery, n=%d" % n_disc), (b, "s2", 0, "Replication, n=%d" % n_repl),
                                 (c, "s3", 6, "Within one Noise level, mean")):
            if v is None:
                continue
            s.append('<g class="pt"><title>%s\n%s: %.2f</title><circle class="hit" cx="%g" cy="%g" r="9"/>'
                     '<circle class="%s" cx="%g" cy="%g" r="4.5"/></g>'
                     % (html.escape(label), name, v, sx(v), y + dy, cls, sx(v), y + dy))
    s.append("</svg>")
    return "".join(s)


# ---------------------------------------------------------------- report
def main():
    os.makedirs(OUT, exist_ok=True)
    disc, nyu = load_set("candidates.json", "candidates-metrics", lambda p: p["seed"] == 42)
    repl, _ = load_set("candidates_extended.json", "candidates_extended-metrics", lambda p: p["seed"] != 42)

    # Noise drives much of the spread, so also correlate inside each Noise level (both sets pooled,
    # Noise > 0 only, since Noise 0 has six candidates) and average the per-level coefficients.
    levels = sorted({r["noise"] for r in disc + repl if r["noise"] > 0})
    strata = [[r for r in disc + repl if r["noise"] == nz] for nz in levels]
    corr = []
    for tcol, _ in TARGETS:
        for pcol, plabel, _ in PREDICTORS:
            rec = {"target": tcol, "predictor": pcol, "label": plabel}
            for tag, rows in (("discovery", disc), ("replication", repl)):
                x, y = [r[pcol] for r in rows], [r[tcol] for r in rows]
                rho = spearman(x, y)
                rec[tag + "_n"] = len(rows)
                rec[tag + "_spearman"] = rho
                rec[tag + "_pearson"] = pearson(x, y)
                rec[tag + "_p_approx"] = spearman_p(rho, len(rows))
            per_level = [spearman([r[pcol] for r in s], [r[tcol] for r in s]) for s in strata]
            per_level = [v for v in per_level if v is not None]
            rec["within_noise_levels"] = len(per_level)
            rec["within_noise_spearman_mean"] = statistics.fmean(per_level) if per_level else None
            rec["within_noise_spearman_min"] = min(per_level) if per_level else None
            rec["within_noise_spearman_max"] = max(per_level) if per_level else None
            corr.append(rec)
    with open(os.path.join(OUT, "correlations.csv"), "w", newline="", encoding="utf-8") as fh:
        cols = ["target", "predictor", "label", "discovery_n", "discovery_spearman", "discovery_pearson",
                "discovery_p_approx", "replication_n", "replication_spearman", "replication_pearson",
                "replication_p_approx", "within_noise_levels", "within_noise_spearman_mean",
                "within_noise_spearman_min", "within_noise_spearman_max"]
        w = csv.writer(fh)
        w.writerow(cols)
        for r in corr:
            w.writerow([("%.4f" % r[c]) if isinstance(r[c], float) else ("" if r[c] is None else r[c]) for c in cols])

    keys = ["layout", "seed", "noise", "transform"] + [c for c, _ in TARGETS] + \
           ["linear_overlap_peak_t", "forsch_overlap_peak_t"] + [c for c, _, _ in PREDICTORS if c not in ("noise", "transform")]
    with open(os.path.join(OUT, "candidates_table.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["set"] + keys)
        for tag, rows in (("discovery", disc), ("replication", repl)):
            for r in rows:
                w.writerow([tag] + [("%.6g" % r[k]) if isinstance(r[k], float) else r[k] for k in keys])

    # ---- the page
    E = html.escape
    P = ['<!doctype html><html lang="en"><head><meta charset="utf-8">'
         '<meta name="viewport" content="width=device-width, initial-scale=1">'
         '<title>Fixed-Grid Overlap Experiment</title><style>%s</style></head><body><div class="viz-root">' % STYLE]
    P.append("<h1>Fixed-grid overlap experiment</h1>")
    P.append('<p class="muted">Generated by experiments/fixed-grid-overlap/analyze.py. Every number on this page is computed '
             'from the files in this folder.</p>')
    P.append("<h2>Question</h2><p>All candidates keep the 436 NYU cells at the NYU size and spacing; only the assignment of "
             "districts to cells changes. Which layout properties move together with the morph overlap?</p>")
    P.append("<h2>Setup</h2><ul>"
             "<li>Discovery set: Fixed NYU grid, Noise 0, 0.05, 0.1, 0.2, 0.4 &times; Transform 0, 0.2, 0.4, 0.6, 0.8, 1, seed 42 "
             "(%d distinct assignments).</li>"
             "<li>Replication set: the same 30 settings with seeds 1&ndash;4, Noise &gt; 0 only (%d distinct assignments). "
             "It shares no candidate with the discovery set.</li>"
             "<li>Within one Noise level: both sets pooled and split by Noise (0.05, 0.1, 0.2, 0.4; %d candidates each), "
             "correlated inside each level, then averaged. This asks whether a property still goes with overlap when the "
             "amount of noise is held fixed.</li>"
             "<li>Overlap: the morph page's own 101 samples (index.html, read by evidence/morph_scores.cjs). "
             "Layout metrics: evidence/evaluate_layouts.py.</li></ul>" % (len(disc), len(repl), len(strata[0])))

    P.append("<h2>How much does overlap vary?</h2><table><tr><th>Measure</th><th>NYU</th>"
             "<th>Discovery min</th><th>max</th><th>mean</th><th>SD</th><th>Replication min</th><th>max</th></tr>")
    for tcol, tlabel in TARGETS:
        d, r = describe([x[tcol] for x in disc]), describe([x[tcol] for x in repl])
        P.append("<tr><td>%s</td><td>%.2f</td><td>%.2f</td><td>%.2f</td><td>%.2f</td><td>%.2f</td><td>%.2f</td><td>%.2f</td></tr>"
                 % (E(tlabel), float(nyu[tcol]), d["min"], d["max"], d["mean"], d["sd"], r["min"], r["max"]))
    P.append("</table>")
    lt = describe([x["linear_overlap_peak_t"] for x in disc + repl])
    ft = describe([x["forsch_overlap_peak_t"] for x in disc + repl])
    P.append("<p>Time of the overlap peak, all %d candidates: Linear t = %.2f&ndash;%.2f, Forsch hybrid t = %.2f&ndash;%.2f "
             "(NYU: %.2f and %.2f).</p>" % (len(disc) + len(repl), lt["min"], lt["max"], ft["min"], ft["max"],
                                             float(nyu["linear_overlap_peak_t"]), float(nyu["forsch_overlap_peak_t"])))

    P.append("<h2>Correlations</h2><p>Spearman rank correlation between each layout property and the overlap, in the discovery "
             "set and, separately, in the replication set. A property is worth attention only if both sets agree in sign and "
             "size. Positive means: the larger the property, the larger the overlap.</p>")
    lin = sorted([c for c in corr if c["target"] == "linear_overlap_peak" and c["discovery_spearman"] is not None],
                 key=lambda c: -abs(c["discovery_spearman"]))
    P.append('<div class="legend"><span style="--c: var(--series-1)">Discovery (n=%d)</span>'
             '<span style="--c: var(--series-2)">Replication (n=%d)</span>'
             '<span style="--c: var(--series-3)">Within one Noise level (mean of %d)</span></div>'
             % (len(disc), len(repl), len(strata)))
    P.append(dot_plot([(c["label"], c["discovery_spearman"], c["replication_spearman"],
                        c["within_noise_spearman_mean"]) for c in lin], len(disc), len(repl)))
    skipped = [c["label"] for c in corr if c["target"] == "linear_overlap_peak" and c["discovery_spearman"] is None]
    if skipped:
        P.append('<p class="muted">Constant in the discovery set, so not shown: %s.</p>' % E(", ".join(skipped)))

    P.append("<table><tr><th>Property</th>" + "".join("<th>%s<br>disc. / repl. / within</th>" % E(l.split(",")[0] + (" peak" if "peak" in c else " mean"))
                                                    for c, l in TARGETS) + "</tr>")
    by = {(c["target"], c["predictor"]): c for c in corr}
    show = lambda v: "&ndash;" if v is None else "%.2f" % v
    for c in lin:
        cells = []
        for tcol, _ in TARGETS:
            r = by[(tcol, c["predictor"])]
            cells.append("<td>%s / %s / %s</td>" % (show(r["discovery_spearman"]), show(r["replication_spearman"]),
                                                     show(r["within_noise_spearman_mean"])))
        P.append("<tr><td>%s</td>%s</tr>" % (E(c["label"]), "".join(cells)))
    P.append("</table><p class=\"muted\">Approximate two-sided p-values (Fisher z) are in correlations.csv. With %d properties "
             "tested against 4 overlap measures, some correlations will look strong by chance; the replication set is the guard.</p>"
             % len(PREDICTORS))

    # ---- direction error inside each Noise level, one row per level
    P.append("<h2>Direction error inside each Noise level</h2><p>The &ldquo;within one Noise level&rdquo; value above is a mean "
             "over the levels. Level by level, both sets pooled: the number of candidates, the range of the Linear overlap "
             "peak, and the Spearman correlation of Orientation (Hex Map Layouts) and of Direction error "
             "(evaluate_layouts.py) with the Linear and the Forsch hybrid overlap peak. Noise 0 has too few candidates "
             "to read and is not part of the mean.</p><table><tr><th>Noise</th><th>Candidates</th>"
             "<th>Linear peak, min&ndash;max (%)</th><th>Orientation<br>Linear / Forsch</th>"
             "<th>Direction error<br>Linear / Forsch</th></tr>")
    level_rows = []
    for nz in sorted({r["noise"] for r in disc + repl}):
        group = [r for r in disc + repl if r["noise"] == nz]
        peaks = [r["linear_overlap_peak"] for r in group]
        rho = {(p, t): spearman([r[p] for r in group], [r[t] for r in group])
               for p in ("angle", "dir_mean") for t in ("linear_overlap_peak", "forsch_overlap_peak")}
        level_rows.append([nz, len(group), min(peaks), max(peaks)] + [rho[k] for k in sorted(rho)])
        P.append("<tr><td>%g</td><td>%d</td><td>%.2f&ndash;%.2f</td><td>%s / %s</td><td>%s / %s</td></tr>"
                 % (nz, len(group), min(peaks), max(peaks), show(rho[("angle", "linear_overlap_peak")]),
                    show(rho[("angle", "forsch_overlap_peak")]), show(rho[("dir_mean", "linear_overlap_peak")]),
                    show(rho[("dir_mean", "forsch_overlap_peak")])))
    P.append("</table>")
    with open(os.path.join(OUT, "noise_levels.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["noise", "candidates", "linear_peak_min", "linear_peak_max", "orientation_vs_forsch_peak",
                    "orientation_vs_linear_peak", "direction_vs_forsch_peak", "direction_vs_linear_peak"])
        for row in level_rows:
            w.writerow([("%.4f" % v) if isinstance(v, float) else v for v in row])

    P.append("<h2>Scatter plots, Linear overlap peak</h2><p>The three layout properties (generation parameters left out) with the "
             "strongest discovery correlation, every candidate from both sets. NYU is not drawn (its Linear peak is %.1f%%, "
             "above every candidate).</p><div class=\"figs\">" % float(nyu["linear_overlap_peak"]))
    both = disc + repl
    for c in [c for c in lin if c["predictor"] not in ("noise", "transform")][:3]:
        P.append("<figure>%s<figcaption>Spearman %.2f (discovery), %.2f (replication).</figcaption></figure>"
                 % (scatter([r[c["predictor"]] for r in both], [r["linear_overlap_peak"] for r in both],
                            [r["layout"] for r in both], c["label"], "Linear overlap peak (%)", c["label"]),
                    c["discovery_spearman"], c["replication_spearman"]))
    P.append("<figure>%s<figcaption>Do the two morph methods rank the candidates the same way? Spearman %.2f.</figcaption></figure>"
             % (scatter([r["linear_overlap_peak"] for r in both], [r["forsch_overlap_peak"] for r in both],
                        [r["layout"] for r in both], "Linear overlap peak (%)", "Forsch hybrid overlap peak (%)",
                        "Linear vs Forsch hybrid"),
                spearman([r["linear_overlap_peak"] for r in both], [r["forsch_overlap_peak"] for r in both])))
    P.append("</div>")

    P.append("<h2>Linear overlap peak by setting (discovery set)</h2><table><tr><th>Noise \\ Transform</th>")
    trs = sorted({r["transform"] for r in disc})
    P.append("".join("<th>%g</th>" % t for t in trs) + "</tr>")
    for nz in sorted({r["noise"] for r in disc}):
        cells = []
        for t in trs:
            v = [r["linear_overlap_peak"] for r in disc if r["noise"] == nz and r["transform"] == t]
            cells.append("<td>%s</td>" % ("%.2f" % v[0] if v else "&ndash;"))
        P.append("<tr><td>%g</td>%s</tr>" % (nz, "".join(cells)))
    P.append("</table>")

    P.append("<h2>Limits</h2><ul>"
             "<li>All candidates come from one generator (Hungarian assignment to transformed centroids) on one fixed grid; "
             "other generators may behave differently.</li>"
             "<li>Overlap is a raster estimate at 101 samples, as on the morph page; it is not a continuous-time measure.</li>"
             "<li>The Forsch hybrid is our adaptation (precomputed core keyframes retargeted to each layout), not the full "
             "method of Forsch et al.</li>"
             "<li>Correlation is not cause: properties that move together with overlap here are candidates to test, "
             "not proven drivers.</li></ul>")
    P.append("</div></body></html>")
    with open(os.path.join(OUT, "report.html"), "w", encoding="utf-8") as fh:
        page = "\n".join(P).replace("<table>", '<div class="table-wrap"><table>').replace("</table>", "</table></div>")
        fh.write(page)
    print("discovery n=%d, replication n=%d; wrote results/correlations.csv, results/candidates_table.csv, results/noise_levels.csv, results/report.html"
          % (len(disc), len(repl)))
    nan = lambda v: float("nan") if v is None else v
    for c in lin:
        print("%-50s disc %+.2f  repl %+.2f  within %+.2f" % (c["label"], c["discovery_spearman"],
              nan(c["replication_spearman"]), nan(c["within_noise_spearman_mean"])))


if __name__ == "__main__":
    main()
