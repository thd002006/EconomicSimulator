#!/usr/bin/env python3
"""
Generate provinces.json for all 1287 world-modern provinces.
Adds arableLandKm2 (current cropland), cultivationCondition 0~1, habitability 0~1.
Uses cached geometry/area from review-report + deterministic heuristics based on
FAO/GAEZ general knowledge and latitude/aridity. No external raster download.
"""
import json
import hashlib
import math
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
REVIEW = REPO / "mapdata-generator/output/world-modern/review-report.json"
PROV_GEO = REPO / "assets/maps/world-modern/provinces.geojson"
OUT = REPO / "packages/game-data/data/provinces.json"

# --- country base values (arableShare, cultivationCondition, habitability) ---
# cited FAO cropland shares & GAEZ suitability general knowledge
COUNTRY_BASE = {
    # Western Europe high fertility
    "FRA": (0.335, 0.88, 0.86),
    "DEU": (0.340, 0.85, 0.84),
    "BEL": (0.32, 0.84, 0.83),
    "NLD": (0.31, 0.83, 0.82),
    "CHE": (0.10, 0.62, 0.72),
    "AUT": (0.16, 0.72, 0.76),
    "GBR": (0.25, 0.75, 0.78),
    "IRL": (0.16, 0.70, 0.74),
    "LUX": (0.33, 0.84, 0.83),
    "DNK": (0.55, 0.80, 0.78),
    # Nordics
    "NOR": (0.03, 0.38, 0.58),
    "SWE": (0.07, 0.45, 0.62),
    "FIN": (0.08, 0.42, 0.60),
    "ISL": (0.01, 0.18, 0.45),
    # Southern Europe
    "ESP": (0.26, 0.62, 0.72),
    "PRT": (0.18, 0.58, 0.70),
    "ITA": (0.23, 0.70, 0.75),
    "GRC": (0.20, 0.58, 0.70),
    "ALB": (0.22, 0.62, 0.68),
    "MKD": (0.28, 0.65, 0.68),
    "SRB": (0.36, 0.72, 0.70),
    "BIH": (0.20, 0.60, 0.68),
    "HRV": (0.20, 0.62, 0.70),
    "SVN": (0.18, 0.65, 0.72),
    "MNE": (0.12, 0.55, 0.65),
    "BGR": (0.38, 0.75, 0.70),
    "ROU": (0.39, 0.78, 0.72),
    "MDA": (0.55, 0.82, 0.70),
    "CZE": (0.38, 0.82, 0.76),
    "SVK": (0.32, 0.78, 0.72),
    "POL": (0.37, 0.82, 0.74),
    "HUN": (0.46, 0.80, 0.72),
    "BLR": (0.28, 0.68, 0.62),
    "UKR": (0.56, 0.90, 0.68),
    "LTU": (0.35, 0.70, 0.66),
    "LVA": (0.30, 0.62, 0.64),
    "EST": (0.20, 0.55, 0.62),
    # Eastern vast
    "RUS": (0.075, 0.50, 0.40),
    "KAZ": (0.11, 0.45, 0.38),
    "UZB": (0.11, 0.32, 0.35),
    "TKM": (0.05, 0.22, 0.28),
    "TJK": (0.07, 0.30, 0.32),
    "KGZ": (0.08, 0.35, 0.36),
    "MNG": (0.01, 0.22, 0.28),
    # Middle East desert
    "TUR": (0.28, 0.65, 0.68),
    "SYR": (0.25, 0.45, 0.48),
    "IRQ": (0.18, 0.40, 0.42),
    "IRN": (0.11, 0.40, 0.42),
    "SAU": (0.015, 0.12, 0.14),
    "YEM": (0.025, 0.14, 0.18),
    "OMN": (0.005, 0.10, 0.16),
    "ARE": (0.005, 0.08, 0.18),
    "QAT": (0.01, 0.08, 0.20),
    "KWT": (0.01, 0.08, 0.20),
    "BHR": (0.02, 0.10, 0.22),
    "JOR": (0.04, 0.22, 0.32),
    "ISR": (0.14, 0.35, 0.62),
    "LBN": (0.18, 0.50, 0.60),
    "CYP": (0.12, 0.48, 0.62),
    # North Africa
    "EGY": (0.03, 0.18, 0.18),
    "LBY": (0.01, 0.10, 0.12),
    "DZA": (0.035, 0.20, 0.22),
    "TUN": (0.18, 0.38, 0.45),
    "MAR": (0.17, 0.42, 0.48),
    "SAH": (0.001, 0.05, 0.06),
    "ERI": (0.07, 0.22, 0.28),
    "DJI": (0.004, 0.08, 0.18),
    "SDN": (0.08, 0.28, 0.32),
    "SDS": (0.04, 0.20, 0.25),
    # Sub-Saharan West
    "SEN": (0.18, 0.35, 0.42),
    "MRT": (0.005, 0.08, 0.10),
    "MLI": (0.05, 0.22, 0.30),
    "NER": (0.03, 0.12, 0.15),
    "BFA": (0.22, 0.32, 0.38),
    "NGA": (0.34, 0.45, 0.52),
    "TCD": (0.05, 0.18, 0.22),
    "GMB": (0.40, 0.38, 0.45),
    "GIN": (0.05, 0.40, 0.48),
    "GNB": (0.10, 0.42, 0.50),
    "SLE": (0.18, 0.42, 0.48),
    "LBR": (0.06, 0.38, 0.46),
    "CIV": (0.22, 0.48, 0.52),
    "GHA": (0.20, 0.45, 0.52),
    "TGO": (0.38, 0.48, 0.52),
    "BEN": (0.25, 0.42, 0.50),
    "CMR": (0.13, 0.42, 0.50),
    # Central Africa forest
    "CAF": (0.03, 0.35, 0.42),
    "COD": (0.03, 0.38, 0.44),
    "COG": (0.02, 0.35, 0.42),
    "GAB": (0.02, 0.35, 0.48),
    "GNQ": (0.08, 0.42, 0.52),
    "AGO": (0.04, 0.32, 0.40),
    "ZMB": (0.05, 0.35, 0.44),
    "ZWE": (0.10, 0.38, 0.46),
    "MOZ": (0.07, 0.38, 0.48),
    "MWI": (0.38, 0.42, 0.48),
    "TZA": (0.14, 0.40, 0.48),
    # East Africa
    "KEN": (0.10, 0.42, 0.48),
    "UGA": (0.35, 0.55, 0.52),
    "RWA": (0.52, 0.58, 0.50),
    "BDI": (0.45, 0.52, 0.48),
    "ETH": (0.15, 0.42, 0.44),
    "SOM": (0.02, 0.15, 0.20),
    # Southern Africa
    "ZAF": (0.10, 0.48, 0.62),
    "NAM": (0.01, 0.12, 0.22),
    "BWA": (0.01, 0.15, 0.30),
    "LSO": (0.11, 0.35, 0.42),
    "SWZ": (0.11, 0.38, 0.48),
    "MDG": (0.06, 0.40, 0.48),
    # South Asia
    "IND": (0.53, 0.68, 0.62),
    "PAK": (0.27, 0.50, 0.48),
    "BGD": (0.58, 0.70, 0.60),
    "NPL": (0.15, 0.45, 0.42),
    "BTN": (0.03, 0.32, 0.38),
    "LKA": (0.20, 0.62, 0.62),
    # SE Asia
    "MMR": (0.19, 0.58, 0.58),
    "THA": (0.32, 0.65, 0.65),
    "VNM": (0.22, 0.65, 0.66),
    "KHM": (0.24, 0.60, 0.60),
    "LAO": (0.07, 0.48, 0.55),
    "MYS": (0.05, 0.58, 0.62),
    "IDN": (0.13, 0.60, 0.60),
    "PHL": (0.20, 0.62, 0.62),
    "BRN": (0.02, 0.50, 0.58),
    "SGP": (0.01, 0.35, 0.72),
    # East Asia
    "CHN": (0.14, 0.62, 0.60),
    "TWN": (0.22, 0.68, 0.68),
    "KOR": (0.15, 0.68, 0.70),
    "PRK": (0.22, 0.55, 0.52),
    "JPN": (0.11, 0.68, 0.72),
    "HKG": (0.02, 0.45, 0.70),
    "MAC": (0.01, 0.35, 0.68),
    # North America
    "USA": (0.17, 0.78, 0.75),
    "CAN": (0.045, 0.35, 0.48),
    "MEX": (0.13, 0.55, 0.62),
    "GTM": (0.14, 0.55, 0.58),
    "BLZ": (0.08, 0.52, 0.58),
    "HND": (0.09, 0.50, 0.55),
    "SLV": (0.32, 0.52, 0.58),
    "NIC": (0.15, 0.48, 0.55),
    "CRI": (0.10, 0.58, 0.62),
    "PAN": (0.07, 0.52, 0.60),
    "CUB": (0.33, 0.58, 0.62),
    "DOM": (0.18, 0.55, 0.60),
    "HTI": (0.35, 0.42, 0.42),
    "JAM": (0.16, 0.52, 0.60),
    # South America
    "BRA": (0.09, 0.58, 0.58),
    "ARG": (0.16, 0.82, 0.72),
    "CHL": (0.04, 0.42, 0.55),
    "PER": (0.03, 0.35, 0.48),
    "COL": (0.04, 0.55, 0.60),
    "VEN": (0.04, 0.42, 0.55),
    "ECU": (0.05, 0.55, 0.60),
    "BOL": (0.04, 0.40, 0.45),
    "PRY": (0.10, 0.55, 0.58),
    "URY": (0.14, 0.72, 0.68),
    "GUY": (0.02, 0.42, 0.52),
    "SUR": (0.006, 0.38, 0.50),
    # Oceania
    "AUS": (0.06, 0.45, 0.58),
    "NZL": (0.09, 0.62, 0.74),
    "PNG": (0.02, 0.45, 0.48),
    "FJI": (0.09, 0.55, 0.60),
    # default fallback handled below
}

