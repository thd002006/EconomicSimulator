#!/usr/bin/env python3
"""
Generate province-descriptions.json for all 1287 world-modern provinces.
- English
- Body ≤100 chars (strict), prefix extra (fixed template, English names)
- Fixed template: "Merged from A, B and C. " or "Merged from A and B. " etc.
- Uses Natural Earth source names for member English names.
"""
import json, pathlib, hashlib, re

REPO = pathlib.Path(r"D:\godot project\EconomicSimulator")
CACHE = REPO / "mapdata-generator/cache/natural-earth/ne_10m_admin_1_states_provinces_lakes.geojson"
PROV_GEO = REPO / "assets/maps/world-modern/geometry/provinces.geojson"
REVIEW = REPO / "mapdata-generator/output/world-modern/review-report.json"
COUNTRIES = REPO / "assets/maps/world-modern/countries.csv"
OUT1 = REPO / "mapdata-generator/data/province-descriptions.json"
OUT2 = REPO / "mapdata-generator/output/world-modern/province-descriptions.json"

# Build source id -> nameEn mapping (iso, adm1_code, ne-id)
source_map = {}
cache_data = json.loads(CACHE.read_text(encoding="utf-8"))
for f in cache_data["features"]:
    props = f["properties"]
    name_en = props.get("name_en") or props.get("name") or ""
    for key in ["iso_3166_2", "adm1_code"]:
        v = props.get(key)
        if v and isinstance(v, str) and v.strip():
            source_map[v.strip()] = name_en
    ne = props.get("ne_id")
    if ne is not None:
        source_map[f"ne-{ne}"] = name_en
        source_map[str(ne)] = name_en

# Also map with NE prefix handling: review uses "ne-115931..." already
# Ensure lower/upper agnostic? keep as is

countries_data = {}
for line in COUNTRIES.read_text(encoding="utf-8").splitlines()[1:]:
    if not line.strip():
        continue
    parts = line.split(",", 2)
    if len(parts) < 2:
        continue
    country_id, name_en = parts[0], parts[1]
    countries_data[country_id] = {"nameEn": name_en}
prov_geo = json.loads(PROV_GEO.read_text(encoding="utf-8"))
review_data = json.loads(REVIEW.read_text(encoding="utf-8"))

# Build review lookup
review_by_id = {p["id"]: p for p in review_data["provinces"]}
# Build province geo lookup
geo_by_id = {f["id"]: f for f in prov_geo["features"]}

# Knowledge snippets per country/region for body generation
# Body must be <=100 chars. We craft concise 70-95 char sentences.
# We will tailor to give geographic realism per country using simple rules.

