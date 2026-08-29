import { useEffect, useState } from "react";
import type { ProvinceClassPopulationBreakdown } from "@economic-simulator/simulation-core";
import terrainPlaceholder from "../assets/province-terrain-placeholder.svg";
import { EntityDetailModal } from "./EntityDetailModal.js";
import { EntityList } from "./EntityList.js";
import { SelectionPanel, type EntityPanelTab } from "./EntityPanel.js";
import { countsToSlices, PieChart } from "./PieChart.js";
import {
  ageCountsToSingleYearRecord,
  countryDisplayName,
  dimensionLabel,
  formatAreaKm2,
  formatCount,
  formatGdp,
  formatLivability,
  provinceDisplayName,
  socialClassDisplayName,
  type GameUiLookups
} from "./game-lookups.js";
import type { MapSelection } from "./selection.js";

function Stats(props: {
  readonly rows: readonly (readonly [string, string])[];
}): React.JSX.Element {
  return (
    <dl className="inspector-stats">
      {props.rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DimensionPies(props: {
  readonly charts: readonly {
    readonly title: string;
    readonly slices: ReturnType<typeof countsToSlices>;
  }[];
}): React.JSX.Element {
  return (
    <div className="pie-chart-grid">
      {props.charts.map((chart) => (
        <PieChart key={chart.title} title={chart.title} slices={chart.slices} />
      ))}
    </div>
  );
}

function classDetailBody(entry: ProvinceClassPopulationBreakdown): React.JSX.Element {
  return (
    <>
      <Stats rows={[["Population", formatCount(entry.populationPersons)]]} />
      <DimensionPies
        charts={[
          {
            title: "Gender",
            slices: countsToSlices(entry.gender, (key) => dimensionLabel("gender", key))
          },
          {
            title: "Age",
            slices: countsToSlices(ageCountsToSingleYearRecord(entry.age), (key) =>
              dimensionLabel("age", key)
            )
          },
          {
            title: "Education",
            slices: countsToSlices(entry.education, (key) => dimensionLabel("education", key))
          },
          {
            title: "Skill",
            slices: countsToSlices(entry.skill, (key) => dimensionLabel("skill", key))
          },
          {
            title: "Employment",
            slices: countsToSlices(entry.employment, (key) => dimensionLabel("employment", key))
          }
        ]}
      />
    </>
  );
}

export function buildSelectionPanelModel(
  selection: MapSelection | undefined,
  lookups: GameUiLookups | undefined,
  gameDate: string,
  onOpenSocialClass: (socialClassId: string) => void
): {
  title: string;
  subtitle?: string;
  headerMedia?: React.JSX.Element;
  tabs: readonly EntityPanelTab[];
} {
  if (selection === undefined || lookups === undefined) {
    return { title: "None selected", tabs: [] };
  }

  if (selection.kind === "province") {
    const feature = lookups.findProvince(selection.id);
    const ownerId = lookups.getOwner(selection.id);
    const pop = lookups.getProvincePopulation(selection.id);
    const demo = pop?.demographics;
    const summary = pop?.summary;
    const country = ownerId === undefined ? "—" : countryDisplayName(lookups, ownerId);
    const name = provinceDisplayName(feature, selection.id);
    const description = feature?.properties.description?.trim() || "—";
    const tabs: EntityPanelTab[] = [
      {
        id: "overview",
        label: "Overview",
        content: (
          <section className="inspector-section">
            <p className="label">Overview</p>
            <Stats
              rows={[
                ["Description", description],
                ["Population", formatCount(summary?.populationPersons)],
                ["GDP", formatGdp(lookups.getProvinceGdpPpp(selection.id))],
                ["Arable land", formatAreaKm2(lookups.getProvinceArableLandKm2(selection.id))],
                ["Livability", formatLivability(lookups.getProvinceLivability(selection.id))]
              ]}
            />
          </section>
        )
      }
    ];
    if (summary !== undefined && summary.populationPersons > 0) {
      tabs.push({
        id: "population",
        label: "Population",
        content: (
          <section className="inspector-section">
            <p className="label">Population</p>
            <DimensionPies
              charts={[
                {
                  title: "Gender",
                  slices: countsToSlices(
                    demo === undefined ? undefined : { male: demo.male, female: demo.female },
                    (key) => dimensionLabel("gender", key)
                  )
                },
                {
                  title: "Age",
                  slices: countsToSlices(ageCountsToSingleYearRecord(demo?.age), (key) =>
                    dimensionLabel("age", key)
                  )
                },
                {
                  title: "Employment",
                  slices: countsToSlices(demo?.employment, (key) =>
                    dimensionLabel("employment", key)
                  )
                },
                {
                  title: "Social class",
                  slices: countsToSlices(summary.populationBySocialClass, (key) =>
                    dimensionLabel("social_class", key)
                  )
                }
              ]}
            />
          </section>
        )
      });
      tabs.push({
        id: "classes",
        label: "Classes",
        content: (
          <section className="inspector-section">
            <p className="label">Classes</p>
            <EntityList
              ariaLabel="Social classes"
              emptyHint="No social classes with population in this province."
              items={(pop?.classes ?? []).map((entry) => ({
                id: entry.socialClassId,
                title: socialClassDisplayName(entry.socialClassId),
                meta: formatCount(entry.populationPersons)
              }))}
              onSelect={onOpenSocialClass}
            />
          </section>
        )
      });
    }
    return {
      title: name,
      subtitle: `${country} · ${feature?.properties.isoA2 ?? "—"}`,
      headerMedia: (
        <img
          className="inspector-terrain"
          src={terrainPlaceholder}
          alt=""
          width={640}
          height={240}
        />
      ),
      tabs
    };
  }

  const aggregate = lookups.getCountryPopulation(selection.id);
  const name = countryDisplayName(lookups, selection.id);
  return {
    title: name,
    subtitle: selection.id,
    tabs: [
      {
        id: "overview",
        label: "Overview",
        content: (
          <section className="inspector-section">
            <p className="label">Overview</p>
            <Stats
              rows={[
                ["Country code", selection.id],
                ["Current date", gameDate],
                ["Provinces", formatCount(aggregate?.provinceCount)],
                ["Population", formatCount(aggregate?.populationPersons)],
                ["GDP", formatGdp(lookups.getCountryGdpPpp(selection.id))]
              ]}
            />
          </section>
        )
      }
    ]
  };
}

export interface EntitySelectionPanelProps {
  readonly selection: MapSelection | undefined;
  readonly lookups: GameUiLookups | undefined;
  readonly gameDate: string;
  readonly onClose?: () => void;
}

export function EntitySelectionPanel(props: EntitySelectionPanelProps): React.JSX.Element {
  const [openClassId, setOpenClassId] = useState<string | undefined>(undefined);

  useEffect(() => {
    setOpenClassId(undefined);
  }, [props.selection?.kind, props.selection?.id]);

  const model = buildSelectionPanelModel(
    props.selection,
    props.lookups,
    props.gameDate,
    (socialClassId) => setOpenClassId(socialClassId)
  );

  const classEntry =
    openClassId === undefined || props.selection?.kind !== "province"
      ? undefined
      : props.lookups
          ?.getProvincePopulation(props.selection.id)
          ?.classes.find((entry) => entry.socialClassId === openClassId);

  return (
    <>
      <SelectionPanel
        selection={props.selection}
        title={model.title}
        {...(model.subtitle === undefined ? {} : { subtitle: model.subtitle })}
        {...(model.headerMedia === undefined ? {} : { headerMedia: model.headerMedia })}
        tabs={model.tabs}
        emptyHint="Click a province or country on the map to inspect overview and detail tabs."
        {...(props.onClose === undefined ? {} : { onClose: props.onClose })}
      />
      <EntityDetailModal
        open={classEntry !== undefined}
        title={classEntry === undefined ? "" : socialClassDisplayName(classEntry.socialClassId)}
        subtitle={model.title}
        onClose={() => setOpenClassId(undefined)}
      >
        {classEntry === undefined ? null : classDetailBody(classEntry)}
      </EntityDetailModal>
    </>
  );
}
