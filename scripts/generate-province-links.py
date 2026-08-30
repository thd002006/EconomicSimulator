#!/usr/bin/env python3
"""Generate all download links for provinces."""

import json
import requests
from pathlib import Path
from shapely.geometry import shape

REPO_ROOT = Path(__file__).resolve().parents[1]
PROVINCES_PATH = REPO_ROOT / 'mapdata-generator/base/world-admin1/geometry/provinces.geojson'
OUTPUT_FILE = REPO_ROOT / 'province_download_links.json'

STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"

def get_tile_info(lat, lon, idx):
    """Find Sentinel-2 L2A tile for lat/lon via STAC search."""
    west, east = lon - 0.1, lon + 0.1
    south, north = lat - 0.1, lat + 0.1

    params = {
        "collections": ["sentinel-2-l2a"],
        "bbox": [west, south, east, north],
        "query": {"eo:cloud_cover": {"lt": 50}},
        "limit": 3
    }

    try:
        response = requests.post(f"{STAC_URL}/search", json=params, timeout=30)
        if response.status_code != 200:
            return None

        items = response.json().get('features', [])
        if not items:
            return None

        # Sort by cloud cover
        items.sort(key=lambda x: x.get('properties', {}).get('eo:cloud_cover', 100))
        item = items[0]

        # Get visual href
        visual_href = item.get('assets', {}).get('visual', {}).get('href')
        if not visual_href:
            return None

        # Sign the URL
        signed = requests.get(
            "https://planetarycomputer.microsoft.com/api/sas/v1/sign",
            params={"href": visual_href},
            timeout=30
        )
        if signed.status_code != 200:
            return None

        signed_url = signed.json().get("href")
        return {
            'tile_id': item['id'],
            'datetime': item['properties'].get('datetime'),
            'cloud_cover': item['properties'].get('eo:cloud_cover'),
            'download_url': signed_url
        }
    except Exception as e:
        return {'error': str(e)}


def main():
    print("Loading provinces...")
    with open(PROVINCES_PATH, 'rb') as f:
        raw = f.read()
    data = json.loads(raw.decode('utf-8-sig'))

    provinces = []
    for idx, feat in enumerate(data['features']):
        props = feat['properties']
        geom = feat['geometry']
        if geom['type'] in ('Polygon', 'MultiPolygon'):
            try:
                shapely_geom = shape(geom)
                if not shapely_geom.is_valid:
                    shapely_geom = shapely_geom.buffer(0)
                centroid = shapely_geom.centroid

                # Check if centroid is valid
                if centroid.is_empty:
                    raise ValueError("Empty centroid")

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
            except Exception as e:
                # Skip problematic geometries
                name = props.get('name', props.get('nameEn', f'p{idx}'))
                print(f"  Skipping [{name}]: {e}")
                continue

    print(f"Total provinces: {len(provinces)}")
    print("Generating download links...")

    results = []
    for i, prov in enumerate(provinces):
        if i % 50 == 0:
            print(f"  Progress: {i}/{len(provinces)}")

        tile_info = get_tile_info(prov['lat'], prov['lon'], i)
        result = {
            'province_id': prov['id'],
            'name': prov['name'],
            'adm0A3': prov['adm0A3'],
            'lat': prov['lat'],
            'lon': prov['lon'],
            'tile': tile_info
        }
        results.append(result)

    print(f"Completed {len(results)} provinces")
    print(f"Writing to {OUTPUT_FILE}...")

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump({
            'total': len(results),
            'provinces': results
        }, f, ensure_ascii=False, indent=2)

    print(f"Done! Links saved to {OUTPUT_FILE}")

    # Summary
    success = sum(1 for r in results if r['tile'] and 'download_url' in r['tile'])
    failed = len(results) - success
    print(f"\nSummary: {success} success, {failed} failed")

    if failed > 0:
        errors = [r for r in results if r['tile'] and 'error' in r['tile']]
        if errors:
            print(f"First 5 errors:")
            for e in errors[:5]:
                print(f"  [{e['province_id']}] {e['tile']['error']}")


if __name__ == '__main__':
    main()
