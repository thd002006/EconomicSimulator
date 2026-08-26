import { laborForcePopulation } from "./state";
import {
  EDUCATION_LEVELS,
  SKILL_LEVELS,
  type EmployerId,
  type EmploymentArrangement,
  type PopulationClassState,
  type PopulationWorld
} from "./types";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function allocationKey(
  provinceId: string,
  employerId: EmployerId,
  jobTypeId: string,
  socialClassId: string,
  arrangement: string
): string {
  return `${provinceId}|${employerId}|${jobTypeId}|${socialClassId}|${arrangement}`;
}

function educationEligibility(state: PopulationClassState, minimumEducationIndex: number): number {
  const workingAge =
    state.workingAgeEducationCounts.basic +
    state.workingAgeEducationCounts.secondary +
    state.workingAgeEducationCounts.tertiary +
    state.workingAgeEducationCounts.advanced;
  if (workingAge <= 0) {
    return 0;
  }
  let eligible = 0;
  for (let index = minimumEducationIndex; index < EDUCATION_LEVELS.length; index += 1) {
    eligible +=
      state.workingAgeEducationCounts[
        EDUCATION_LEVELS[index] as keyof typeof state.workingAgeEducationCounts
      ];
  }
  return eligible / workingAge;
}

function skillEligibility(state: PopulationClassState, minimumSkillIndex: number): number {
  const laborForce = laborForcePopulation(state);
  if (laborForce <= 0) {
    return 0;
  }
  let eligible = 0;
  for (let index = minimumSkillIndex; index < SKILL_LEVELS.length; index += 1) {
    eligible +=
      state.laborForceSkillCounts[SKILL_LEVELS[index] as keyof typeof state.laborForceSkillCounts];
  }
  return eligible / laborForce;
}

interface Vacancy {
  readonly provinceId: string;
  readonly employerId: EmployerId;
  readonly jobTypeId: string;
  readonly arrangement: EmploymentArrangement;
  offeredMonthlyWageCentsPerFte: number;
  readonly workingConditionScore: number;
  vacancyFte: number;
}

export function runLaborMarketStep(world: PopulationWorld): void {
  runLayoffs(world);
  fillVacancies(world);
  updateReferenceWages(world);
  const violations = collectEmploymentAllocationViolations(world);
  if (violations.length > 0) {
    throw new Error(`Employment allocation invariant violated: ${violations.join("; ")}`);
  }
}

export function collectEmploymentAllocationViolations(world: PopulationWorld): string[] {
  const violations: string[] = [];
  const tolerance = world.staticData.laborMarketParameters.populationTolerance;
  const employedFteByClass = new Map<string, number>();

  for (const [key, allocation] of world.allocations) {
    if (!Number.isFinite(allocation.employedFte) || allocation.employedFte < -tolerance) {
      violations.push(`${key}: invalid employedFte.`);
      continue;
    }
    const classKey = `${allocation.provinceId}|${allocation.socialClassId}`;
    employedFteByClass.set(
      classKey,
      (employedFteByClass.get(classKey) ?? 0) + allocation.employedFte
    );
  }

  for (const [classKey, employedFte] of employedFteByClass) {
    const separatorIndex = classKey.indexOf("|");
    const state = world.classStatesByProvince
      .get(classKey.slice(0, separatorIndex))
      ?.get(classKey.slice(separatorIndex + 1));
    if (!state) {
      violations.push(`${classKey}: allocation without population state.`);
      continue;
    }
    if (Math.abs(employedFte - state.employmentStatusCounts.employed) > tolerance) {
      violations.push(
        `${classKey}: allocated FTE ${employedFte} != employed ${state.employmentStatusCounts.employed}.`
      );
    }
  }

  const desiredFteByDemand = new Map<string, number>();
  for (const employer of world.employers.values()) {
    for (const demand of employer.jobDemands) {
      desiredFteByDemand.set(
        `${employer.id}|${demand.jobTypeId}|${demand.arrangement}`,
        demand.desiredFte
      );
    }
  }
  for (const [key, allocation] of world.allocations) {
    const desired = desiredFteByDemand.get(
      `${allocation.employerId}|${allocation.jobTypeId}|${allocation.arrangement}`
    );
    if (desired !== undefined && allocation.employedFte > desired + tolerance) {
      violations.push(`${key}: allocation exceeds desired FTE.`);
    }
  }

  return violations;
}

function runLayoffs(world: PopulationWorld): void {
  for (const key of [...world.allocations.keys()].sort()) {
    const allocation = world.allocations.get(key);
    if (!allocation) {
      continue;
    }
    const employer = world.employers.get(allocation.employerId);
    let desiredFte = 0;
    if (employer && world.employerProvinces.has(allocation.employerId)) {
      for (const demand of employer.jobDemands) {
        if (
          demand.jobTypeId === allocation.jobTypeId &&
          demand.arrangement === allocation.arrangement
        ) {
          desiredFte += demand.desiredFte;
        }
      }
    }
    if (allocation.employedFte > desiredFte + 1e-9) {
      const laidOff = allocation.employedFte - desiredFte;
      allocation.employedFte = desiredFte;
      const classes = world.classStatesByProvince.get(allocation.provinceId);
      const state = classes?.get(allocation.socialClassId);
      if (state) {
        state.employmentStatusCounts.employed -= laidOff;
        state.employmentStatusCounts.unemployed += laidOff;
      }
      if (allocation.employedFte <= 1e-9) {
        world.allocations.delete(key);
      }
    }
  }
}

