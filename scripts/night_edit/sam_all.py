"""sam_seg.py over every exterior picture (names with spaces and all): <gpu venv python> -I sam_all.py   -> work/sam"""
import os, runpy, sys
HERE = os.path.dirname(os.path.abspath(__file__))
G = os.path.normpath(os.path.join(HERE, "..", "..", "public", "images", "animations", "locations", "britannic"))
names = [l.rstrip("\n").split("\t")[1] for l in open(os.path.join(HERE, "exterior_list.tsv"), encoding="utf-8") if l.strip()]
todo = [os.path.join(G, n) for n in names if not os.path.exists(os.path.join(HERE, "work", "sam", os.path.splitext(n)[0] + ".sam.png"))]
print("SAM to do:", len(todo), flush=True)
sys.argv = ["sam_seg.py", os.path.join(HERE, "work", "sam")] + todo
if todo:
    runpy.run_path(os.path.join(HERE, "sam_seg.py"), run_name="__main__")
print("SAM ALL DONE", flush=True)
