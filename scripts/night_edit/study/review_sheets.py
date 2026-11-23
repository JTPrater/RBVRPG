"""Sheets for looking at a finished run (2026-11-23).

python -I review_sheets.py half <dir under work/> <out dir> [per]        every picture at 960 x 540, 6 (per) a sheet, captioned
python -I review_sheets.py windows <dir under work/> <out dir>            every found window (work/win6) cropped at FULL size
                                                                          from the run's picture, padded, captioned
                                                                          "<picture> #id class"; packed into sheets
python -I review_sheets.py critic <night dir> <twilight dir> <out dir>    one sheet a picture for an independent look:
                                                                          the night picture at full size (1920 x 1080) and
                                                                          under it the day picture and the sunset picture
                                                                          at half size; a line of text says which is which
Names: env NAMES="a|b|c" restricts to those pictures."""
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = os.path.normpath(os.path.join(HERE, "..", "..", "public", "images", "animations", "locations", "britannic"))
W = os.path.join(HERE, "work")
names = [os.path.splitext(l.rstrip("\n").split("\t")[1])[0] for l in open(os.path.join(HERE, "exterior_list.tsv"), encoding="utf-8") if l.strip()]
if os.environ.get("NAMES"):
    keep = set(os.environ["NAMES"].split("|"))
    names = [n for n in names if n in keep]


def put(im, text, org=(6, 18), scale=0.55, col=(0, 255, 255)):
    cv2.putText(im, text, org, cv2.FONT_HERSHEY_SIMPLEX, scale, (0, 0, 0), 3)
    cv2.putText(im, text, org, cv2.FONT_HERSHEY_SIMPLEX, scale, col, 1)


def read(d, n):
    im = cv2.imread(os.path.join(d, n + ".png"))
    if im is None:
        im = np.full((1080, 1920, 3), 40, np.uint8)
        put(im, "MISSING " + n, (40, 540), 1.2, (0, 0, 255))
    return im


