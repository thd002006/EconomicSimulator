#!/usr/bin/env python3
"""
Generate Sentinel-2 L2A PNG images for all provinces.
- Find tile via STAC intersects (point) on province centroid
- Sample window centered on province centroid pixel
- If coverage <95%, offset window in 8 directions to find better area
- Cache tiles by province id; skip already-processed
"""

import json
import os
import time
import sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

import requests
import rasterio
from rasterio.errors import RasterioIOError
import numpy as np
from PIL import Image
from rasterio.windows import Window
from pyproj import Transformer
from shapely.geometry import shape
from tqdm import tqdm

REPO_ROOT = Path(__file__).resolve().parents[1]
PROVINCES_PATH = REPO_ROOT / 'mapdata-generator/base/world-admin1/geometry/provinces.geojson'
OUTPUT_DIR = REPO_ROOT / 'assets/provincePics'
TILE_CACHE_DIR = Path(r'C:\Files\Provincetales')
STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
TILE_CACHE_DIR.mkdir(parents=True, exist_ok=True)

TARGET_W, TARGET_H = 800, 400
BATCH_SIZE = 200
CLOUD_MAX = 50
MAX_WORKERS = 4
COVERAGE_THRESHOLD = 0.95      # trigger offset if below this
OFFSET_STEP = 64               # pixels per offset step
MAX_OFFSET = 200               # max offset in pixels from centroid
HARD_FAIL_COVERAGE = 0.50      # below this even after offsets => mark failed

print_lock = Lock()
results = {'ok': 0, 'skipped': 0, 'failed': 0, 'cached': 0, 'offset_used': 0}
errors_list = []


def log(msg):
    with print_lock:
        print(msg, flush=True)


def get_signed_url(href):
    sr = requests.get(
        "https://planetarycomputer.microsoft.com/api/sas/v1/sign",
        params={"href": href},
        timeout=30
    )
    if sr.status_code == 200:
        return sr.json()['href']
    return None


