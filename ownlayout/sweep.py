# Runs pipeline jobs two at a time with a per-run timeout; skips runs whose TSV exists.
#   python3 sweep.py INPUT.wkt OUTDIR TIMEOUT "p d r s" ...   (or jobs from OUTDIR/jobs.txt)
import sys, os, subprocess, time
from concurrent.futures import ThreadPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__))
CLASSPATH = os.environ.get("GRIDMAP_CLASSPATH", os.path.join(HERE, "build", "classes"))
MEDIAL = os.environ.get("GRIDMAP_MEDIAL_AXIS", os.path.join(HERE, "build", "CmdMedialAxis.exe"))
inp, outdir, tmo = sys.argv[1], sys.argv[2], float(sys.argv[3])
jobs = [j.split() for j in (sys.argv[4:] or open(os.path.join(outdir, "jobs.txt")).read().split("\n")) if j.strip()]
def run(j):
    p, d, r, s = j
    name = os.path.join(outdir, "p%s_d%s_r%s_s%s" % (p, d, r, s))
    if os.path.exists(name + ".tsv"):
        return name, "skip", 0
    t0 = time.time()
    try:
        with open(name + ".log", "w") as log:
            subprocess.run(["java", "-cp", CLASSPATH, "ownmap.RunPipeline", inp, name,
                            MEDIAL, p, d, "HEXAGON", "AgglomerativeAssigned", r, s],
                           stdout=log, stderr=subprocess.STDOUT, timeout=tmo)
        status = "ok" if os.path.exists(name + ".tsv") else "fail"
    except subprocess.TimeoutExpired:
        status = "timeout"
    return name, status, round(time.time() - t0, 1)
with ThreadPoolExecutor(2) as ex:
    for name, status, sec in ex.map(run, jobs):
        print(os.path.basename(name), status, sec, flush=True)
open(os.path.join(outdir, "ALL_DONE"), "w").write("done\n")
