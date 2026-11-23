#!/bin/sh
# night4.py (AUTO glass) again for the names in work/unlit_left.txt, night + twilight, into work/auto_night, auto_twilight.
NE="C:/Users/JTP20/OneDrive/Desktop/RBVRPG/scripts/night_edit"
PY=/c/Users/JTP20/AppData/Local/Programs/Python/Python313/python.exe
cd "$NE" || exit 1
L=work/auto_list.log
echo "START $(date +%H:%M:%S)" > $L
one() {
  n="$1"; a="ann/$n.json"; [ -f "$a" ] || a=-
  $PY -I night4.py "work/desun/$n.png" "work/auto_night/$n.png" "$a" work/auto_night/dbg > "work/auto_night/dbg/$n.log" 2>&1 || echo "FAIL night $n" >> $L
  TOD=twilight $PY -I night4.py "work/desun/$n.png" "work/auto_twilight/$n.png" "$a" work/auto_twilight/dbg > "work/auto_twilight/dbg/$n.log" 2>&1 || echo "FAIL twilight $n" >> $L
}
k=0
tr -d '\r' < work/unlit_left.txt | while IFS= read -r n; do
  [ -n "$n" ] || continue
  one "$n" &
  k=$((k + 1))
  if [ $((k % 8)) -eq 0 ]; then wait; fi
done
wait
echo "DONE $(date +%H:%M:%S)" >> $L
