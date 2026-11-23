#!/bin/sh
# sh run_set.sh <out_dir> <name> [<name> ...]: night4.py on each picture (ann/<name>.json), debug files in <out_dir>/dbg
G="C:/Users/JTP20/OneDrive/Desktop/RBVRPG/public/images/animations/locations/britannic"
PY=/c/Users/JTP20/AppData/Local/Programs/Python/Python313/python.exe
O="$1"; shift
mkdir -p "$O/dbg"
for n in "$@"; do
  a="ann/$n.json"; [ -f "$a" ] || a=-
  if $PY -I night4.py "$G/$n.png" "$O/$n.png" "$a" "$O/dbg" > "$O/dbg/$n.log" 2>&1; then :; else echo "FAIL $n: $(tail -2 "$O/dbg/$n.log" | tr '\n' ' ')"; fi
done
