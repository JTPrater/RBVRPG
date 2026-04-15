"""
Match unedited Roblox screenshots to named in-game room images.
Strategy: Resize both to small thumbnails, crop center region (avoids text overlays),
compute cosine similarity for matching.
Excludes non-Roblox images (b-deck cabins like b49.png, etc.) which need manual replacement.
"""

import os
import sys
import json
import re
import shutil
from pathlib import Path
from PIL import Image
import numpy as np

# Paths
ORIGINALS_DIR = Path(r"C:\Users\JTP20\OneDrive\Pictures\Roblox\britannic room pics (unedited)")
INGAME_DIR = Path(r"C:\Users\JTP20\OneDrive\Desktop\RBVRPG\public\images\animations\locations\britannic")
REPORT_FILE = Path(r"C:\Users\JTP20\OneDrive\Desktop\RBVRPG\image_match_report.json")

THUMB_SIZE = (128, 128)

# Skip these in-game files (not Roblox screenshots, need manual replacement)
SKIP_PATTERN = re.compile(r'^b\d+\.png$', re.IGNORECASE)

def get_features(img_path):
    """Get feature vector: center-cropped resized thumbnail as numpy array."""
    try:
        img = Image.open(img_path).convert('RGB')
        w, h = img.size
        # Crop center 60% to avoid text overlays at edges
        cx, cy = int(w * 0.2), int(h * 0.25)
        cw, ch = int(w * 0.6), int(h * 0.5)
        cropped = img.crop((cx, cy, cx + cw, cy + ch))
        thumb = cropped.resize(THUMB_SIZE, Image.LANCZOS)
        pixels = np.array(thumb, dtype=np.float32).flatten()
        pixels = pixels / 255.0
        return pixels
    except Exception as e:
        print(f"  ERROR processing {img_path.name}: {e}")
        return None

def similarity(feat1, feat2):
    """Cosine similarity between two feature vectors."""
    dot = np.dot(feat1, feat2)
    norm1 = np.linalg.norm(feat1)
    norm2 = np.linalg.norm(feat2)
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return float(dot / (norm1 * norm2))

