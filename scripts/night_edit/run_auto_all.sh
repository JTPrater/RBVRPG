#!/bin/sh
# All 133 again with night4.py's AUTO glass zones (2026-11-22: every window pane lit), from the de-sunned day pictures
# (work/desun) into NEW folders work/auto_night, work/auto_twilight: the set in the game (work/desun_night, _twilight) stays.
NE="C:/Users/JTP20/OneDrive/Desktop/RBVRPG/scripts/night_edit"
PY=/c/Users/JTP20/AppData/Local/Programs/Python/Python313/python.exe
cd "$NE" || exit 1
L=work/auto_all.log
echo "START $(date +%H:%M:%S)" > $L
mkdir -p work/auto_night/dbg work/auto_twilight/dbg
one() {
  n="$1"; a="ann/$n.json"; [ -f "$a" ] || a=-
  $PY -I night4.py "work/desun/$n.png" "work/auto_night/$n.png" "$a" work/auto_night/dbg > "work/auto_night/dbg/$n.log" 2>&1 || echo "FAIL night $n" >> $L
  TOD=twilight $PY -I night4.py "work/desun/$n.png" "work/auto_twilight/$n.png" "$a" work/auto_twilight/dbg > "work/auto_twilight/dbg/$n.log" 2>&1 || echo "FAIL twilight $n" >> $L
}
k=0
cut -f2 exterior_list.tsv | sed 's/\.png$//' | tr -d '\r' | while IFS= read -r n; do
  [ -n "$n" ] || continue
  one "$n" &
  k=$((k + 1))
  if [ $((k % 6)) -eq 0 ]; then wait; fi
done
wait
echo "graded: night $(ls work/auto_night/*.png | wc -l), twilight $(ls work/auto_twilight/*.png | wc -l) $(date +%H:%M:%S)" >> $L
echo DONE >> $L
