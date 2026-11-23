#!/bin/sh
# The "sun taken out first" run again for the A-deck open promenade's 20 views, whose cameras were re-placed on 2026-11-22
# (blender/tod_renders/views_a_open.json; monday/PLAN.md): the model with and without the sun from the SCRATCH lower-decks
# file (the A-deck windows as the game has them), desun.py, night4.py (night and twilight). The run of 2026-11-21's
# pictures of these 20 are kept in work/desun_a_old. Log: work/desun_a.log. Nothing in public/.
T="C:/Users/JTP20/OneDrive/Desktop/RBVRPG/blender/tod_renders"
NE="C:/Users/JTP20/OneDrive/Desktop/RBVRPG/scripts/night_edit"
B="/c/Program Files (x86)/Steam/steamapps/common/Blender/blender.exe"
LD="C:/Users/JTP20/AppData/Local/rbvrpg-scratch/roblox_look/lower_decks/Britannic_Lower_Decks.blend"
PY=/c/Users/JTP20/AppData/Local/Programs/Python/Python313/python.exe
cd "$NE" || exit 1
L=work/desun_a.log
echo "START $(date +%H:%M:%S)" > $L
$PY -I -c "import json; print('\n'.join(v['name'] for v in json.load(open(r'$T/views_a_open.json'))))" | tr -d '\r' > work/desun_a_names.txt
mkdir -p work/desun_a_old/desun work/desun_a_old/night work/desun_a_old/twilight work/desun_a_old/day work/desun_a_old/daynosun
while IFS= read -r n; do
  [ -n "$n" ] || continue
  [ -f "work/desun_a_old/desun/$n.png" ] || cp "work/desun/$n.png" "work/desun_a_old/desun/$n.png"
  [ -f "work/desun_a_old/night/$n.png" ] || cp "work/desun_night/$n.png" "work/desun_a_old/night/$n.png"
  [ -f "work/desun_a_old/twilight/$n.png" ] || cp "work/desun_twilight/$n.png" "work/desun_a_old/twilight/$n.png"
  [ -f "work/desun_a_old/day/$n.png" ] || cp "work/desun_raw/day/$n.png" "work/desun_a_old/day/$n.png"
  [ -f "work/desun_a_old/daynosun/$n.png" ] || cp "work/desun_raw/daynosun/$n.png" "work/desun_a_old/daynosun/$n.png"
done < work/desun_a_names.txt
for m in day daynosun; do
  TOD_RB=1 "$B" -b "$LD" --factory-startup --python "$T/tod_render.py" -- "$T/views_a_open.json" "$NE/work/desun_raw/$m" $m 960 540 > "work/desun_a_raw_$m.log" 2>&1
  echo "raw $m: $(grep -c '^VIEW' work/desun_a_raw_$m.log) views $(date +%H:%M:%S)" >> $L
done
while IFS= read -r n; do
  [ -n "$n" ] || continue
  $PY -I desun.py "$n" >> work/desun_a_run.log 2>&1
done < work/desun_a_names.txt
echo "desun: $(grep -c '^DESUN ' work/desun_a_run.log) lines, $(grep -c 'DESUN FAIL' work/desun_a_run.log) failed $(date +%H:%M:%S)" >> $L
one() {
  n="$1"; a="ann/$n.json"; [ -f "$a" ] || a=-
  $PY -I night4.py "work/desun/$n.png" "work/desun_night/$n.png" "$a" work/desun_night/dbg > "work/desun_night/dbg/$n.log" 2>&1 || echo "FAIL night $n" >> $L
  TOD=twilight $PY -I night4.py "work/desun/$n.png" "work/desun_twilight/$n.png" "$a" work/desun_twilight/dbg > "work/desun_twilight/dbg/$n.log" 2>&1 || echo "FAIL twilight $n" >> $L
}
k=0
while IFS= read -r n; do
  [ -n "$n" ] || continue
  one "$n" &
  k=$((k + 1))
  if [ $((k % 5)) -eq 0 ]; then wait; fi
done < work/desun_a_names.txt
wait
echo "graded $(date +%H:%M:%S)" >> $L
echo DONE >> $L