function fillVacancies(world: PopulationWorld): void {
  const allVacancies: Vacancy[] = [];

  for (const [employerId, employer] of world.employers) {
    const provinceId = world.employerProvinces.get(employerId);
    if (!provinceId) {
      continue;
    }
    for (const demand of employer.jobDemands) {
      const jobType = world.jobTypeById.get(demand.jobTypeId);
      if (!jobType || demand.desiredFte <= 0) {
        continue;
      }
      let employedFte = 0;
      for (const allocation of world.allocations.values()) {
        if (
          allocation.employerId === employerId &&
          allocation.jobTypeId === demand.jobTypeId &&
          allocation.arrangement === demand.arrangement
        ) {
          employedFte += allocation.employedFte;
        }
      }
      const vacancyFte = Math.max(0, demand.desiredFte - employedFte);
      if (vacancyFte <= 1e-9) {
        continue;
      }
      allVacancies.push({
        provinceId,
        employerId,
        jobTypeId: demand.jobTypeId,
        arrangement: demand.arrangement,
        offeredMonthlyWageCentsPerFte: demand.offeredMonthlyWageCentsPerFte,
        workingConditionScore: jobType.workingConditionScore,
        vacancyFte
      });
    }
  }

  allVacancies.sort(
    (first, second) =>
      second.offeredMonthlyWageCentsPerFte - first.offeredMonthlyWageCentsPerFte ||
      second.workingConditionScore - first.workingConditionScore ||
      first.employerId.localeCompare(second.employerId) ||
      first.jobTypeId.localeCompare(second.jobTypeId)
  );

  const remainingJobSeekers = new Map<string, number>();

  for (const vacancy of allVacancies) {
    const jobType = world.jobTypeById.get(vacancy.jobTypeId);
    if (!jobType) {
      continue;
    }
    const classes = world.classStatesByProvince.get(vacancy.provinceId);
    if (!classes) {
      continue;
    }

    interface Candidate {
      readonly socialClassId: string;
      hireable: number;
      readonly fitScore: number;
    }
    const candidates: Candidate[] = [];

    for (const socialClassId of [...classes.keys()].sort()) {
      const state = classes.get(socialClassId);
      const definition = world.socialClassById.get(socialClassId);
      if (!state || !definition) {
        continue;
      }
      const seekerKey = `${vacancy.provinceId}|${socialClassId}`;
      let seekers = remainingJobSeekers.get(seekerKey);
      if (seekers === undefined) {
        seekers = Math.max(0, state.employmentStatusCounts.unemployed);
        remainingJobSeekers.set(seekerKey, seekers);
      }
      if (seekers <= 1e-9) {
        continue;
      }

      const compatibility = definition.jobCompatibilityByCategory[jobType.categoryId] ?? 0;
      if (compatibility <= 0) {
        continue;
      }

      const educationShare = educationEligibility(
        state,
        EDUCATION_LEVELS.indexOf(jobType.minimumEducation)
      );
      const skillShare = skillEligibility(state, SKILL_LEVELS.indexOf(jobType.minimumSkill));
      const estimatedEligible = seekers * educationShare * skillShare * compatibility;

      const effectiveOffer = vacancy.offeredMonthlyWageCentsPerFte * jobType.workingConditionScore;
      const reservationWage =
        world.staticData.laborMarketParameters.provinceSubsistenceCostCentsPerMonth *
        definition.reservationWageMultiplier;
      const acceptanceRate = clamp(
        (effectiveOffer / Math.max(reservationWage, 1) -
          world.staticData.laborMarketParameters.acceptanceRateFloor) /
          world.staticData.laborMarketParameters.acceptanceRateRange,
        0,
        1
      );

      const hireable = Math.min(vacancy.vacancyFte, seekers, estimatedEligible * acceptanceRate);
      if (hireable <= 1e-9) {
        continue;
      }
      candidates.push({ socialClassId, hireable, fitScore: compatibility });
    }

    candidates.sort(
      (first, second) =>
        second.fitScore - first.fitScore || first.socialClassId.localeCompare(second.socialClassId)
    );

    for (const candidate of candidates) {
      if (vacancy.vacancyFte <= 1e-9) {
        break;
      }
      const seekerKey = `${vacancy.provinceId}|${candidate.socialClassId}`;
      const seekers = remainingJobSeekers.get(seekerKey) ?? 0;
      const hired = Math.min(candidate.hireable, seekers, vacancy.vacancyFte);
      if (hired <= 1e-9) {
        continue;
      }

      const state = classes.get(candidate.socialClassId);
      if (!state) {
        continue;
      }
      state.employmentStatusCounts.unemployed -= hired;
      state.employmentStatusCounts.employed += hired;
      remainingJobSeekers.set(seekerKey, seekers - hired);

      const key = allocationKey(
        vacancy.provinceId,
        vacancy.employerId,
        vacancy.jobTypeId,
        candidate.socialClassId,
        vacancy.arrangement
      );
      const allocation = world.allocations.get(key);
      if (allocation) {
        allocation.employedFte += hired;
        allocation.paidMonthlyWageCentsPerFte = vacancy.offeredMonthlyWageCentsPerFte;
      } else {
        world.allocations.set(key, {
          provinceId: vacancy.provinceId,
          employerId: vacancy.employerId,
          jobTypeId: vacancy.jobTypeId,
          socialClassId: candidate.socialClassId,
          arrangement: vacancy.arrangement,
          employedFte: hired,
          paidMonthlyWageCentsPerFte: vacancy.offeredMonthlyWageCentsPerFte
        });
      }
      vacancy.vacancyFte -= hired;
    }
  }
}

