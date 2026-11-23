#!/bin/sh
# sh run_tod.sh <script> <out_dir> <name> [<name> ...]: a renderer (night4.py, or a dev copy) on each picture, with the
# TOD environment variable passed through (TOD=twilight for the sunrise/sunset set); debug files in <out_dir>/dbg
G="C:/Users/JTP20/OneDrive/Desktop/RBVRPG/public/images/animations/locations/britannic"
PY=/c/Users/JTP20/AppData/Local/Programs/Python/Python313/python.exe
SCRIPT="$1"; O="$2"; shift 2
mkdir -p "$O/dbg"
for n in "$@"; do
  a="ann/$n.json"; [ -f "$a" ] || a=-
  if $PY -I "$SCRIPT" "$G/$n.png" "$O/$n.png" "$a" "$O/dbg" > "$O/dbg/$n.log" 2>&1; then :; else echo "FAIL $n: $(tail -2 "$O/dbg/$n.log" | tr '\n' ' ')"; fi
done
