import {
  AGE_BANDS,
  BALANCE_SHEET_FIELDS,
  INVESTMENT_BALANCE_SHEET_FIELDS,
  EDUCATION_LEVELS,
  EMPLOYMENT_STATUSES,
  GENDERS,
  SKILL_LEVELS,
  WORKING_AGE_BANDS,
  type AgeBandId,
  type BalanceSheetFieldId,
  type EducationLevelId,
  type EmploymentStatusId,
  type GenderId,
  type PopulationBalanceSheet,
  type PopulationClassState,
  type PopulationIncomeAccumulator,
  type ProvinceId,
  type SkillLevelId,
  type SocialClassId
} from "./types";

const DEFAULT_AGE_SHARES: Readonly<Record<AgeBandId, number>> = {
  child_0_14: 0.24,
  youth_15_24: 0.12,
  prime_25_44: 0.3,
  mature_45_64: 0.22,
  senior_65_plus: 0.12
};

const DEFAULT_EDUCATION_SHARES: Readonly<Record<EducationLevelId, number>> = {
  basic: 0.4,
  secondary: 0.35,
  tertiary: 0.18,
  advanced: 0.07
};

const DEFAULT_SKILL_SHARES: Readonly<Record<SkillLevelId, number>> = {
  low: 0.35,
  medium: 0.35,
  high: 0.22,
  expert: 0.08
};

export const DEFAULT_ETHNICITY_ID = "default";
export const DEFAULT_RELIGION_ID = "default";

export const DEFAULT_CLASS_POPULATION_SHARES: Readonly<Record<SocialClassId, number>> = {
  farmer: 0.35,
  worker: 0.2,
  service_worker: 0.13,
  office_worker: 0.08,
  skilled_worker: 0.05,
  professional: 0.05,
  civil_servant: 0.05,
  small_business_owner: 0.05,
  managerial: 0.02,
  capitalist: 0.01,
  rentier: 0.01
};

export function createEmptyIncomeAccumulator(): PopulationIncomeAccumulator {
  return {
    laborIncomeCents: 0,
    selfEmploymentIncomeCents: 0,
    businessIncomeCents: 0,
    capitalIncomeCents: 0,
    rentIncomeCents: 0,
    transferIncomeCents: 0,
    taxesPaidCents: 0
  };
}

export function createEmptyClassState(
  provinceId: ProvinceId,
  socialClassId: SocialClassId
): PopulationClassState {
  const ageCounts = {} as Record<AgeBandId, number>;
  for (const band of AGE_BANDS) {
    ageCounts[band] = 0;
  }
  const genderCounts = {} as Record<GenderId, number>;
  for (const gender of GENDERS) {
    genderCounts[gender] = 0;
  }
  const educationCounts = {} as Record<EducationLevelId, number>;
  for (const level of EDUCATION_LEVELS) {
    educationCounts[level] = 0;
  }
  const skillCounts = {} as Record<SkillLevelId, number>;
  for (const level of SKILL_LEVELS) {
    skillCounts[level] = 0;
  }
  const statusCounts = {} as Record<EmploymentStatusId, number>;
  for (const status of EMPLOYMENT_STATUSES) {
    statusCounts[status] = 0;
  }

  return {
    provinceId,
    socialClassId,
    populationPersons: 0,
    ageCounts,
    genderCounts,
    workingAgeEducationCounts: educationCounts,
    laborForceSkillCounts: skillCounts,
    employmentStatusCounts: statusCounts,
    ethnicityCounts: {},
    religionCounts: {},
    balanceSheet: createEmptyBalanceSheet(),
    currentPeriodIncome: createEmptyIncomeAccumulator(),
    classTransitionProgress: {}
  };
}

export function createEmptyBalanceSheet(): PopulationBalanceSheet {
  const sheet = {} as PopulationBalanceSheet;
  for (const field of BALANCE_SHEET_FIELDS) {
    sheet[field] = 0;
  }
  return sheet;
}

export interface ObservedProvinceDemographics {
  readonly pop: number;
  readonly male: number;
  readonly female: number;
  readonly age: Readonly<Record<AgeBandId, number>>;
  readonly education15Plus: Readonly<Record<EducationLevelId, number>>;
}

