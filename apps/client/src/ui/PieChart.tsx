export interface PieSlice {
  readonly id: string;
  readonly label: string;
  readonly value: number;
}

export interface PieChartProps {
  readonly title: string;
  readonly slices: readonly PieSlice[];
  readonly size?: number;
}

const PALETTE = [
  "#5eb8c9",
  "#7aa2e3",
  "#c9a05e",
  "#8bc48a",
  "#c97a9a",
  "#9b8ad4",
  "#d4a37a",
  "#6db8a0",
  "#b0b8c4",
  "#e08a6a",
  "#6a9bc4"
];

function polar(cx: number, cy: number, radius: number, angle: number): readonly [number, number] {
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
}

function slicePath(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number
): string {
  const [x1, y1] = polar(cx, cy, radius, startAngle);
  const [x2, y2] = polar(cx, cy, radius, endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
}

export function PieChart(props: PieChartProps): React.JSX.Element {
  const size = props.size ?? 120;
  const radius = size / 2 - 2;
  const cx = size / 2;
  const cy = size / 2;
  const total = props.slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0);
  const visible = props.slices.filter((slice) => slice.value > 0);

  let angle = -Math.PI / 2;
  const paths =
    total <= 0
      ? []
      : visible.length === 1
        ? [
            {
              id: visible[0]!.id,
              d: `M ${cx} ${cy} m ${-radius} 0 a ${radius} ${radius} 0 1 0 ${radius * 2} 0 a ${radius} ${radius} 0 1 0 ${-radius * 2} 0`,
              color: PALETTE[0]!
            }
          ]
        : visible.map((slice, index) => {
            const sweep = (slice.value / total) * Math.PI * 2;
            const start = angle;
            const end = angle + sweep;
            angle = end;
            return {
              id: slice.id,
              d: slicePath(cx, cy, radius, start, end),
              color: PALETTE[index % PALETTE.length]!
            };
          });

  return (
    <div className="pie-chart">
      <p className="label">{props.title}</p>
      <div className="pie-chart-body">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          {paths.length === 0 ? (
            <circle cx={cx} cy={cy} r={radius} fill="#1a2838" stroke="#2a4054" />
          ) : (
            paths.map((path) => <path key={path.id} d={path.d} fill={path.color} />)
          )}
        </svg>
        <ul className="pie-chart-legend">
          {visible.length === 0 ? <li className="pie-chart-empty">No data</li> : null}
          {visible.map((slice, index) => {
            const share = total > 0 ? ((slice.value / total) * 100).toFixed(1) : "0.0";
            return (
              <li key={slice.id}>
                <span
                  className="pie-chart-swatch"
                  style={{ background: PALETTE[index % PALETTE.length] }}
                />
                <span className="pie-chart-legend-label">{slice.label}</span>
                <span className="pie-chart-legend-value">{share}%</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export function countsToSlices(
  counts: Readonly<Record<string, number>> | undefined,
  labelOf: (key: string) => string
): PieSlice[] {
  if (counts === undefined) return [];
  return Object.entries(counts)
    .filter(([, value]) => value > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ id: key, label: labelOf(key), value }));
}
