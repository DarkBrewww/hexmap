# Scores every layout in a sweep folder and prints them ranked.
#   python3 rank_sweep.py DIR [--json OUT.json]
import sys, os, re, json, glob
sys.path.insert(0, os.path.dirname(__file__))
import score_layout as S

d = sys.argv[1]
rows = []
for tsv in sorted(glob.glob(os.path.join(d, "*.tsv"))):
    name = os.path.basename(tsv)[:-4]
    lay = S.tsv_layout(tsv)
    if len(lay) != 436:
        continue
    r = S.score(name, lay)
    log = open(os.path.join(d, name + ".log")).read()
    m = re.search(r"TOTAL_SECONDS ([0-9.]+)", log)
    p = re.search(r"PARTS (\d+)", log)
    r["seconds"] = float(m.group(1)) if m else None
    r["parts"] = int(p.group(1)) if p else None
    rows.append(r)
rows.sort(key=lambda r: (-r["map_pairs_kept"][0], r["direction_error_deg"]["mean"]))
dash = S.score("dashboard", S.dashboard)
hdr = "%-16s %5s %6s %6s %6s %7s %6s %5s %6s %6s %5s %4s %s" % ("layout", "kept", "within", "cross", "states", "dir_mean", "rev90", "rms", "max", "hexpr", "secs", "prts", "split")
print(hdr)
for r in [dash] + rows:
    print("%-16s %5d %5.1f%% %5.1f%% %3d/%3d %7.1f %6d %5.2f %6.1f %6d %5s %4s %s" % (
        r["layout"], r["map_pairs_kept"][0], r["within_state_kept"][2], r["cross_state_kept"][2], r["state_borders_kept"][0], r["state_borders_kept"][1],
        r["direction_error_deg"]["mean"], r["direction_error_deg"]["over_90"], r["distance_hex_steps"]["rms"], r["distance_hex_steps"]["max"],
        r["hex_pairs"], r.get("seconds", "-"), r.get("parts", "-"), ",".join(r["states_split"]) or "-"))
if "--json" in sys.argv:
    json.dump({"dashboard": dash, "runs": rows}, open(sys.argv[sys.argv.index("--json") + 1], "w"), indent=1)
