"""night4.py over many pictures, a few at a time (2026-11-23; replaces the shell loops, which lost names with apostrophes
and did not wait for their last batch).

python -I run_p.py <night|twilight> <out dir under work/> <name> [<name> ...] | --all        env JOBS (6), SRC_DIR (work/desun)
-> work/<out>/<name>.png, work/<out>/dbg/<name>.log ...; prints one line a picture and a summary; exit 1 if any failed."""
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
tod, out = sys.argv[1], sys.argv[2]
names = sys.argv[3:]
if names == ["--all"]:
    names = [os.path.splitext(l.rstrip("\n").split("\t")[1])[0] for l in open(os.path.join(HERE, "exterior_list.tsv"), encoding="utf-8") if l.strip()]
od = os.path.join(HERE, "work", out)
os.makedirs(os.path.join(od, "dbg"), exist_ok=True)
src_dir = os.path.join(HERE, os.environ.get("SRC_DIR", os.path.join("work", "desun")))
env = dict(os.environ)
if tod == "twilight":
    env["TOD"] = "twilight"
else:
    env.pop("TOD", None)


def one(n):
    t0 = time.time()
    ann = os.path.join(HERE, "ann", n + ".json")
    cmd = [sys.executable, "-I", os.path.join(HERE, "night4.py"), os.path.join(src_dir, n + ".png"), os.path.join(od, n + ".png"),
           ann if os.path.exists(ann) else "-", os.path.join(od, "dbg")]
    with open(os.path.join(od, "dbg", n + ".log"), "w", encoding="utf-8") as lf:
        rc = subprocess.call(cmd, stdout=lf, stderr=subprocess.STDOUT, env=env, cwd=HERE)
    ok = rc == 0 and os.path.exists(os.path.join(od, n + ".png")) and os.path.getmtime(os.path.join(od, n + ".png")) >= t0 - 1
    print("%s %-36s %5.1f s" % ("ok  " if ok else "FAIL", n, time.time() - t0), flush=True)
    return ok


t0 = time.time()
with ThreadPoolExecutor(int(os.environ.get("JOBS", "6"))) as ex:
    res = list(ex.map(one, names))
bad = [n for n, r in zip(names, res) if not r]
print("DONE %s -> work/%s: %d ok, %d failed %s, %.0f s" % (tod, out, sum(res), len(bad), bad[:8], time.time() - t0), flush=True)
sys.exit(1 if bad else 0)
