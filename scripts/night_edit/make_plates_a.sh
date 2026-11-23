#!/bin/sh
# Sky-and-sea plates (night4.py PLATE=1: the outside alone, relit) for the A-deck open promenade's views that have none yet
# (2026-11-22): work/plate_night, work/plate_twilight. Nothing in public/.
NE="C:/Users/JTP20/OneDrive/Desktop/RBVRPG/scripts/night_edit"
G="C:/Users/JTP20/OneDrive/Desktop/RBVRPG/public/images/animations/locations/britannic"
PY=/c/Users/JTP20/AppData/Local/Programs/Python/Python313/python.exe
cd "$NE" || exit 1
mkdir -p work/plate_night/dbg work/plate_twilight/dbg
for n in "$@"; do
  a="ann/$n.json"; [ -f "$a" ] || a=-
  [ -f "work/plate_night/$n.png" ] || PLATE=1 $PY -I night4.py "$G/$n.png" "work/plate_night/$n.png" "$a" work/plate_night/dbg > "work/plate_night/dbg/$n.log" 2>&1 || echo "FAIL night plate $n"
  [ -f "work/plate_twilight/$n.png" ] || TOD=twilight PLATE=1 $PY -I night4.py "$G/$n.png" "work/plate_twilight/$n.png" "$a" work/plate_twilight/dbg > "work/plate_twilight/dbg/$n.log" 2>&1 || echo "FAIL twilight plate $n"
  echo "plate $n $(date +%H:%M:%S)"
done
