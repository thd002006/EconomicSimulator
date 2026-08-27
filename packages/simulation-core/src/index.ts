export { DeterministicSimulationEngine, isSimulationSnapshot } from "./engine";
export { nextXorShift32, normalizeSeed } from "./prng";
export {
  MAX_ADVANCE_TICKS,
  SIMULATION_SNAPSHOT_VERSION,
  type AdvanceResult,
  type CountryId,
  type NewSimulationInput,
  type ProvinceId,
  type ProvincePopulationQueryResult,
  type ScenarioBootstrap,
  type ScenarioProvinceBootstrap,
  type ScenarioProvinceDemographics,
  type SimulationEngine,
  type SimulationSnapshot,
  type SimulationStateV1,
  type SimulationSummary
} from "./types";
export { bootstrapGameWorld, type GameWorldV1 } from "./world-bootstrap";
export {
  applyClassIncomeEvent,
  applyExogenousMigrationCommand,
  aggregateProvinceDemographics,
  createPopulationWorld,
  getCountryPopulationSummary,
  getPopulationInvariantReport,
  getProvinceLaborMarket,
  getProvincePopulationSummary,
  removeEmployer,
  runMonthlyPopulationStep,
  setEmployer,
  upsertJobDemand,
  validatePopulationStaticData,
  type CountryPopulationSummary,
  type ProvinceDemographicBreakdown
} from "./population/index";
export type {
  ClassConsumptionPlan,
  EquityReclassificationEvent,
  ExogenousMigrationCommand,
  InheritanceEvent,
  MonthlyPopulationStepResult,
  PopulationStaticData,
  PopulationWorld,
  ProvinceLaborMarketSummary,
  ProvincePopulationSummary
} from "./population/types";
export type { PopulationInvariantReport } from "./population/index";
