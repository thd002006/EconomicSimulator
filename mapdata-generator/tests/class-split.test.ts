import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateByShares,
  DEFAULT_CLASS_POPULATION_SHARES,
  splitDemographicsIntoClasses,
  sumClassSeedRows
} from "../src/class-split.js";

test("allocateByShares sums to the requested total", () => {
  const parts = allocateByShares(1000, DEFAULT_CLASS_POPULATION_SHARES);
  const sum = Object.values(parts).reduce((total, value) => total + value, 0);
  assert.equal(sum, 1000);
  assert.equal(Object.keys(parts).length, 11);
});

test("splitDemographicsIntoClasses preserves province population totals", () => {
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
  assert.equal(
    rows.reduce((sum, row) => sum + row.male + row.female, 0),
    demo.pop
  );
  for (const row of rows) {
    assert.equal(row.male + row.female, row.populationPersons);
    const ageSum = Object.values(row.age).reduce((sum, value) => sum + value, 0);
    assert.equal(ageSum, row.populationPersons);
  }
});

test("sumClassSeedRows adds member class populations", () => {
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
});
