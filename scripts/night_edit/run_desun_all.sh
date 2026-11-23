#!/bin/sh
# The whole "sun taken out first" run (2026-11-21; blender/tod_renders/monday/PLAN.md): the model with and without the sun for
# all 133 views, desun.py, then night4.py (night and twilight) on work/desun. Logs: work/desun_all.log. Nothing in public/.
T="C:/Users/JTP20/OneDrive/Desktop/RBVRPG/blender/tod_renders"
NE="C:/Users/JTP20/OneDrive/Desktop/RBVRPG/scripts/night_edit"
B="/c/Program Files (x86)/Steam/steamapps/common/Blender/blender.exe"
LD="C:/Users/JTP20/OneDrive/Desktop/RBVRPG/blender/lower_decks/Britannic_Lower_Decks.blend"
PY=/c/Users/JTP20/AppData/Local/Programs/Python/Python313/python.exe
cd "$NE" || exit 1
L=work/desun_all.log
echo "START $(date +%H:%M:%S)" > $L
for m in day daynosun; do
  TOD_RB=1 "$B" -b "$LD" --factory-startup --python "$T/tod_render.py" -- "$T/views_all_rb.json" "$NE/work/desun_raw/$m" $m 960 540 > "work/desun_raw_$m.log" 2>&1
  echo "raw $m: $(grep -c '^VIEW' work/desun_raw_$m.log) views $(date +%H:%M:%S)" >> $L
done
$PY -I desun.py --all > work/desun_run.log 2>&1
echo "desun: $(grep -c '^DESUN ' work/desun_run.log) lines, $(grep -c 'DESUN FAIL' work/desun_run.log) failed $(date +%H:%M:%S)" >> $L
mkdir -p work/desun_night/dbg work/desun_twilight/dbg
one() {
  n="$1"; a="ann/$n.json"; [ -f "$a" ] || a=-
  $PY -I night4.py "work/desun/$n.png" "work/desun_night/$n.png" "$a" work/desun_night/dbg > "work/desun_night/dbg/$n.log" 2>&1 || echo "FAIL night $n" >> $L
  TOD=twilight $PY -I night4.py "work/desun/$n.png" "work/desun_twilight/$n.png" "$a" work/desun_twilight/dbg > "work/desun_twilight/dbg/$n.log" 2>&1 || echo "FAIL twilight $n" >> $L
}
k=0
cut -f2 exterior_list.tsv | sed 's/\.png$//' | tr -d '\r' | while IFS= read -r n; do
  [ -n "$n" ] || continue
  one "$n" &
  k=$((k + 1))
  if [ $((k % 5)) -eq 0 ]; then wait; fi
done
wait
echo "graded: night $(ls work/desun_night/*.png | wc -l), twilight $(ls work/desun_twilight/*.png | wc -l) $(date +%H:%M:%S)" >> $L
echo DONE >> $L
