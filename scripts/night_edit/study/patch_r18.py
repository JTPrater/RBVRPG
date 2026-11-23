"""Round 18 (2026-11-23). win6.py: an "add" in a small box (under 14 px across) is not opened (its glass is 2 px strips).
work/win5_fix.json: the edge-on windows whose glass cannot be seen stay dark (poop3, poop8, 2nd class b prom5); two finds
that were sky between rails and a boat are dropped."""
import ast, json, os
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(HERE, "win6.py")
s = open(p, encoding="utf-8").read()
a = """            gl = ndi.binary_opening(gl, structure=K3)
            if hull_o:"""
b = """            sy_, sx_ = np.nonzero(sub)
            if min(sy_.max() - sy_.min() + 1, sx_.max() - sx_.min() + 1) >= 14:
                gl = ndi.binary_opening(gl, structure=K3)
            if hull_o:"""
assert s.count(a) == 1, s.count(a)
s = s.replace(a, b)
ast.parse(s)
open(p + ".tmp", "w", encoding="utf-8", newline=chr(10)).write(s)
os.replace(p + ".tmp", p)
p = os.path.join(HERE, "work", "win5_fix.json")
j = json.load(open(p, encoding="utf-8"))
j["poop3"] = {"clear": [[560, 340, 650, 560]]}
j.pop("poop8", None)
j["2nd class b prom5"] = {"drop_at": [[1340, 260]]}
j["BD first port prom6"]["drop_at"] = [[485, 450]]
j["starb 2nd class prom4"] = {"drop_at": [[1160, 350]]}
open(p + ".tmp", "w", encoding="utf-8", newline=chr(10)).write(json.dumps(j, indent=1, ensure_ascii=False))
os.replace(p + ".tmp", p)
print("round 18:", len(j) - 1, "pictures with corrections")
