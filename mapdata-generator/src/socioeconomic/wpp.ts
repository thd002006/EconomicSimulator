import { readFile } from "node:fs/promises";
import { asNumber, asString, isRecord, prop, validCode } from "../geo.js";

export const EDUCATION_LEVEL_IDS = ["basic", "secondary", "tertiary", "advanced"] as const;

export type EducationLevelId = (typeof EDUCATION_LEVEL_IDS)[number];

export interface CountryAgeSex {
  readonly male: Readonly<Record<number, number>>;
  readonly female: Readonly<Record<number, number>>;
}

/**
 * Authoritative ISO 3166-1 numeric -> alpha-3 map (plus WPP's Kosovo special
 * case). WPP identifies countries by numeric code; Natural Earth's `iso_n3`
 * field is unreliable (often -99) and its `_eh` engineering codes belong to
 * subordinate units, so a fixed standard table is used instead of deriving it
 * from the Natural Earth shapefile.
 */
export const NUMERIC_TO_A3: Readonly<Record<string, string>> = {
  "004": "AFG",
  "008": "ALB",
  "010": "ATA",
  "012": "DZA",
  "016": "ASM",
  "020": "AND",
  "024": "AGO",
  "028": "ATG",
  "031": "AZE",
  "032": "ARG",
  "036": "AUS",
  "040": "AUT",
  "044": "BHS",
  "048": "BHR",
  "050": "BGD",
  "051": "ARM",
  "052": "BRB",
  "056": "BEL",
  "060": "BMU",
  "064": "BTN",
  "068": "BOL",
  "070": "BIH",
  "072": "BWA",
  "074": "BVT",
  "076": "BRA",
  "084": "BLZ",
  "086": "IOT",
  "090": "SLB",
  "092": "VGB",
  "096": "BRN",
  "100": "BGR",
  "104": "MMR",
  "108": "BDI",
  "112": "BLR",
  "116": "KHM",
  "120": "CMR",
  "124": "CAN",
  "132": "CPV",
  "136": "CYM",
  "140": "CAF",
  "144": "LKA",
  "148": "TCD",
  "152": "CHL",
  "156": "CHN",
  "158": "TWN",
  "162": "CXM",
  "166": "CCK",
  "170": "COL",
  "174": "COM",
  "175": "MYT",
  "178": "COG",
  "180": "COD",
  "184": "COK",
  "188": "CRI",
  "191": "HRV",
  "192": "CUB",
  "196": "CYP",
  "203": "CZE",
  "204": "BEN",
  "208": "DNK",
  "212": "DMA",
  "214": "DOM",
  "218": "ECU",
  "222": "SLV",
  "226": "GNQ",
  "231": "ETH",
  "232": "ERI",
  "233": "EST",
  "234": "FRO",
  "238": "FLK",
  "239": "SGS",
  "242": "FJI",
  "246": "FIN",
  "248": "ALA",
  "250": "FRA",
  "254": "GUF",
  "258": "PYF",
  "260": "ATF",
  "262": "DJI",
  "266": "GAB",
  "268": "GEO",
  "270": "GMB",
  "275": "PSE",
  "276": "DEU",
  "288": "GHA",
  "292": "GIB",
  "296": "KIR",
  "300": "GRC",
  "304": "GRL",
  "308": "GRD",
  "312": "GLP",
  "316": "GUM",
  "320": "GTM",
  "324": "GIN",
  "328": "GUY",
  "332": "HTI",
  "334": "HMD",
  "336": "VAT",
  "340": "HND",
  "344": "HKG",
  "348": "HUN",
  "352": "ISL",
  "356": "IND",
  "360": "IDN",
  "364": "IRN",
  "368": "IRQ",
  "372": "IRL",
  "376": "ISR",
  "380": "ITA",
  "384": "CIV",
  "388": "JAM",
  "392": "JPN",
  "398": "KAZ",
  "400": "JOR",
  "404": "KEN",
  "408": "PRK",
  "410": "KOR",
  "412": "KOS",
  "414": "KWT",
  "417": "KGZ",
  "418": "LAO",
  "422": "LBN",
  "426": "LSO",
  "428": "LVA",
  "430": "LBR",
  "434": "LBY",
  "438": "LIE",
  "440": "LTU",
  "442": "LUX",
  "446": "MAC",
  "450": "MDG",
  "454": "MWI",
  "458": "MYS",
  "462": "MDV",
  "466": "MLI",
  "470": "MLT",
  "474": "MTQ",
  "478": "MRT",
  "480": "MUS",
  "484": "MEX",
  "492": "MCO",
  "496": "MNG",
  "498": "MDA",
  "499": "MNE",
  "500": "MSR",
  "504": "MAR",
  "508": "MOZ",
  "512": "OMN",
  "516": "NAM",
  "520": "NRU",
  "524": "NPL",
  "528": "NLD",
  "531": "CUW",
  "533": "ABW",
  "534": "SXM",
  "535": "BES",
  "540": "NCL",
  "548": "VUT",
  "554": "NZL",
  "558": "NIC",
  "562": "NER",
  "566": "NGA",
  "570": "NIU",
  "574": "NFK",
  "578": "NOR",
  "580": "MNP",
  "581": "UMI",
  "583": "FSM",
  "584": "MHL",
  "585": "PLW",
  "586": "PAK",
  "591": "PAN",
  "598": "PNG",
  "600": "PRY",
  "604": "PER",
  "608": "PHL",
  "612": "PCN",
  "616": "POL",
  "620": "PRT",
  "624": "GNB",
  "626": "TLS",
  "630": "PRI",
  "634": "QAT",
  "638": "REU",
  "642": "ROU",
  "643": "RUS",
  "646": "RWA",
  "652": "BLM",
  "654": "SHN",
  "659": "KNA",
  "660": "AIA",
  "662": "LCA",
  "663": "MAF",
  "666": "SPM",
  "670": "VCT",
  "674": "SMR",
  "678": "STP",
  "682": "SAU",
  "686": "SEN",
  "688": "SRB",
  "690": "SYC",
  "694": "SLE",
  "702": "SGP",
  "703": "SVK",
  "704": "VNM",
  "705": "SVN",
  "706": "SOM",
  "710": "ZAF",
  "716": "ZWE",
  "724": "ESP",
  "728": "SDS",
  "729": "SDN",
  "732": "ESH",
  "740": "SUR",
  "744": "SJM",
  "748": "SWZ",
  "752": "SWE",
  "756": "CHE",
  "760": "SYR",
  "762": "TJK",
  "764": "THA",
  "768": "TGO",
  "772": "TKL",
  "776": "TON",
  "780": "TTO",
  "784": "ARE",
  "788": "TUN",
  "792": "TUR",
  "795": "TKM",
  "796": "TCA",
  "798": "TUV",
  "800": "UGA",
  "804": "UKR",
  "807": "MKD",
  "818": "EGY",
  "826": "GBR",
  "831": "GGY",
  "832": "JEY",
  "833": "IMN",
  "834": "TZA",
  "840": "USA",
  "854": "BFA",
  "858": "URY",
  "860": "UZB",
  "862": "VEN",
  "876": "WLF",
  "882": "WSM",
  "887": "YEM",
  "894": "ZMB"
};