mode = sys.argv[1]
if mode == "half":
    d, od = os.path.join(W, sys.argv[2]), sys.argv[3]
    per = int(sys.argv[4]) if len(sys.argv) > 4 else 6
    os.makedirs(od, exist_ok=True)
    for k in range(0, len(names), per):
        part = []
        for i, n in enumerate(names[k:k + per]):
            t = cv2.resize(read(d, n), (960, 540), interpolation=cv2.INTER_AREA)
            put(t, "%d %s" % (k + i + 1, n))
            part.append(t)
        while len(part) % 2:
            part.append(np.full((540, 960, 3), 30, np.uint8))
        rows = [np.concatenate(part[i:i + 2], axis=1) for i in range(0, len(part), 2)]
        o = os.path.join(od, "half_%02d.jpg" % (k // per + 1))
        cv2.imwrite(o, np.concatenate(rows, axis=0), [cv2.IMWRITE_JPEG_QUALITY, 90])
        print("SHEET", o, flush=True)
elif mode == "windows":
    d, od = os.path.join(W, sys.argv[2]), sys.argv[3]
    os.makedirs(od, exist_ok=True)
    tiles = []
    for n in names:
        jp = os.path.join(W, "win6", n + ".w5.json")
        if not os.path.exists(jp):
            continue
        ws = json.load(open(jp))["windows"]
        if not ws:
            continue
        im = read(d, n)
        H, Wd = im.shape[:2]
        # windows close together are cropped together
        boxes = [[max(0, w["box"][0] - 16), max(0, w["box"][1] - 16), min(Wd, w["box"][2] + 16), min(H, w["box"][3] + 16), [w["id"]], w["cls"][0]] for w in ws]
        merged = True
        while merged:
            merged = False
            for i in range(len(boxes)):
                for j in range(i + 1, len(boxes)):
                    a, b = boxes[i], boxes[j]
                    if a[0] <= b[2] + 8 and b[0] <= a[2] + 8 and a[1] <= b[3] + 8 and b[1] <= a[3] + 8:
                        boxes[i] = [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]), a[4] + b[4], a[5] + b[5]]
                        del boxes[j]
                        merged = True
                        break
                if merged:
                    break
        for b in boxes:
            c = im[b[1]:b[3], b[0]:b[2]]
            k = min(1.0, 900.0 / c.shape[1], 620.0 / c.shape[0])
            if min(c.shape[:2]) < 60:                      # (a far little window: enlarged, or nothing could be seen)
                k = min(3.0, 90.0 / max(min(c.shape[:2]), 1))
            if k != 1.0:
                c = cv2.resize(c, None, fx=k, fy=k, interpolation=cv2.INTER_AREA if k < 1 else cv2.INTER_CUBIC)
            lab = np.full((16, max(c.shape[1], 40), 3), 25, np.uint8)
            cv2.putText(lab, ("%s #%s x%.1f" % (n, ",".join(str(v) for v in b[4][:4]), k))[:max(6, lab.shape[1] // 6)], (2, 12), cv2.FONT_HERSHEY_SIMPLEX, 0.36, (200, 255, 255), 1)
            if c.shape[1] < lab.shape[1]:
                c = np.concatenate([c, np.full((c.shape[0], lab.shape[1] - c.shape[1], 3), 25, np.uint8)], 1)
            tiles.append(np.concatenate([lab, c], 0))
    # shelf packing, sheets of at most 1900 x 1300
    sheets, rows, cur, cw, rh, th = [], [], [], 0, 0, 0
    for t in tiles:
        if cur and cw + t.shape[1] + 4 > 1900:
            rows.append((cur, rh))
            th += rh + 4
            cur, cw, rh = [], 0, 0
        if rows and th + max(rh, t.shape[0]) > 1300:
            sheets.append(rows)
            rows, th = [], 0
        cur.append(t)
        cw += t.shape[1] + 4
        rh = max(rh, t.shape[0])
    if cur:
        rows.append((cur, rh))
    if rows:
        sheets.append(rows)
    for si, rows in enumerate(sheets, 1):
        out = []
        for cur, rh in rows:
            line = []
            for t in cur:
                line.append(np.concatenate([t, np.full((rh - t.shape[0], t.shape[1], 3), 25, np.uint8)], 0))
                line.append(np.full((rh, 4, 3), 25, np.uint8))
            line = np.concatenate(line, 1)
            out.append(np.concatenate([line, np.full((rh, max(0, 1900 - line.shape[1]), 3), 25, np.uint8)], 1)[:, :1900])
            out.append(np.full((4, 1900, 3), 25, np.uint8))
        o = os.path.join(od, "win_%02d.jpg" % si)
        cv2.imwrite(o, np.concatenate(out, 0), [cv2.IMWRITE_JPEG_QUALITY, 92])
        print("SHEET", o, len(rows), "rows", flush=True)
elif mode == "critic":
    dn, dt, od = os.path.join(W, sys.argv[2]), os.path.join(W, sys.argv[3]), sys.argv[4]
    os.makedirs(od, exist_ok=True)
    for i, n in enumerate(names, 1):
        night = read(dn, n)
        put(night, "%d  %s   NIGHT (full size)" % (i, n), (8, 24), 0.7)
        day = cv2.resize(cv2.imread(os.path.join(G, n + ".png")), (960, 540), interpolation=cv2.INTER_AREA)
        put(day, "the game's DAY picture (half size, for reference)")
        tw = cv2.resize(read(dt, n), (960, 540), interpolation=cv2.INTER_AREA)
        put(tw, "SUNSET / SUNRISE (half size)")
        o = os.path.join(od, "%03d %s.jpg" % (i, n))
        cv2.imwrite(o, np.concatenate([night, np.concatenate([day, tw], 1)], 0), [cv2.IMWRITE_JPEG_QUALITY, 93])
    print("CRITIC SHEETS", len(names), "in", od, flush=True)
