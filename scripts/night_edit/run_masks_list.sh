#!/bin/sh
# sh run_masks_list.sh <dbg_dir> <names_file>: the masks of the listed pictures only, six at a time
D="$1"; L="$2"; mkdir -p "$D"
G="C:/Users/JTP20/OneDrive/Desktop/RBVRPG/public/images/animations/locations/britannic"
PY=/c/Users/JTP20/AppData/Local/Programs/Python/Python313/python.exe
export MASK_ONLY=1 G PY D
while IFS= read -r n; do [ -n "$n" ] && printf '%s\0' "$n"; done < "$L" | \
  xargs -0 -n 1 -P "${PAR:-6}" sh -c '"$PY" -I night4.py "$G/$0.png" "$D/$0.night.png" "ann/$0.json" "$D" > "$D/$0.log" 2>&1 || echo "FAIL $0"'
