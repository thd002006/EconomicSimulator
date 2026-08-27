import { describe, expect, it } from "vitest";
import {
  parseClassCsv,
  parseCountriesCsv,
  parseProvinceOverviewCsv,
  buildScenarioSeed,
  type AuthoredMapContent
} from "../src/authored-pack.js";
import { parseCsv, serializeCsv } from "../src/csv.js";
import { parseSourceMapManifest } from "../src/source-manifest.js";

describe("csv helpers", () => {
  it("round-trips quoted commas", () => {
    const text = serializeCsv(["id", "name"], [{ id: "a", name: "hello, world" }]);
    expect(parseCsv(text).rows).toEqual([{ id: "a", name: "hello, world" }]);
  });
});

describe("authored csv schema", () => {
  it("parses countries and province overview", () => {
    const countries = parseCountriesCsv("id,name_en,name\nUSA,United States,US\n");
    expect(countries).toEqual([{ id: "USA", nameEn: "United States", name: "US" }]);
    const overview = parseProvinceOverviewCsv(
      [
        "id,name,name_en,owner_country_id,land_area_km2,arable_land_km2,cultivation_condition,habitability,terrain_profile_id,climate_profile_id,resource_coal,gdp_ppp,description",
        "US-IA,Iowa,Iowa,USA,145000,80000,0.9,0.85,plains,temperate,0.2,100,A farm province"
      ].join("\n"),
      "US-IA"
    );
    expect(overview.ownerCountryId).toBe("USA");
    expect(overview.resourcePotentialByResourceId.coal).toBe(0.2);
  });

  it("parses class seed rows", () => {
    const seed = parseClassCsv(
      [
        "social_class_id,population_persons,male,female,age_child_0_14,age_youth_15_24,age_prime_25_44,age_mature_45_64,age_senior_65_plus,edu_basic,edu_secondary,edu_tertiary,edu_advanced",
        "farmer,100,50,50,20,10,30,25,15,40,30,20,10"
      ].join("\n"),
      "farmer",
      "farmer.csv"
    );
    expect(seed.populationPersons).toBe(100);
    expect(seed.age.child_0_14).toBe(20);
  });

  it("builds population-only scenario seed from authored content", () => {
    const content: AuthoredMapContent = {
      countries: [{ id: "USA", nameEn: "United States" }],
      provinces: new Map([
        [
          "US-IA",
          {
            overview: {
              id: "US-IA",
              ownerCountryId: "USA",
              landAreaKm2: 1,
              arableLandKm2: 0,
              cultivationCondition: 0.5,
              habitability: 0.5,
              terrainProfileId: "plains",
              climateProfileId: "temperate",
              resourcePotentialByResourceId: {}
            },
            classes: [
              {
                socialClassId: "farmer",
                populationPersons: 100,
                male: 50,
                female: 50,
                age: {
                  child_0_14: 20,
                  youth_15_24: 10,
                  prime_25_44: 30,
                  mature_45_64: 25,
                  senior_65_plus: 15
                },
                education15Plus: { basic: 40, secondary: 30, tertiary: 20, advanced: 10 }
              }
            ],
            operatingUnits: []
          }
        ]
      ]),
      companies: []
    };
    const seed = buildScenarioSeed("test", content);
    expect(seed.classSeeds).toHaveLength(1);
    expect(seed.provinces[0]?.ownerCountryId).toBe("USA");
    expect(seed).not.toHaveProperty("companies");
    expect(seed).not.toHaveProperty("equity");
  });
});

describe("source map schema v3", () => {
  it("accepts csv authored manifests", () => {
    const manifest = parseSourceMapManifest(
      {
        schemaVersion: 3,
        id: "test-map",
        version: "1.0.0",
        nameKey: "map.test.name",
        coordinateReferenceSystem: "EPSG:4326",
        layers: {
          provinces: "geometry/provinces.geojson",
          boundaries: "geometry/boundaries.json",
          countries: "countries.csv",
          provincesDir: "provinces",
          companiesDir: "companies"
        }
      },
      "test-map"
    );
    expect(manifest.schemaVersion).toBe(3);
  });

  it("rejects schema v2", () => {
    expect(() =>
      parseSourceMapManifest(
        {
          schemaVersion: 2,
          id: "test-map",
          version: "1.0.0",
          nameKey: "map.test.name",
          coordinateReferenceSystem: "EPSG:4326",
          layers: { provinces: "provinces.geojson", boundaries: "boundaries.json" }
        },
        "test-map"
      )
    ).toThrow(/expected 3/);
  });
});