function updateReferenceWages(world: PopulationWorld): void {
  const jobTypeIdsByProvince = new Map<string, Set<string>>();
  for (const [employerId, employer] of world.employers) {
    const provinceId = world.employerProvinces.get(employerId);
    if (!provinceId) {
      continue;
    }
    let jobTypeIds = jobTypeIdsByProvince.get(provinceId);
    if (!jobTypeIds) {
      jobTypeIds = new Set();
      jobTypeIdsByProvince.set(provinceId, jobTypeIds);
    }
    for (const demand of employer.jobDemands) {
      jobTypeIds.add(demand.jobTypeId);
    }
  }

  for (const provinceId of [...jobTypeIdsByProvince.keys()].sort()) {
    for (const jobTypeId of [...(jobTypeIdsByProvince.get(provinceId) ?? [])].sort()) {
      const jobType = world.jobTypeById.get(jobTypeId);
      if (!jobType) {
        continue;
      }

      let totalDesiredFte = 0;
      let totalFilledFte = 0;
      for (const [employerId, employer] of world.employers) {
        if (world.employerProvinces.get(employerId) !== provinceId) {
          continue;
        }
        for (const demand of employer.jobDemands) {
          if (demand.jobTypeId !== jobTypeId) {
            continue;
          }
          totalDesiredFte += demand.desiredFte;
          for (const allocation of world.allocations.values()) {
            if (
              allocation.employerId === employerId &&
              allocation.jobTypeId === jobTypeId &&
              allocation.arrangement === demand.arrangement
            ) {
              totalFilledFte += allocation.employedFte;
            }
          }
        }
      }

      const referenceKey = `${provinceId}|${jobTypeId}`;
      const currentReferenceWage =
        world.referenceWages.get(referenceKey) ??
        world.staticData.laborMarketParameters.provinceSubsistenceCostCentsPerMonth;

      let compatibleUnemployed = 0;
      let compatibleLaborForce = 0;
      const classes = world.classStatesByProvince.get(provinceId);
      if (classes) {
        for (const [socialClassId, state] of classes) {
          const definition = world.socialClassById.get(socialClassId);
          if (!definition) {
            continue;
          }
          const compatibility = definition.jobCompatibilityByCategory[jobType.categoryId] ?? 0;
          if (compatibility <= 0) {
            continue;
          }
          compatibleUnemployed += state.employmentStatusCounts.unemployed * compatibility;
          compatibleLaborForce += laborForcePopulation(state) * compatibility;
        }
      }

      const vacancyRate =
        totalDesiredFte > 0 ? clamp((totalDesiredFte - totalFilledFte) / totalDesiredFte, 0, 1) : 0;
      const unemploymentPressure =
        compatibleLaborForce > 0 ? clamp(compatibleUnemployed / compatibleLaborForce, 0, 1) : 0;
      const wageSignal = clamp(vacancyRate - unemploymentPressure, -1, 1);

      const nextReferenceWage = clamp(
        currentReferenceWage *
          (1 + world.staticData.laborMarketParameters.monthlyWageAdjustmentRate * wageSignal),
        world.staticData.laborMarketParameters.legalMinimumWageCentsPerMonth,
        world.staticData.laborMarketParameters.configuredMaximumWageCentsPerMonth
      );
      world.referenceWages.set(referenceKey, nextReferenceWage);

      for (const [employerId, employer] of world.employers) {
        if (world.employerProvinces.get(employerId) !== provinceId) {
          continue;
        }
        const employerMultiplier = world.employerWageMultipliers.get(employerId) ?? 1;
        for (const demand of employer.jobDemands) {
          if (demand.jobTypeId === jobTypeId) {
            demand.offeredMonthlyWageCentsPerFte = nextReferenceWage * employerMultiplier;
          }
        }
      }
    }
  }
}
