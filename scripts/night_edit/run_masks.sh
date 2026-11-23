#!/bin/sh
# sh run_masks.sh <dbg_dir>: the mask only (MASK_ONLY=1) of every annotated picture, six at a time
D="$1"; mkdir -p "$D"
G="C:/Users/JTP20/OneDrive/Desktop/RBVRPG/public/images/animations/locations/britannic"
PY=/c/Users/JTP20/AppData/Local/Programs/Python/Python313/python.exe
export MASK_ONLY=1 G PY D
for a in ann/*.json; do printf '%s\0' "$(basename "$a" .json)"; done | \
  xargs -0 -n 1 -P "${PAR:-6}" sh -c '"$PY" -I night4.py "$G/$0.png" "$D/$0.night.png" "ann/$0.json" "$D" > "$D/$0.log" 2>&1 || echo "FAIL $0"'