# Country-specific context hints
COUNTRY_HINTS = {
    "EGY": "Nile valley and desert fringe",
    "DZA": "Saharan and Mediterranean fringe",
    "MAR": "Atlas and Atlantic coast",
    "LBY": "Mediterranean coast and desert interior",
    "SDN": "Nile-Sahel savanna and desert",
    "ETH": "Highlands and Rift Valley",
    "KEN": "Savanna and Great Rift highlands",
    "ZAF": "Plateau and coastal lowlands",
    "NGA": "Savanna, Niger Delta and coast",
    "USA": "temperate plains and urban corridors",
    "CAN": "boreal forest and prairie",
    "MEX": "plateau and tropical lowlands",
    "BRA": "Amazon basin and Atlantic coast",
    "ARG": "Pampas and Andean foothills",
    "CHN": "monsoon plains and highlands",
    "IND": "monsoon plains and Deccan plateau",
    "RUS": "boreal forest and steppe",
    "AUS": "arid outback and coastal fringe",
    "FRA": "temperate lowlands and uplands",
    "DEU": "Central European lowlands and uplands",
    "GBR": "temperate maritime lowlands",
    "JPN": "mountainous archipelago and coastal plains",
    "KOR": "mountainous peninsula and coastal plains",
    "SAU": "desert plateau and Red Sea coast",
    "ARE": "desert coast and oasis towns",
    "TUR": "Anatolian plateau and coasts",
    "IRN": "plateau, mountains and desert basins",
    "ISR": "Mediterranean coast and hill country",
    "ESP": "Meseta and Mediterranean coast",
    "ITA": "Alpine north and Mediterranean south",
    "NOR": "fjords and boreal uplands",
    "SWE": "boreal forest and Baltic coast",
    "FIN": "lake district and boreal forest",
    "POL": "Central European plains",
    "GRC": "mountains and Aegean islands",
    "NLD": "low-lying delta and coast",
    "BEL": "lowland plains and industrial belt",
    "CHE": "Alpine and plateau",
    "AUT": "Alpine and Danube valley",
    "NZL": "volcanic highlands and coasts",
    "IDN": "tropical archipelago and rainforest",
    "PHL": "tropical archipelago and rice plains",
    "THA": "tropical plains and uplands",
    "VNM": "Red River/Mekong deltas and uplands",
    "BGD": "Ganges delta and floodplains",
    "PAK": "Indus plain and uplands",
    "AFG": "Hindu Kush highlands and valleys",
    "IRL": "temperate maritime greenfields",
    "PRT": "Atlantic coast and hill country",
    "CZE": "Bohemian basin and highlands",
    "UKR": "steppe and forest-steppe",
    "BLR": "forest and marsh lowlands",
    "KAZ": "steppe and semi-desert",
    "MNG": "steppe and Gobi desert",
    "PER": "Andes and Pacific desert coast",
    "CHL": "Andes, desert north and temperate south",
    "COL": "Andes and Caribbean/lowland plains",
    "VEN": "Orinoco basin and Caribbean coast",
    "NZL": "temperate maritime hills and coasts",
}

# Generic economy tags per country development
ECON_POOL = [
    "farming and market towns",
    "services and light industry",
    "tourism and fishing",
    "mining and energy",
    "port trade and logistics",
    "smallholder farming and markets",
    "pastoral herding and oasis farming",
    "industrial and service hub",
    "agriculture and food processing",
    "forestry and highland farming",
]

# Special body overrides for well-known manually-named provinces
SPECIAL = {
    "EGY-CAIRO": "Dense Nile conurbation around Cairo, core of national administration and industry.",
    "EGY-DELTA": "Fertile Nile Delta farmland, dense agrarian towns and food processing.",
    "EGY-SINAI": "Arid Sinai peninsula linking Africa and Asia, with tourism and minerals.",
    "EGY-CANAL": "Suez Canal corridor, world shipping artery with port logistics.",
    "EGY-UPPER": "Upper Nile valley with ancient towns, irrigated farming and stone quarries.",
    "CLP": None, # will be island
    "ATA": "Antarctic ice sheet, research stations only, no permanent population.",
}

def english_name_for_member(member_id: str) -> str:
    if member_id in source_map and source_map[member_id]:
        return source_map[member_id]
    # try without prefix variations
    if member_id.startswith("ne-"):
        nid = member_id[3:]
        if nid in source_map:
            return source_map[nid]
    return member_id  # fallback to ID itself (still English-ish)

def make_prefix(members):
    if len(members) <= 1:
        return ""
    # Resolve English names, deduplicate preserve order then sort alphabetically for determinism?
    names = [english_name_for_member(m) for m in members]
    # Deduplicate keeping first
    seen=set()
    uniq=[]
    for n in names:
        if n not in seen:
            seen.add(n)
            uniq.append(n)
    # Sort alphabetically for stability, but keep original order for readability? Use sorted
    uniq_sorted = sorted(uniq)
    if len(uniq_sorted) <= 5:
        if len(uniq_sorted)==2:
            body = f"{uniq_sorted[0]} and {uniq_sorted[1]}"
        else:
            body = ", ".join(uniq_sorted[:-1]) + f" and {uniq_sorted[-1]}"
        return f"Merged from {body}."
    else:
        # Truncate
        first3 = uniq_sorted[:3]
        others = len(uniq_sorted)-3
        body = ", ".join(first3) + f" and {others} others"
        return f"Merged from {body}."