DESERT_COUNTRIES = {"SAU","ARE","QAT","KWT","OMN","YEM","EGY","LBY","DZA","MAR","SAH","MRT","NER","TCD","SDN","SDS","ERI","DJI","JOR","BHR","SAH","MNG","TKM","SAH"}

# manual province overrides for high plateau / polar / desert provinces where latitude alone misclassifies
PROVINCE_OVERRIDES = {
    # Tibet Plateau
    "CN-XZ": (0.008, 0.18, 0.22),
    "CN-QH": (0.015, 0.25, 0.32),
    "CN-XJ": (0.038, 0.31, 0.36),
    "CN-NM": (0.055, 0.38, 0.40),
    "CN-GS": (0.048, 0.34, 0.42),
    "CN-NX": (0.06, 0.32, 0.38),
    # US desert / polar
    "US-AK": (0.002, 0.12, 0.18),
    "US-AZ": (0.018, 0.24, 0.44),
    "US-NV": (0.009, 0.19, 0.38),
    "US-UT": (0.019, 0.27, 0.45),
    "US-NM": (0.021, 0.26, 0.44),
    "US-HI": (0.08, 0.55, 0.72),
    # Canada far north
    "CA-NT": (0.001, 0.08, 0.12),
    "CA-NU": (0.0005, 0.06, 0.08),
    "CA-YT": (0.001, 0.09, 0.15),
    # Russia Siberia / far east (sample hash provinces)
    # Greenland
    "GL-UO": (0.0005, 0.05, 0.05),
    "GRL-G6096F64": (0.001, 0.05, 0.05),
    # Australia interior (grouped, but some subdivided states; keep NSW/VIC higher, NT low)
    "AU-NT": (0.008, 0.18, 0.28),
    "AU-WA": (0.015, 0.24, 0.32),
    "AU-SA": (0.025, 0.28, 0.35),
    # Saudi interiors etc already via country base, but reinforce large desert provinces
    "SAH-X01~": (0.0005, 0.05, 0.06),
}

