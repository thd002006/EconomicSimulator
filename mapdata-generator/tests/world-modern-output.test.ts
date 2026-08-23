import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

interface ReviewProvince {
  readonly id: string;
  readonly nameEn: string;
  readonly countryId: string;
  readonly method: string;
  readonly members: readonly string[];
  readonly areaKm2: number;
  readonly minimumAreaKm2: number;
  readonly belowMinimumReason?: string;
}

interface CountrySummary {
  readonly before: number;
  readonly after: number;
  readonly areaKm2: number;
  readonly minimumAreaKm2: number;
  readonly belowMinimum: number;
}

interface ReviewReport {
  readonly sourceProvinceCount: number;
  readonly provinceCount: number;
  readonly countryCounts: Readonly<Record<string, number>>;
  readonly countrySummary: Readonly<Record<string, CountrySummary>>;
  readonly provinces: readonly ReviewProvince[];
  readonly retainedFraction: number;
  readonly requestedRetainedFraction: number;
}

const outputUrl = new URL("../output/world-modern/", import.meta.url);
const report = JSON.parse(
  await readFile(new URL("review-report.json", outputUrl), "utf8")
) as ReviewReport;

test("uniform policy replaces country-specific golden counts", () => {
  assert.equal(report.requestedRetainedFraction, 0.5);
  assert.ok(report.retainedFraction >= report.requestedRetainedFraction);
  assert.ok(report.provinceCount < report.sourceProvinceCount);
  assert.ok(report.countryCounts.DZA < 47);
  assert.ok(
    report.provinces.every((province) => !["manual", "automatic"].includes(province.method))
  );
});

test("every source province is assigned exactly once", () => {
  const members = report.provinces.flatMap((province) => province.members);
  assert.equal(members.length, report.sourceProvinceCount);
  assert.equal(new Set(members).size, report.sourceProvinceCount);
});

test("dynamic thresholds and low-area exceptions are auditable", () => {
  for (const [countryId, summary] of Object.entries(report.countrySummary)) {
    assert.ok(summary.minimumAreaKm2 >= 10_000 && summary.minimumAreaKm2 <= 100_000, countryId);
    assert.ok(summary.areaKm2 >= 0, countryId);
    assert.equal(summary.after, report.countryCounts[countryId]);
    assert.equal(
      summary.belowMinimum,
      report.provinces.filter(
        (province) => province.countryId === countryId && province.belowMinimumReason !== undefined
      ).length
    );
  }
  for (const province of report.provinces) {
    if (province.areaKm2 + 1 < province.minimumAreaKm2) {
      assert.equal(province.belowMinimumReason, "no-legal-neighbor", province.id);
    }
  }
});

test("France uses macroregion names rather than department names", () => {
  const departmentNames = /Territoire de Belfort|Doubs|Jura|Manche|Calvados/;
  const france = report.provinces.filter((province) => province.countryId === "FRA");
  assert.ok(france.length > 0);
  assert.ok(france.every((province) => !departmentNames.test(province.nameEn)));
  assert.ok(france.some((province) => province.nameEn.includes("Bourgogne-Franche-Comté")));
});

test("countries over 5 million km2 skip official macroregions", () => {
  const largeCountries = new Set(
    Object.entries(report.countrySummary)
      .filter(([, summary]) => summary.areaKm2 > 5_000_000)
      .map(([countryId]) => countryId)
  );
  assert.ok(largeCountries.size > 0);
  assert.ok(
    report.provinces.every(
      (province) => !largeCountries.has(province.countryId) || province.method !== "official-region"
    )
  );
  assert.ok(
    report.provinces
      .filter((province) => largeCountries.has(province.countryId))
      .every(
        (province) => !/^(Northeast|Midwest|South|West|Siberian|Central)$/i.test(province.nameEn)
      )
  );
});

test("Baikonur is absorbed into Kazakhstan instead of remaining KAB", () => {
  assert.equal(report.countryCounts.KAB, undefined);
  assert.equal(report.countrySummary.KAB, undefined);
  assert.ok(report.provinces.every((province) => province.countryId !== "KAB"));
  const kyzylorda = report.provinces.find((province) => province.members.includes("KZ-KZY"));
  assert.ok(kyzylorda?.members.includes("-99-X05~"));
  assert.equal(kyzylorda?.countryId, "KAZ");
  assert.doesNotMatch(kyzylorda?.name ?? "", /Bai|Bay/i);
});

test("known same-country enclosures use the general enclosure rule", () => {
  const berlin = report.provinces.find((province) => province.members.includes("DE-BE"));
  assert.ok(berlin?.members.includes("DE-BB"));
  const bremen = report.provinces.find((province) => province.members.includes("DE-HB"));
  assert.ok(bremen?.members.includes("DE-NI"));
});

test("no independent city assets are generated", async () => {
  await assert.rejects(access(new URL("cities.geojson", outputUrl)));
  await assert.rejects(access(new URL("cities.json", outputUrl)));
});