def download_tile(url, dest_path):
    """Stream download tile to disk."""
    with requests.get(url, stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(dest_path, 'wb') as f:
            for chunk in r.iter_content(chunk_size=1024 * 1024):
                f.write(chunk)
    return dest_path.stat().st_size


def coverage_ratio(arr2d):
    """Fraction of pixels with any value > 0 (non-nodata)."""
    return float(np.count_nonzero(arr2d)) / arr2d.size


def ensure_valid_tile(tile_path, signed_url):
    """Return an open rasterio dataset, re-downloading a corrupt/truncated tile once."""
    for attempt in range(2):
        try:
            return rasterio.open(tile_path)
        except RasterioIOError:
            if tile_path.exists():
                tile_path.unlink()
            if attempt == 0:
                download_tile(signed_url, tile_path)
                continue
            raise


def best_window(src, center_col, center_row):
    """
    Try a window centered on (center_col, center_row). If coverage < threshold,
    try offsetting the window in 8 directions. Return (img, coverage, used_offset)
    or (None, best_cov, None) if all attempts are unusable.
    """
    best_img = None
    best_cov = -1.0
    best_offset = (0, 0)
    w, h = src.width, src.height

    def try_window(col_off, row_off):
        # clamp so window stays inside raster
        col_off = max(0, min(col_off, max(0, w - TARGET_W)))
        row_off = max(0, min(row_off, max(0, h - TARGET_H)))
        window = Window(col_off, row_off, TARGET_W, TARGET_H)
        data = src.read(window=window)  # (3, 400, 800)
        cov = coverage_ratio(data[1])   # use green band as proxy
        return data, cov, (col_off, row_off)

    # 1) center attempt
    init_col = max(0, center_col - TARGET_W // 2)
    init_row = max(0, center_row - TARGET_H // 2)
    data, cov, off = try_window(init_col, init_row)
    best_img, best_cov, best_offset = data, cov, (0, 0)
    if cov >= COVERAGE_THRESHOLD:
        return data, cov, (0, 0)

    # 2) offset attempts in 8 directions at increasing step
    directions = [
        (1, 0), (-1, 0), (0, 1), (0, -1),
        (1, 1), (1, -1), (-1, 1), (-1, -1),
    ]
    for step in range(OFFSET_STEP, MAX_OFFSET + 1, OFFSET_STEP):
        for dx, dy in directions:
            col = init_col + dx * step
            row = init_row + dy * step
            data, cov, _ = try_window(col, row)
            if cov > best_cov:
                best_img = data
                best_cov = cov
                best_offset = (dx * step, dy * step)
            if cov >= COVERAGE_THRESHOLD:
                return data, cov, (dx * step, dy * step)

    return best_img, best_cov, best_offset


def process_province(prov):
    pid = prov['id']
    lat = prov['lat']
    lon = prov['lon']
    output_path = OUTPUT_DIR / f"{pid}.png"
    tile_path = TILE_CACHE_DIR / f"{pid}.tif"

    if output_path.exists() and output_path.stat().st_size > 1000:
        results['skipped'] += 1
        return pid, 'skipped'

    try:
        # 1. STAC intersects on centroid point
        params = {
            "collections": ["sentinel-2-l2a"],
            "intersects": {"type": "Point", "coordinates": [lon, lat]},
            "query": {"eo:cloud_cover": {"lt": CLOUD_MAX}},
            "limit": 5
        }
        r = requests.post(f"{STAC_URL}/search", json=params, timeout=30)
        if r.status_code != 200:
            results['failed'] += 1
            return pid, f'stac_{r.status_code}'

        items = r.json().get('features', [])
        if not items:
            results['failed'] += 1
            return pid, 'no_tile'

        items.sort(key=lambda x: x.get('properties', {}).get('eo:cloud_cover', 100))
        item = items[0]

        # Use the visual band (10m, pre-composed RGB, single file)
        visual_href = item['assets'].get('visual', {}).get('href')
        if not visual_href:
            results['failed'] += 1
            return pid, 'no_visual'
        epsg = item['properties'].get('proj:epsg', 4326)

        # 2. Sign URL
        signed_url = get_signed_url(visual_href)
        if not signed_url:
            results['failed'] += 1
            return pid, 'sign_failed'

        # 3. Download tile to disk (skip if cached)
        if not tile_path.exists() or tile_path.stat().st_size < 1000:
            download_tile(signed_url, tile_path)
        results['cached'] += 1

        # 4. Open tile and sample at centroid pixel, with offset fallback
        with ensure_valid_tile(tile_path, signed_url) as src:
            transformer = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
            utm_x, utm_y = transformer.transform(lon, lat)
            cc, cr = src.index(utm_x, utm_y)
            cc = max(0, min(cc, src.width - 1))
            cr = max(0, min(cr, src.height - 1))

            data, cov, offset = best_window(src, cc, cr)
            if data is None:
                results['failed'] += 1
                errors_list.append((pid, 'no data anywhere'))
                return pid, 'no_data'
            if offset != (0, 0):
                results['offset_used'] += 1

        img = np.transpose(data, (1, 2, 0))
        if img.shape[2] == 4:
            img = img[:, :, :3]

        # Hard fail if even best is unusable
        if cov < HARD_FAIL_COVERAGE:
            if output_path.exists():
                output_path.unlink()
            results['failed'] += 1
            errors_list.append((pid, f'low coverage {cov*100:.0f}%'))
            return pid, f'low_cov_{int(cov*100)}pct'

        pil_img = Image.fromarray(img)
        pil_img.save(output_path, 'PNG', optimize=True)
        results['ok'] += 1
        return pid, f'ok_cov{int(cov*100)}_off{offset}'

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        results['failed'] += 1
        errors_list.append((pid, f'{e}\n{tb[-200:]}'))
        return pid, f'error: {e}'


def main():
    print("Loading provinces...", flush=True)
    with open(PROVINCES_PATH, 'rb') as f:
        raw = f.read()
    data = json.loads(raw.decode('utf-8-sig'))

    provinces = []
    for idx, feat in enumerate(data['features']):
        props = feat['properties']
        geom = feat['geometry']
        if geom['type'] not in ('Polygon', 'MultiPolygon'):
            continue
        try:
            sg = shape(geom)
            if not sg.is_valid:
                sg = sg.buffer(0)
            centroid = sg.centroid
            if centroid.is_empty:
                continue
        except Exception:
            continue

        name = props.get('name', props.get('nameEn', f'p{idx}'))
        adm0 = props.get('adm0A3', 'UNK')
        safe = "".join(c if c.isalnum() else '_' for c in name)
        pid = f"{adm0}_{safe}"
        provinces.append({
            'id': pid,
            'name': name,
            'adm0A3': adm0,
            'lat': round(centroid.y, 6),
            'lon': round(centroid.x, 6)
        })

    print(f"Total provinces: {len(provinces)}", flush=True)
    print(f"Output: {OUTPUT_DIR}", flush=True)
    print(f"Tile cache: {TILE_CACHE_DIR}", flush=True)
    print(f"Workers: {MAX_WORKERS}", flush=True)
    print(f"Coverage threshold: {COVERAGE_THRESHOLD*100:.0f}%, max offset: {MAX_OFFSET}px, step: {OFFSET_STEP}px", flush=True)

    test_count = int(os.environ.get('TEST_COUNT', '0'))
    if test_count > 0:
        provinces = provinces[:test_count]
        print(f"TEST MODE: processing first {test_count} provinces", flush=True)

    def is_done(p):
        op = OUTPUT_DIR / f"{p['id']}.png"
        return op.exists() and op.stat().st_size > 1000

    incomplete = [p for p in provinces if not is_done(p)]
    print(f"Remaining (no png yet): {len(incomplete)}", flush=True)
    batch = incomplete[:BATCH_SIZE]
    if not batch:
        print("All provinces already processed.", flush=True)
        return
    print(f"Processing batch of {len(batch)} (limit {BATCH_SIZE})", flush=True)

    start = time.time()
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(process_province, p): p for p in batch}
        for future in tqdm(as_completed(futures), total=len(futures), desc="Processing", file=sys.stdout):
            pid, status = future.result()
            if status not in ('ok', 'skipped') and not status.startswith('ok_cov'):
                if len(errors_list) <= 20:
                    log(f"  [{pid}] {status}")

    elapsed = time.time() - start
    print(f"\n{'='*60}", flush=True)
    print(f"Done in {elapsed:.1f}s ({elapsed/60:.1f}min)", flush=True)
    print(f"  OK:           {results['ok']}", flush=True)
    print(f"  Skipped:      {results['skipped']}", flush=True)
    print(f"  Failed:       {results['failed']}", flush=True)
    print(f"  Tiles cached: {results['cached']}", flush=True)
    print(f"  Offset used:  {results['offset_used']}", flush=True)
    if errors_list:
        print(f"\nErrors (first 20):", flush=True)
        for pid, err in errors_list[:20]:
            print(f"  [{pid}] {err}", flush=True)


if __name__ == '__main__':
    main()
