#!/usr/bin/env python3
# GridMapPipeline runs as a hex-layout-lab-v2 file that evidence/evaluate_layouts.py can score, for
# any regions file (export_layouts.cjs does the same for districts only, with the viewer's extras).
#
#   python3 ownlayout/tsv_to_layout.py REGIONS.json OUT.json ID=RUN.tsv [ID=RUN.tsv ...]
#
# A run's TSV has one line per region: cell x, cell y, region id. The pipeline's hexagons are pointy-top
# with axial (x, y) and y up, which is the flat-side lattice of hex-layouts/ with q = x and r = -y (as in
# export_layouts.cjs). Cells are placed like export_layouts.cjs places them: one uniform scale and one
# shift, by least squares from hex centres to region centres. Standard library only.
import json, math, os, sys

SQRT3 = math.sqrt(3)


def main():
    regions_path, out_path, specs = sys.argv[1], sys.argv[2], sys.argv[3:]
    if not specs:
        sys.exit(__doc__)
    regions = json.load(open(regions_path, encoding="utf-8"))["regions"]
    center = {r["id"]: r["center"] for r in regions}
    candidates = []
    for spec in specs:
        cid, path = spec.split("=", 1)
        axial, cells_seen = [], set()
        for k, line in enumerate(open(path, encoding="utf-8").read().strip().splitlines()):
            x, y, rid = line.split("\t")
            q, r = int(x), -int(y)
            if rid not in center or (q, r) in cells_seen or any(a[0] == rid for a in axial):
                sys.exit("%s:%d: bad row" % (path, k + 1))
            cells_seen.add((q, r))
            axial.append((rid, q, r))
        if len(axial) != len(center):
            sys.exit("%s: %d regions, expected %d" % (path, len(axial), len(center)))
        n = len(axial)
        P = [(q + r / 2, SQRT3 * r / 2) for _, q, r in axial]
        C = [center[rid] for rid, _, _ in axial]
        pm = (math.fsum(p[0] for p in P) / n, math.fsum(p[1] for p in P) / n)
        cm = (math.fsum(c[0] for c in C) / n, math.fsum(c[1] for c in C) / n)
        num = math.fsum((p[0] - pm[0]) * (c[0] - cm[0]) + (p[1] - pm[1]) * (c[1] - cm[1]) for p, c in zip(P, C))
        den = math.fsum((p[0] - pm[0]) ** 2 + (p[1] - pm[1]) ** 2 for p in P)
        step = num / den
        origin = [cm[0] - step * pm[0], cm[1] - step * pm[1]]       # screen position of lattice cell (0, 0)
        candidates.append({"id": cid, "run": os.path.relpath(path), "grid": {"origin": origin, "step": step, "shape": "flat-side"},
                           "cells": [{"id": rid, "q": q, "r": r} for rid, q, r in sorted(axial)]})
        print("%s: %d cells, step %.4f screen units" % (cid, n, step))
    json.dump({"format": "hex-layout-lab-v2", "algorithm": "gridmap-pipeline-meulemans-2026",
               "source": {"regions": os.path.relpath(regions_path)}, "candidates": candidates},
              open(out_path, "w", encoding="utf-8"), separators=(",", ":"))
    print("wrote", out_path)


if __name__ == "__main__":
    main()