export function seedClassState(
  provinceId: ProvinceId,
  socialClassId: SocialClassId,
  populationPersons: number,
  laborParticipationBaseRate: number,
  observed?: ObservedProvinceDemographics
): PopulationClassState {
  const state = createEmptyClassState(provinceId, socialClassId);
  state.populationPersons = populationPersons;

  if (observed && observed.pop > 0) {
    const totalAge = AGE_BANDS.reduce((sum, band) => sum + (observed.age[band] ?? 0), 0) || observed.pop;
    let remainingAge = populationPersons;
    for (let index = 0; index < AGE_BANDS.length; index += 1) {
      const band = AGE_BANDS[index] as AgeBandId;
      const isLast = index === AGE_BANDS.length - 1;
      if (isLast) {
        state.ageCounts[band] = remainingAge;
      } else {
        const share = (observed.age[band] ?? 0) / totalAge;
        const count = populationPersons * share;
        state.ageCounts[band] = count;
        remainingAge -= count;
      }
    }
    const totalGender = observed.male + observed.female || observed.pop;
    state.genderCounts.male = populationPersons * (observed.male / totalGender);
    state.genderCounts.female = populationPersons - state.genderCounts.male;

    // Education: observed is 15+; apply its shares to working-age (15-64) only.
    // Senior 65+ share is intentionally not distributed here (separate age band).
    const totalEducation15Plus = EDUCATION_LEVELS.reduce(
      (sum, level) => sum + (observed.education15Plus[level] ?? 0),
      0
    );
    const educationShares: Record<EducationLevelId, number> =
      totalEducation15Plus > 0
        ? (Object.fromEntries(
            EDUCATION_LEVELS.map((level) => [
              level,
              (observed.education15Plus[level] ?? 0) / totalEducation15Plus
            ])
          ) as Record<EducationLevelId, number>)
        : { ...DEFAULT_EDUCATION_SHARES };
    const workingAgeTotal = workingAgePopulation(state);
    let remainingEducation = workingAgeTotal;
    for (let index = 0; index < EDUCATION_LEVELS.length; index += 1) {
      const level = EDUCATION_LEVELS[index] as EducationLevelId;
      const isLast = index === EDUCATION_LEVELS.length - 1;
      if (isLast) {
        state.workingAgeEducationCounts[level] = Math.max(0, remainingEducation);
      } else {
        const count = workingAgeTotal * educationShares[level]!;
        state.workingAgeEducationCounts[level] = count;
        remainingEducation -= count;
      }
    }
  } else {
    let remainingAge = populationPersons;
    for (const band of AGE_BANDS) {
      const isLast = band === AGE_BANDS[AGE_BANDS.length - 1];
      const count = isLast ? remainingAge : populationPersons * DEFAULT_AGE_SHARES[band];
      state.ageCounts[band] = count;
      remainingAge -= count;
    }

    state.genderCounts.female = populationPersons / 2;
    state.genderCounts.male = populationPersons - state.genderCounts.female;

    let remainingEducation = workingAgePopulation(state);
    for (let index = 0; index < EDUCATION_LEVELS.length; index += 1) {
      const level = EDUCATION_LEVELS[index] as EducationLevelId;
      const isLast = index === EDUCATION_LEVELS.length - 1;
      if (isLast) {
        state.workingAgeEducationCounts[level] = remainingEducation;
      } else {
        const count = workingAgePopulation(state) * DEFAULT_EDUCATION_SHARES[level];
        state.workingAgeEducationCounts[level] = count;
        remainingEducation -= count;
      }
    }
  }

  const workingAge = workingAgePopulation(state);
  const participating = workingAge * laborParticipationBaseRate;
  state.employmentStatusCounts.unemployed = participating;
  state.employmentStatusCounts.retired = state.ageCounts.senior_65_plus;
  state.employmentStatusCounts.not_in_labor_force =
    state.ageCounts.child_0_14 + (workingAge - participating);

  let remainingSkill = laborForcePopulation(state);
  for (let index = 0; index < SKILL_LEVELS.length; index += 1) {
    const level = SKILL_LEVELS[index] as SkillLevelId;
    const isLast = index === SKILL_LEVELS.length - 1;
    if (isLast) {
      state.laborForceSkillCounts[level] = remainingSkill;
    } else {
      const count = laborForcePopulation(state) * DEFAULT_SKILL_SHARES[level];
      state.laborForceSkillCounts[level] = count;
      remainingSkill -= count;
    }
  }

  state.ethnicityCounts[DEFAULT_ETHNICITY_ID] = populationPersons;
  state.religionCounts[DEFAULT_RELIGION_ID] = populationPersons;

  return state;
}

export function workingAgePopulation(state: PopulationClassState): number {
  let total = 0;
  for (const band of WORKING_AGE_BANDS) {
    total += state.ageCounts[band];
  }
  return total;
}

