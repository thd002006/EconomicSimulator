import type { MapFeature } from "@economic-simulator/map-runtime";
import { provinceLabel } from "./map-renderer";

export interface ProvinceInspectorProps {
  readonly feature: MapFeature | undefined;
  /** Current simulated owner id; falls back to geographic adm0A3 when omitted. */
  readonly ownerId?: string;
  readonly gameDate: string;
}

export function ProvinceInspector(props: ProvinceInspectorProps): React.JSX.Element {
  const feature = props.feature;

  if (feature === undefined) {
    return (
      <aside className="inspector" aria-label="省份检视">
        <header className="inspector-header">
          <p className="label">省份</p>
          <h2>未选择</h2>
        </header>
        <p className="inspector-empty">在地图上点击一个省份，查看概况与经济面板入口。</p>
      </aside>
    );
  }

  const name = provinceLabel(feature);
  const country = props.ownerId ?? feature.properties.adm0A3 ?? "—";
  const iso = feature.properties.isoA2 ?? "—";
  const kind = feature.properties.type ?? "一级行政区";

  return (
    <aside className="inspector" aria-label="省份检视">
      <header className="inspector-header">
        <p className="label">省份</p>
        <h2>{name}</h2>
        <p className="inspector-sub">
          {country} · {iso} · {kind}
        </p>
      </header>

      <section className="inspector-section">
        <p className="label">概况</p>
        <dl className="inspector-stats">
          <div>
            <dt>稳定 ID</dt>
            <dd>{feature.id}</dd>
          </div>
          <div>
            <dt>当前日期</dt>
            <dd>{props.gameDate}</dd>
          </div>
          <div>
            <dt>所属国家</dt>
            <dd>{country}</dd>
          </div>
        </dl>
      </section>

      <section className="inspector-section">
        <p className="label">经济</p>
        <p className="inspector-placeholder">人口、产出、物价与贸易将接入模拟读模型后在此显示。</p>
      </section>

      <section className="inspector-section">
        <p className="label">政治</p>
        <p className="inspector-placeholder">政体、税制与外交入口预留。</p>
      </section>
    </aside>
  );
}
