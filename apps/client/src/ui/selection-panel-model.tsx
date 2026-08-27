import { SelectionPanel, type EntityPanelTab } from "./EntityPanel.js";
import {
  countryDisplayName,
  formatCount,
  formatGdp,
  provinceDisplayName,
  type GameUiLookups
} from "./game-lookups.js";
import type { MapSelection } from "./selection.js";

function Stats(props: { readonly rows: readonly (readonly [string, string])[] }): React.JSX.Element {
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

function socialClassRows(
  populationBySocialClass: Readonly<Record<string, number>> | undefined
): readonly (readonly [string, string])[] {
  if (populationBySocialClass === undefined) return [];
  return Object.entries(populationBySocialClass)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([classId, count]) => [classId, formatCount(count)] as const);
}

export function buildSelectionPanelModel(
  selection: MapSelection | undefined,
  lookups: GameUiLookups | undefined,
  gameDate: string
): {
  title: string;
  subtitle?: string;
  tabs: readonly EntityPanelTab[];
} {
  if (selection === undefined || lookups === undefined) {
    return { title: "未选择", tabs: [] };
  }

  if (selection.kind === "province") {
    const feature = lookups.findProvince(selection.id);
    const ownerId = lookups.getOwner(selection.id);
    const pop = lookups.getProvincePopulation(selection.id);
    const demo = pop?.demographics;
    const summary = pop?.summary;
    const country = ownerId === undefined ? "—" : countryDisplayName(lookups, ownerId);
    const name = provinceDisplayName(feature, selection.id);
    const capital =
      feature?.properties.capital.nameEn ?? feature?.properties.capital.name ?? "—";
    const tabs: EntityPanelTab[] = [
      {
        id: "overview",
        label: "概况",
        content: (
          <section className="inspector-section">
            <p className="label">概况</p>
            <Stats
              rows={[
                ["稳定 ID", selection.id],
                ["当前日期", gameDate],
                ["所属国家", country],
                ["首府", capital],
                ["人口", formatCount(summary?.populationPersons)],
                ["就业率", summary === undefined ? "—" : `${(summary.employmentRate * 100).toFixed(1)}%`],
                ["GDP (PPP)", formatGdp()]
              ]}
            />
          </section>
        )
      }
    ];
    if (summary !== undefined && summary.populationPersons > 0) {
      tabs.push({
        id: "population",
        label: "人口",
        content: (
          <section className="inspector-section">
            <p className="label">人口</p>
            <Stats
              rows={[
                ["总人口", formatCount(summary.populationPersons)],
                ["男性", formatCount(demo?.male)],
                ["女性", formatCount(demo?.female)],
                ["0–14", formatCount(demo?.age.child_0_14)],
                ["15–24", formatCount(demo?.age.youth_15_24)],
                ["25–44", formatCount(demo?.age.prime_25_44)],
                ["45–64", formatCount(demo?.age.mature_45_64)],
                ["65+", formatCount(demo?.age.senior_65_plus)],
                ["就业", formatCount(summary.employedPersons)],
                ["失业", formatCount(summary.unemployedPersons)],
                ...socialClassRows(summary.populationBySocialClass)
              ]}
            />
          </section>
        )
      });
    }
    return {
      title: name,
      subtitle: `${country} · ${feature?.properties.isoA2 ?? "—"}`,
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
        label: "概况",
        content: (
          <section className="inspector-section">
            <p className="label">概况</p>
            <Stats
              rows={[
                ["国家代码", selection.id],
                ["当前日期", gameDate],
                ["省份数", formatCount(aggregate?.provinceCount)],
                ["人口", formatCount(aggregate?.populationPersons)],
                ["GDP (PPP)", formatGdp()]
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
  const model = buildSelectionPanelModel(props.selection, props.lookups, props.gameDate);
  return (
    <SelectionPanel
      selection={props.selection}
      title={model.title}
      {...(model.subtitle === undefined ? {} : { subtitle: model.subtitle })}
      tabs={model.tabs}
      emptyHint="在地图上点击一个省份或国家，查看概况与详情标签页。"
      {...(props.onClose === undefined ? {} : { onClose: props.onClose })}
    />
  );
}
