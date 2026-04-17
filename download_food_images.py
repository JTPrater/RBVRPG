"""Download food/drink/tobacco images from CDN into organized folders."""
import json, os, urllib.request, ssl
from pathlib import Path

ROOT = Path(__file__).parent
DATA = ROOT / 'models' / 'repository_food 14-4-2026.php'
BASE_URL = 'https://titanicvoyage-images.b-cdn.net/game/food/'

FOLDERS = {
    0: ROOT / 'public' / 'images' / 'game' / 'menu' / 'food',
    1: ROOT / 'public' / 'images' / 'game' / 'menu' / 'drink',
    2: ROOT / 'public' / 'images' / 'game' / 'menu' / 'drink',
    3: ROOT / 'public' / 'images' / 'game' / 'menu' / 'tobacco',
}

# Create folders
for folder in set(FOLDERS.values()):
    folder.mkdir(parents=True, exist_ok=True)

items = json.loads(DATA.read_text(encoding='utf-8')).get('food', [])

# Deduplicate by (type_folder, image_name)
seen = set()
download_list = []
for item in items:
    img = item.get('image', '')
    t = item.get('type')
    if not img or t not in FOLDERS:
        continue
    folder = FOLDERS[t]
    key = (str(folder), img)
    if key not in seen:
        seen.add(key)
        download_list.append((folder, img))

print(f"Downloading {len(download_list)} unique images...")

ctx = ssl.create_default_context()
success = 0
failed = []

for i, (folder, filename) in enumerate(download_list):
    dest = folder / filename
    if dest.exists():
        success += 1
        continue
    url = BASE_URL + urllib.request.quote(filename, safe='')
    try:
        urllib.request.urlretrieve(url, str(dest))
        success += 1
    except Exception as e:
        failed.append((filename, str(e)))
    if (i + 1) % 50 == 0:
        print(f"  Progress: {i + 1}/{len(download_list)}")

print(f"\nDone! {success} downloaded, {len(failed)} failed.")
if failed:
    print("Failed:")
    for name, err in failed:
        print(f"  {name}: {err}")