def clamp(v, lo, hi):
    return max(lo, min(hi, v))

def hash01(pid: str) -> float:
    h = int(hashlib.sha1(pid.encode()).hexdigest()[:8], 16)
    return (h % 10000) / 10000.0  # 0~1

def terrain_for_lat(lat):
    a = abs(lat)
    if a > 66.5: return "tundra"
    if a > 60: return "boreal"
    if a > 45: return "temperate_cold"
    if a > 35: return "temperate"
    if a > 23.5: return "subtropical"
    return "tropical"

def climate_for_lat(lat):
    a = abs(lat)
    if a > 66.5: return "polar"
    if a > 55: return "continental"
    if a > 35: return "temperate"
    if a > 23.5: return "subtropical"
    return "tropical"

def main():
    review = json.loads(REVIEW.read_text(encoding="utf-8"))
    area_by_id = {p["id"]: p["areaKm2"] for p in review["provinces"]}
    cap_by_id = {p["id"]: p["capital"]["coordinates"] for p in review["provinces"]}
    country_by_id = {p["id"]: p["countryId"] for p in review["provinces"]}

    # load geo for adm0A3 fallback (for -99 codes country != adm0A3)
    geo = json.loads(PROV_GEO.read_text(encoding="utf-8"))
    adm_by_id = {}
    for f in geo["features"]:
        adm_by_id[f["id"]] = f["properties"].get("adm0A3") or country_by_id.get(f["id"], "")

    def country_base(adm, lat):
        if adm in COUNTRY_BASE:
            return COUNTRY_BASE[adm]
        # fallback by latitude/aridity
        a = abs(lat)
        # desert override at subtropical arid belt
        arid_belt = 15 < a < 35 and adm in DESERT_COUNTRIES
        if a > 66.5:
            return (0.01, 0.10, 0.08)
        if a > 60:
            return (0.04, 0.30, 0.35)
        if arid_belt:
            return (0.02, 0.15, 0.16)
        if a > 45:
            return (0.30, 0.80, 0.78)
        if a > 35:
            return (0.26, 0.68, 0.70)
        if a > 23.5:
            return (0.18, 0.55, 0.60)
        return (0.12, 0.52, 0.55)

    result = []
    for pid, land_raw in area_by_id.items():
        adm = adm_by_id.get(pid) or country_by_id.get(pid, "UNK")
        country = country_by_id.get(pid, adm)
        # handle Vatican 0 area
        land = int(land_raw) if land_raw and land_raw >= 1 else 1
        # tiny atoll fallback if land <5, keep  land as given (>=1)
        lon, lat = cap_by_id[pid]
        base_arable_share, base_cult, base_hab = country_base(adm, lat)

        # province-specific modifiers
        # large provinces in big countries: latitudinal gradient
        h = hash01(pid)
        # cultivation: temperate peak at 42-50 lat
        lat_abs = abs(lat)
        cultivo = base_cult
        if 40 <= lat_abs <= 50 and adm not in DESERT_COUNTRIES:
            cultivo += 0.06
        elif lat_abs > 60:
            cultivo -= 0.12
        elif lat_abs < 10:
            cultivo -= 0.04  # humid tropics slightly lower for cereals
        # aridity penalty for desert countries stays low
        if adm in DESERT_COUNTRIES and lat_abs < 33:
            cultivo = min(cultivo, 0.30)

        # small island penalty
        if land < 50:
            cultivo = cultivo * 0.6 + 0.08
            base_hab_factor = 0.6
        else:
            base_hab_factor = 1.0

        # deterministic noise +-0.04
        cultivo += (h - 0.5) * 0.08
        habit = base_hab + (hash01(pid + "_hab") - 0.5) * 0.08
        # habitability: penalize tiny atolls and polar
        if land < 20:
            habit *= 0.55
        if lat_abs > 70:
            habit -= 0.25
            cultivo -= 0.18
        elif lat_abs > 65:
            habit -= 0.18
            cultivo -= 0.14
        elif lat_abs > 62:
            habit -= 0.12
            cultivo -= 0.08
        # strong polar clamp
        if lat_abs > 68:
            cultivo = min(cultivo, 0.18)
            habit = min(habit, 0.18)
        elif lat_abs > 64:
            cultivo = min(cultivo, 0.28)
            habit = min(habit, 0.30)

        cultivo = clamp(cultivo, 0.05, 0.95)
        habit = clamp(habit * base_hab_factor, 0.05, 0.95)

        # arable share: scale with cultivation + habitability
        # desert already low; fertile high
        arable_share = base_arable_share * (0.65 + 0.70 * cultivo / 0.85) * (0.85 + 0.30 * habit / 0.75)
        # latitude aridity again
        if adm in DESERT_COUNTRIES:
            arable_share *= 0.55
        if lat_abs > 62:
            arable_share *= 0.45
        elif lat_abs > 55:
            arable_share *= 0.70

        # add noise +-18%
        arable_share *= 0.88 + 0.24 * h
        arable_share = clamp(arable_share, 0.0005, 0.65)

        # for tiny land, cap arable
        if land < 100:
            arable_share = min(arable_share, 0.15)
            if land < 20:
                arable_share = min(arable_share, 0.06)
        # manual province override supersedes heuristic
        if pid in PROVINCE_OVERRIDES:
            ov_share, ov_cult, ov_hab = PROVINCE_OVERRIDES[pid]
            # add small hash noise to avoid identical values for same province group
            cultivo = clamp(ov_cult + (h - 0.5) * 0.03, 0.05, 0.95)
            habit = clamp(ov_hab + (hash01(pid + "_hab") - 0.5) * 0.03, 0.05, 0.95)
            arable_share = clamp(ov_share * (0.92 + 0.16 * h), 0.0005, 0.65)

        # special: uninhabited atolls -99 should have near 0
        if pid.startswith("-99-") or pid.startswith("ATA") or pid.startswith("ATF") or pid.startswith("ATC"):
            arable_share = 0.001 if land < 500 else 0.005
            cultivo = clamp(0.06 + 0.04 * h, 0.05, 0.12)
            habit = clamp(0.05 + 0.06 * h, 0.05, 0.12)
        # Vatican
        if pid == "VA-X01~":
            cultivo = 0.05
            habit = 0.92
            arable_share = 0.0

        # tiny microstates (MCO, SMR, VAT, etc) with land <10 keep arable 0-1 km2
        arable = round(land * arable_share)
        if arable > land:
            arable = land
        if land < 5 and arable > 1:
            arable = 1 if h > 0.5 else 0
        if arable < 0:
            arable = 0

        # final rounding for indices
        cultivo = round(cultivo, 3)
        habit = round(habit, 3)

        result.append({
            "id": pid,
            "map": {"mapId": "world-modern", "featureId": pid},
            "landAreaKm2": int(land),
            "arableLandKm2": int(arable),
            "cultivationCondition": float(cultivo),
            "habitability": float(habit),
            "terrainProfileId": terrain_for_lat(lat),
            "climateProfileId": climate_for_lat(lat),
            "resourcePotentialByResourceId": {}
        })

    result.sort(key=lambda x: x["id"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(result)} provinces to {OUT}")
    # quick stats
    total_land = sum(r["landAreaKm2"] for r in result)
    total_arable = sum(r["arableLandKm2"] for r in result)
    print(f"totalLand {total_land} totalArable {total_arable} share {total_arable/total_land:.3%}")
    # sample
    for sample in ["FRA-G2", "UKR-G3B", "US-IA", "CN-??", "EGY-G", "RUS-G", "AUS-G", "-99-X02~"]:
        m = [r for r in result if sample in r["id"]]
        if m:
            print(m[0])

if __name__ == "__main__":
    main()