export interface CountryDemographics {
  /** Persons per single-year age at the base year. */
  readonly ageSex: CountryAgeSex;
  readonly populationBaseYearPersons: number;
}

/** Single-age WPP estimates are stored in thousands of persons. */
function parseWppTable(text: string, yearColumn: string): Map<number, Map<number, number>> {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const header = lines[0]!.split("\t");
  const yearIndex = header.indexOf(yearColumn);
  if (yearIndex < 0) throw new Error(`WPP table lacks column ${yearColumn}.`);
  const codeIndex = header.indexOf("country_code");
  const ageIndex = header.indexOf("age");
  if (codeIndex < 0 || ageIndex < 0) throw new Error("WPP table lacks country_code/age columns.");
  const result = new Map<number, Map<number, number>>();
  for (let index = 1; index < lines.length; index += 1) {
    const columns = lines[index]!.split("\t");
    const code = Number(columns[codeIndex]);
    const age = Number(columns[ageIndex]);
    const valueThousands = Number(columns[yearIndex]);
    if (!Number.isFinite(code) || !Number.isFinite(age) || !Number.isFinite(valueThousands)) {
      continue;
    }
    const byAge = result.get(code) ?? new Map<number, number>();
    byAge.set(age, valueThousands * 1000);
    result.set(code, byAge);
  }
  return result;
}