def main():
    print("=== Image Matching Tool ===\n")

    # 1. Hash all originals
    print(f"Hashing originals from: {ORIGINALS_DIR}")
    orig_files = sorted(ORIGINALS_DIR.glob("*"))
    orig_files = [f for f in orig_files if f.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp')]
    print(f"  Found {len(orig_files)} original images")

    orig_hashes = {}
    for i, f in enumerate(orig_files):
        if (i + 1) % 50 == 0:
            print(f"  Processed {i + 1}/{len(orig_files)}...")
        feat = get_features(f)
        if feat is not None:
            orig_hashes[f.name] = (feat, f)

    print(f"  Successfully processed {len(orig_hashes)} originals\n")

    # 2. Process all in-game images (skip non-Roblox ones)
    print(f"Processing in-game images from: {INGAME_DIR}")
    ingame_files = sorted(INGAME_DIR.glob("*"))
    ingame_files = [f for f in ingame_files if f.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp')]
    
    skipped = [f for f in ingame_files if SKIP_PATTERN.match(f.name)]
    ingame_files = [f for f in ingame_files if not SKIP_PATTERN.match(f.name)]
    print(f"  Found {len(ingame_files)} in-game images ({len(skipped)} skipped as non-Roblox)")
    if skipped:
        print(f"  Skipped: {', '.join(f.name for f in skipped[:5])}{'...' if len(skipped) > 5 else ''}")

    ingame_hashes = {}
    for i, f in enumerate(ingame_files):
        if (i + 1) % 50 == 0:
            print(f"  Processed {i + 1}/{len(ingame_files)}...")
        feat = get_features(f)
        if feat is not None:
            ingame_hashes[f.name] = (feat, f)

    print(f"  Successfully processed {len(ingame_hashes)} in-game images\n")

    # 3. Match each in-game image to the closest original
    print("Matching (this may take a minute)...")
    used_originals = set()

    # Pre-compute all similarities
    match_candidates = []
    for ig_name, (ig_feat, ig_path) in ingame_hashes.items():
        best_sim = -1.0
        best_orig = None
        for orig_name, (orig_feat, orig_path) in orig_hashes.items():
            sim = similarity(ig_feat, orig_feat)
            if sim > best_sim:
                best_sim = sim
                best_orig = orig_name

        match_candidates.append({
            'ingame_name': ig_name,
            'ingame_path': str(ig_path),
            'best_orig': best_orig,
            'orig_path': str(orig_hashes[best_orig][1]) if best_orig else None,
            'similarity': best_sim,
        })

    # Sort by similarity (best matches first) and assign greedily
    match_candidates.sort(key=lambda x: -x['similarity'])

    final_matches = []
    unmatched_ingame = []

    for m in match_candidates:
        if m['best_orig'] not in used_originals:
            used_originals.add(m['best_orig'])
            m['status'] = 'matched'
            final_matches.append(m)
        else:
            # Re-find best unused original
            ig_feat = ingame_hashes[m['ingame_name']][0]
            best_sim = -1.0
            best_orig = None
            for orig_name, (orig_feat, orig_path) in orig_hashes.items():
                if orig_name not in used_originals:
                    sim = similarity(ig_feat, orig_feat)
                    if sim > best_sim:
                        best_sim = sim
                        best_orig = orig_name
            if best_orig:
                used_originals.add(best_orig)
                m['best_orig'] = best_orig
                m['orig_path'] = str(orig_hashes[best_orig][1])
                m['similarity'] = best_sim
                m['status'] = 'matched (2nd choice)'
                final_matches.append(m)
            else:
                m['status'] = 'unmatched'
                unmatched_ingame.append(m)

    # Sort final matches by in-game name for readability
    final_matches.sort(key=lambda x: x['ingame_name'])

    # 4. Report
    print(f"\n=== RESULTS ===")
    print(f"Matched: {len(final_matches)}")
    print(f"Unmatched in-game: {len(unmatched_ingame)}")
    print(f"Unused originals: {len(orig_hashes) - len(used_originals)}")

    # Confidence breakdown (cosine similarity: 1.0 = identical, 0.0 = unrelated)
    excellent = sum(1 for m in final_matches if m['similarity'] >= 0.95)
    good = sum(1 for m in final_matches if 0.90 <= m['similarity'] < 0.95)
    fair = sum(1 for m in final_matches if 0.80 <= m['similarity'] < 0.90)
    poor = sum(1 for m in final_matches if m['similarity'] < 0.80)

    print(f"\nConfidence breakdown:")
    print(f"  Excellent (>= 0.95): {excellent}")
    print(f"  Good (0.90-0.95):    {good}")
    print(f"  Fair (0.80-0.90):    {fair}")
    print(f"  Poor (< 0.80):       {poor}")

    # Show poor matches for review
    if poor > 0:
        print(f"\n--- POOR MATCHES (review these!) ---")
        for m in sorted(final_matches, key=lambda x: x['similarity']):
            if m['similarity'] < 0.80:
                print(f"  {m['ingame_name']} -> {m['best_orig']} (sim={m['similarity']:.3f})")
    
    # Show skipped files reminder
    if skipped:
        print(f"\n--- SKIPPED (manual replacement needed) ---")
        for f in skipped:
            print(f"  {f.name}")

    # Save full report
    report = {
        'matches': final_matches,
        'unmatched': unmatched_ingame,
        'unused_originals': sorted(set(orig_hashes.keys()) - used_originals),
    }

    with open(REPORT_FILE, 'w') as f:
        json.dump(report, f, indent=2)

    print(f"\nFull report saved to: {REPORT_FILE}")
    print("Review the report, then run with --apply to replace images.")

    # 5. Apply if requested
    if '--apply' in sys.argv:
        MIN_SIM = 0.80  # Only replace matches with >= 80% similarity
        print(f"\n=== APPLYING REPLACEMENTS (similarity >= {MIN_SIM}) ===")
        backup_dir = INGAME_DIR / '_backup'
        backup_dir.mkdir(exist_ok=True)

        replaced = 0
        skipped_low = []
        for m in final_matches:
            if m['similarity'] < MIN_SIM:
                skipped_low.append(m)
                continue

            ig_path = Path(m['ingame_path'])
            orig_path = Path(m['orig_path'])

            # Backup original in-game image
            backup_path = backup_dir / ig_path.name
            if not backup_path.exists():
                shutil.copy2(ig_path, backup_path)

            # Copy the unedited original, keeping the in-game filename
            try:
                orig_img = Image.open(orig_path)
                ig_ext = ig_path.suffix.lower()
                if ig_ext in ('.jpg', '.jpeg'):
                    orig_img.save(ig_path, 'JPEG', quality=95)
                elif ig_ext == '.png':
                    orig_img.save(ig_path, 'PNG')
                elif ig_ext == '.webp':
                    orig_img.save(ig_path, 'WEBP', quality=95)
                replaced += 1
            except Exception as e:
                print(f"  ERROR replacing {ig_path.name}: {e}")

        print(f"\nReplaced {replaced} images. Backups in: {backup_dir}")
        if skipped_low:
            print(f"Skipped {len(skipped_low)} low-confidence matches (still have text overlays):")
            for m in skipped_low:
                print(f"  {m['ingame_name']} (sim={m['similarity']:.3f})")


if __name__ == '__main__':
    main()