export function laborForcePopulation(state: PopulationClassState): number {
  return state.employmentStatusCounts.employed + state.employmentStatusCounts.unemployed;
}

export function sumRecord(values: Record<string, number>): number {
  let total = 0;
  for (const key of Object.keys(values)) {
    total += values[key] ?? 0;
  }
  return total;
}

export function scaleDistributions(state: PopulationClassState, factor: number): void {
  state.populationPersons *= factor;
  for (const band of AGE_BANDS) {
    state.ageCounts[band] *= factor;
  }
  for (const gender of GENDERS) {
    state.genderCounts[gender] *= factor;
  }
  for (const level of EDUCATION_LEVELS) {
    state.workingAgeEducationCounts[level] *= factor;
  }
  for (const level of SKILL_LEVELS) {
    state.laborForceSkillCounts[level] *= factor;
  }
  for (const status of EMPLOYMENT_STATUSES) {
    state.employmentStatusCounts[status] *= factor;
  }
  for (const ethnicity of Object.keys(state.ethnicityCounts)) {
    state.ethnicityCounts[ethnicity] = (state.ethnicityCounts[ethnicity] ?? 0) * factor;
  }
  for (const religion of Object.keys(state.religionCounts)) {
    state.religionCounts[religion] = (state.religionCounts[religion] ?? 0) * factor;
  }
  const income = state.currentPeriodIncome;
  income.laborIncomeCents *= factor;
  income.selfEmploymentIncomeCents *= factor;
  income.businessIncomeCents *= factor;
  income.capitalIncomeCents *= factor;
  income.rentIncomeCents *= factor;
  income.transferIncomeCents *= factor;
  income.taxesPaidCents *= factor;
}

export const ORDINARY_BALANCE_SHEET_FIELDS: readonly BalanceSheetFieldId[] =
  BALANCE_SHEET_FIELDS.filter(
    (field): field is BalanceSheetFieldId =>
      !(INVESTMENT_BALANCE_SHEET_FIELDS as readonly string[]).includes(field)
  );

export function moveProportion(
  source: PopulationClassState,
  target: PopulationClassState,
  share: number,
  movedBalanceSheetFields: readonly BalanceSheetFieldId[] = BALANCE_SHEET_FIELDS
): void {
  target.populationPersons += source.populationPersons * share;
  for (const band of AGE_BANDS) {
    target.ageCounts[band] += source.ageCounts[band] * share;
  }
  for (const gender of GENDERS) {
    target.genderCounts[gender] += source.genderCounts[gender] * share;
  }
  for (const level of EDUCATION_LEVELS) {
    target.workingAgeEducationCounts[level] += source.workingAgeEducationCounts[level] * share;
  }
  for (const level of SKILL_LEVELS) {
    target.laborForceSkillCounts[level] += source.laborForceSkillCounts[level] * share;
  }
  for (const status of EMPLOYMENT_STATUSES) {
    target.employmentStatusCounts[status] += source.employmentStatusCounts[status] * share;
  }
  for (const ethnicity of Object.keys(source.ethnicityCounts)) {
    target.ethnicityCounts[ethnicity] =
      (target.ethnicityCounts[ethnicity] ?? 0) + (source.ethnicityCounts[ethnicity] ?? 0) * share;
  }
  for (const religion of Object.keys(source.religionCounts)) {
    target.religionCounts[religion] =
      (target.religionCounts[religion] ?? 0) + (source.religionCounts[religion] ?? 0) * share;
  }
  for (const field of BALANCE_SHEET_FIELDS) {
    if (!movedBalanceSheetFields.includes(field)) {
      continue;
    }
    target.balanceSheet[field] += source.balanceSheet[field] * share;
  }
  const sourceIncome = source.currentPeriodIncome;
  const targetIncome = target.currentPeriodIncome;
  targetIncome.laborIncomeCents += sourceIncome.laborIncomeCents * share;
  targetIncome.selfEmploymentIncomeCents += sourceIncome.selfEmploymentIncomeCents * share;
  targetIncome.businessIncomeCents += sourceIncome.businessIncomeCents * share;
  targetIncome.capitalIncomeCents += sourceIncome.capitalIncomeCents * share;
  targetIncome.rentIncomeCents += sourceIncome.rentIncomeCents * share;
  targetIncome.transferIncomeCents += sourceIncome.transferIncomeCents * share;
  targetIncome.taxesPaidCents += sourceIncome.taxesPaidCents * share;

  scaleDistributions(source, 1 - share);
  const inverseShare = 1 - share;
  for (const field of movedBalanceSheetFields) {
    source.balanceSheet[field] *= inverseShare;
  }
}
