import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateByShares,
  DEFAULT_CLASS_POPULATION_SHARES,
  parseClassCsvText,
  serializeClassCsv,
  splitDemographicsIntoClasses,
  sumClassSeedRows,
  validateClassSeedRows
} from "../src/class-split.js";

test("allocateByShares sums to the requested total", () => {
  const parts = allocateByShares(1000, DEFAULT_CLASS_POPULATION_SHARES);
  const sum = Object.values(parts).reduce((total, value) => total + value, 0);
  assert.equal(sum, 1000);
  assert.equal(Object.keys(parts).length, 11);
});

test("splitDemographicsIntoClasses preserves province population totals and valid shares", () => {
  const demo = {
    pop: 10_000,
    male: 5_100,
    female: 4_900,
    age: {
      child_0_14: 2_400,
      youth_15_24: 1_200,
      prime_25_44: 3_000,
      mature_45_64: 2_200,
      senior_65_plus: 1_200
    },
    education15Plus: {
      basic: 3_000,
      secondary: 2_500,
      tertiary: 1_200,
      advanced: 400
    },
    gdpPpp: 1
  };
  const rows = splitDemographicsIntoClasses(demo);
  assert.equal(
    rows.reduce((sum, row) => sum + row.populationPersons, 0),
    demo.pop
  );
  const validationErrors = validateClassSeedRows(rows);
  assert.deepEqual(validationErrors, []);
});

test("serializeClassCsv and parseClassCsvText round-trip longitudinal dimension table", () => {
  const demo = {
    pop: 1000,
    male: 520,
    female: 480,
    age: {
      child_0_14: 200,
      youth_15_24: 150,
      prime_25_44: 300,
      mature_45_64: 230,
      senior_65_plus: 120
    },
    education15Plus: {
      basic: 300,
      secondary: 300,
      tertiary: 150,
      advanced: 50
    },
    gdpPpp: 100
  };
  const rows = splitDemographicsIntoClasses(demo);
  const farmer = rows.find((r) => r.socialClassId === "farmer")!;
  const csvText = serializeClassCsv(farmer);
  assert.match(csvText, /^dimension,key,value/);
  assert.match(csvText, /meta,population_persons,\d+/);
  assert.match(csvText, /gender,male,\d+\.\d+/);
  assert.match(csvText, /age,0,\d+\.\d+/);
  assert.match(csvText, /age,100,\d+\.\d+/);
  assert.match(csvText, /education_15plus,basic,\d+\.\d+/);

  const parsed = parseClassCsvText("farmer", csvText);
  assert.equal(parsed.socialClassId, "farmer");
  assert.equal(parsed.populationPersons, farmer.populationPersons);
  assert.ok(Math.abs(parsed.maleShare - farmer.maleShare) < 0.001);
  assert.ok(Math.abs(parsed.ageShares[0]! - farmer.ageShares[0]!) < 0.001);
  assert.ok(Math.abs(parsed.education15PlusShares.basic - farmer.education15PlusShares.basic) < 0.001);
});

test("sumClassSeedRows adds member class populations and weights shares", () => {
  const a = splitDemographicsIntoClasses({
    pop: 100,
    male: 50,
    female: 50,
    age: {
      child_0_14: 20,
      youth_15_24: 20,
      prime_25_44: 20,
      mature_45_64: 20,
      senior_65_plus: 20
    },
    education15Plus: { basic: 40, secondary: 30, tertiary: 20, advanced: 10 },
    gdpPpp: 0
  });
  const b = splitDemographicsIntoClasses({
    pop: 50,
    male: 25,
    female: 25,
    age: {
      child_0_14: 10,
      youth_15_24: 10,
      prime_25_44: 10,
      mature_45_64: 10,
      senior_65_plus: 10
    },
    education15Plus: { basic: 20, secondary: 15, tertiary: 10, advanced: 5 },
    gdpPpp: 0
  });
  const merged = sumClassSeedRows([a, b]);
  assert.equal(
    merged.reduce((sum, row) => sum + row.populationPersons, 0),
    150
  );
  assert.deepEqual(validateClassSeedRows(merged), []);
});