def craft_body(province_id, props, review_entry):
    # Check special
    if province_id in SPECIAL and SPECIAL[province_id] is not None:
        return SPECIAL[province_id]
    adm = props.get("adm0A3","")
    raw_name = props.get("nameEn") or props.get("name") or province_id
    # Shorten overly long joined names
    if len(raw_name) > 35 and "–" in raw_name:
        # prefer review's short grouping hint if available, else first segment
        first = raw_name.split("–")[0].strip()
        if 3 <= len(first) <= 30 and first.lower() not in ("central","eastern","western","northern","southern"):
            name_en = first + " area"
        else:
            name_en = "Eastern highlands"
    else:
        name_en = raw_name
    country_name = countries_data.get(adm, {}).get("nameEn", adm)
    # Avoid "X in X" duplication when province is whole country
    if name_en.strip().lower() == country_name.strip().lower():
        name_en = "National territory"
    elif country_name.lower() in name_en.lower() and len(name_en) < 40:
        # keep as is but country duplication will be avoided later by dropping country
        pass
    # Handle tiny islands / -99
    if province_id.startswith("-99-") or adm in ("CLP","CSI","ATA","ATF","ATC"):
        # Use island templates
        island_bodies = {
            "-99-X02~": "Uninhabited Pacific atoll (Clipperton), French territory, wildlife reserve.",
            "-99-X03~": "Uninhabited Coral Sea islets, Australian external territory, reef reserve.",
            "-99-X06~": "Uninhabited reef islet, no permanent population, managed as nature reserve.",
        }
        if province_id in island_bodies:
            return island_bodies[province_id]
        # generic
        return f"Uninhabited islet or reef in the {country_name} zone, no permanent settlement."

    # Use country hint
    hint = COUNTRY_HINTS.get(adm, "varied lowlands and uplands")
    capital = ""
    cap = props.get("capital", {})
    if isinstance(cap, dict):
        capital = cap.get("nameEn") or cap.get("name") or ""
    # Deterministic econ choice via hash
    h = int(hashlib.sha1(province_id.encode()).hexdigest()[:4],16)
    econ = ECON_POOL[h % len(ECON_POOL)]
    # Check nameEn keywords for tailoring
    lower = name_en.lower()
    geo_hint = hint
    if "delta" in lower:
        geo_hint = "river delta and fertile floodplain"
    elif "canal" in lower:
        geo_hint = "canal corridor and port zone"
    elif "sinai" in lower:
        geo_hint = "desert peninsula and Red Sea coast"
    elif "cairo" in lower:
        geo_hint = "Nile metropolis and desert fringe"
    elif "island" in lower or "is." in lower:
        geo_hint = "island and coastal waters"
        econ = "tourism and fishing"
    elif "coast" in lower:
        geo_hint = "coastal plain and shoreline"
    elif "highland" in lower or "mountain" in lower:
        geo_hint = "highland valleys and mountain slopes"
    elif "desert" in lower:
        geo_hint = "desert plain and oasis settlements"
    elif "forest" in lower:
        geo_hint = "forested uplands and river valleys"
    elif "lake" in lower:
        geo_hint = "lake district and forested lowlands"

    # Compose body: keep <=100 chars
    # Template: "<Name> in <Country>, <geo>, <econ>."
    # But keep concise; if name_en already contains country context, shorten.
    # Ensure total <=100

    # Option A: short form without repeating country if name_en is country itself (e.g., Albania, Andorra)
    if lower in ["albania","andorra","barbados","djibouti","bahrain","burundi","aland","anguilla","aruba"]:
        base = f"{geo_hint.capitalize()}, {econ}."
        # Ensure first letter capital
        # Prepend nothing, just describe
        candidate = f"{base}"
        # Ensure <=100
        if len(candidate) > 100:
            candidate = candidate[:97] + "..."
        return candidate

    # Normal
    # We try to keep under 100: "<Name> — <geo>, <econ>."
    # Use en dash
    candidate = f"{name_en} in {country_name}, {geo_hint}, {econ}."
    if len(candidate) <= 100:
        return candidate
    # Try shorter: drop country_name
    candidate2 = f"{name_en}, {geo_hint}, {econ}."
    if len(candidate2) <= 100:
        return candidate2
    # Truncate econ
    # Use shorter geo_hint
    short_geo = geo_hint.split(" and ")[0]
    candidate3 = f"{name_en}, {short_geo}, {econ}."
    if len(candidate3) <= 100:
        return candidate3
    # Ultimate truncation
    truncated = candidate2[:97] + "..."
    return truncated