function sumAges(byAge: Readonly<Map<number, number>>): number {
  let total = 0;
  for (const value of byAge.values()) total += value;
  return total;
}

export interface WppTables {
  readonly byCountry: Map<string, CountryDemographics>;
  readonly world: CountryDemographics;
}

/**
 * Natural Earth uses a few alpha-3 codes that differ from the ISO 3166-1
 * codes WPP keys its estimates by. Map them so those small territories can
 * reuse the correct national pyramid.
 */
const NE_ALIAS_TO_STANDARD: Readonly<Record<string, string>> = {
  SOL: "SLB",
  PSX: "PSE",
  SAH: "ESH",
  CYN: "CYP"
};

/** Resolve a map's adm0A3 to a WPP key (identity unless a known alias). */
export function wppKeyFor(adm0A3: string): string {
  return NE_ALIAS_TO_STANDARD[adm0A3] ?? adm0A3;
}

/**
 * Builds per-country demographics keyed by adm0A3 using the Natural Earth
 * admin-0 table to translate WPP numeric ISO codes.
 */
export async function loadWppDemographics(
  malePath: string,
  femalePath: string,
  countryTablePath: string,
  baseYear: string
): Promise<WppTables> {
  const [maleText, femaleText, countryTableText] = await Promise.all([
    readFile(malePath, "utf8"),
    readFile(femalePath, "utf8"),
    readFile(countryTablePath, "utf8")
  ]);
  const numericToA3 = new Map<string, string>(Object.entries(NUMERIC_TO_A3));
  const table = JSON.parse(countryTableText) as unknown;
  if (!isRecord(table) || !Array.isArray(table.features)) {
    throw new Error("Natural Earth admin-0 country table must be a FeatureCollection.");
  }
  // Natural Earth is only consulted to fill gaps for codes its own `iso_n3`
  // reliably carries; the authoritative table above wins on any conflict.
  for (const feature of table.features) {
    if (!isRecord(feature) || !isRecord(feature.properties)) continue;
    const rawA3 = asString(prop(feature.properties, "adm0_a3"));
    const a3 = validCode(rawA3) ? rawA3 : undefined;
    if (a3 === undefined) continue;
    const isoN3 = prop(feature.properties, "iso_n3", "ISO_N3");
    if (typeof isoN3 === "string" && /^\d{3}$/.test(isoN3)) {
      if (!numericToA3.has(isoN3)) numericToA3.set(isoN3, a3);
    }
  }

  const maleByCountry = parseWppTable(maleText, baseYear);
  const femaleByCountry = parseWppTable(femaleText, baseYear);

  const byCountry = new Map<string, CountryDemographics>();
  let worldMale = new Map<number, number>();
  let worldFemale = new Map<number, number>();

  const buildDemographics = (
    code: number,
    male: Map<number, number>,
    female: Map<number, number>
  ): CountryDemographics => {
    const populationBaseYearPersons = sumAges(male) + sumAges(female);
    return {
      ageSex: { male: Object.fromEntries(male), female: Object.fromEntries(female) },
      populationBaseYearPersons
    };
  };

  for (const [code, male] of maleByCountry) {
    const female = femaleByCountry.get(code);
    if (female === undefined) continue;
    const demographics = buildDemographics(code, male, female);
    const a3 = numericToA3.get(String(code).padStart(3, "0"));
    if (a3 !== undefined && !byCountry.has(a3)) byCountry.set(a3, demographics);
    if (String(code) === "900") {
      worldMale = male;
      worldFemale = female;
    }
  }

  const world: CountryDemographics = {
    ageSex: {
      male: Object.fromEntries(worldMale),
      female: Object.fromEntries(worldFemale)
    },
    populationBaseYearPersons: sumAges(worldMale) + sumAges(worldFemale)
  };
  return { byCountry, world };
}
