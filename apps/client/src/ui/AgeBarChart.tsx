import { formatCount } from "./game-lookups.js";

export interface AgeBarChartProps {
  readonly age: readonly number[] | Readonly<Record<string, number>> | undefined;
  readonly title?: string;
}

export function normalizeAgeCounts(
  age: readonly number[] | Readonly<Record<string, number>> | undefined
): number[] {
  const values = new Array(101).fill(0);
  if (age === undefined) return values;

  if (Array.isArray(age)) {
    for (let i = 0; i < Math.min(age.length, 101); i++) {
      values[i] = Math.max(0, Number(age[i]) || 0);
    }
    return values;
  }

  for (const [key, val] of Object.entries(age)) {
    const parsedAge = Number.parseInt(key, 10);
    if (Number.isInteger(parsedAge) && parsedAge >= 0 && parsedAge <= 100) {
      values[parsedAge] = Math.max(0, Number(val) || 0);
    }
  }
  return values;
}

export function AgeBarChart(props: AgeBarChartProps): React.JSX.Element {
  const title = props.title ?? "Age distribution";
  const values = normalizeAgeCounts(props.age);
  const total = values.reduce((sum, count) => sum + count, 0);
  const maxValue = Math.max(0, ...values);

  // SVG coordinate dimensions
  const chartHeight = 85;
  const axisHeight = 20;
  const totalHeight = chartHeight + axisHeight;
  const totalWidth = 303; // 101 * 3 = 303px wide coordinate space
  const barWidth = 2.2;
  const barPitch = 3; // 101 * 3 = 303

  const ticks = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  return (
    <div className="age-bar-chart">
      <div className="age-bar-header">
        <p className="label">{title}</p>
      </div>
      {total <= 0 ? (
        <p className="inspector-empty">No age data</p>
      ) : (
        <div className="age-bar-body">
          <svg
            className="age-bar-svg"
            viewBox={`0 0 ${totalWidth} ${totalHeight}`}
            preserveAspectRatio="none"
            aria-label="Age distribution histogram"
          >
            {/* Grid baseline */}
            <line
              x1="0"
              y1={chartHeight}
              x2={totalWidth}
              y2={chartHeight}
              stroke="#2a4054"
              strokeWidth="1"
            />

            {/* 101 single-year age bars */}
            {values.map((count, index) => {
              const x = index * barPitch + (barPitch - barWidth) / 2;
              const height = maxValue > 0 ? (count / maxValue) * (chartHeight - 4) : 0;
              const y = chartHeight - height;
              const share = total > 0 ? ((count / total) * 100).toFixed(1) : "0.0";

              return (
                <rect
                  key={index}
                  className="age-bar-rect"
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(0, height)}
                  rx={0.5}
                >
                  <title>
                    Age {index}: {formatCount(count)} ({share}%)
                  </title>
                </rect>
              );
            })}

            {/* 10-year tick marks and labels */}
            {ticks.map((ageTick) => {
              const x = ageTick * barPitch + barPitch / 2;
              let anchor = "middle";
              if (ageTick === 0) anchor = "start";
              if (ageTick === 100) anchor = "end";

              return (
                <g key={ageTick} className="age-bar-tick-group">
                  <line
                    x1={x}
                    y1={chartHeight}
                    x2={x}
                    y2={chartHeight + 4}
                    stroke="#35516a"
                    strokeWidth="1"
                  />
                  <text
                    x={x}
                    y={chartHeight + 15}
                    textAnchor={anchor}
                    className="age-bar-tick-label"
                  >
                    {ageTick}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}