descriptions = {}
too_long = []
for fid, feat in geo_by_id.items():
    props = feat["properties"]
    review = review_by_id.get(fid, {})
    members = review.get("members", [fid])
    prefix = make_prefix(members)
    body = craft_body(fid, props, review)
    # body must be <=100 chars
    if len(body) > 100:
        too_long.append((fid, len(body), body))
        body = body[:97] + "..."
    full = f"{prefix} {body}".strip() if prefix else body
    # Need to ensure body alone <=100, but full may exceed 100 due prefix extra (allowed)
    descriptions[fid] = full

# Check missing or extra
assert len(descriptions)==1287, f"got {len(descriptions)}"
# Ensure all IDs from geo present
missing = set(geo_by_id.keys()) - set(descriptions.keys())
assert not missing, f"missing {missing}"

# Overwrite bodies for known provinces to improve quality with hand-tuned
hand_tuned = {
    "-99-X04~": "Northern Cyprus, Mediterranean island enclave, tourism and services.",
    "-99-X11~": "Dhekelia and Akrotiri enclaves on Cyprus, British bases, small resident population.",
    "BDI-GACB5E2E": "Burundi, Great Rift highlands, dense smallholder farming and lake trade.",
    "BEL-Capital-Region": "Brussels capital region, national admin hub and multilingual services core.",
    "BEL-Flemish": "Flanders lowland plains, ports of Antwerp-Ghent and industrial belt.",
    "BEL-Walloon": "Wallonia uplands and Meuse valley, steel heritage and logistics hubs.",
}
for k,v in hand_tuned.items():
    if k in descriptions:
        # preserve prefix if existed
        review = review_by_id.get(k, {})
        members = review.get("members",[k])
        prefix = make_prefix(members)
        body = v
        if len(body)>100:
            body=body[:97]+"..."
        descriptions[k] = f"{prefix} {body}".strip() if prefix else body

# Validate bodies
violations=[]
for pid, full in descriptions.items():
    review = review_by_id.get(pid, {})
    members = review.get("members",[pid])
    prefix = make_prefix(members)
    body = full
    if prefix:
        # remove prefix and leading space
        assert body.startswith(prefix), f"{pid} prefix mismatch"
        body = body[len(prefix):].lstrip()
    if len(body)>100:
        violations.append((pid, len(body), body))
if violations:
    print(f"VIOLATIONS {len(violations)}")
    for v in violations[:10]:
        print(v)
else:
    print("All bodies <=100")

# Write outputs
OUT1.parent.mkdir(parents=True, exist_ok=True)
OUT1.write_text(json.dumps(descriptions, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
OUT2.parent.mkdir(parents=True, exist_ok=True)
OUT2.write_text(json.dumps(descriptions, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
print(f"Wrote {len(descriptions)} to {OUT1} and {OUT2}")
print(f"Bodies too long before trunc: {len(too_long)}")
if too_long:
    for x in too_long[:5]:
        print(x)
