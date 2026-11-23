#!/bin/sh
# sh run_stale.sh <out_dir>: night4.py on every annotated picture whose output is missing or older than its annotation,
# night4.py, light3d.py or its depth map
O="$1"
for a in ann/*.json; do
  n=$(basename "$a" .json)
  o="$O/$n.png"
  if [ ! -f "$o" ] || [ "$a" -nt "$o" ] || [ night4.py -nt "$o" ] || [ light3d.py -nt "$o" ]; then printf '%s\0' "$n"; fi
done | xargs -0 -r -n 1 -P "${PAR:-6}" sh run_set.sh "$O"
