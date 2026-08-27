import type { MapSelection } from "./selection.js";
import { hoverStats, type GameUiLookups } from "./game-lookups.js";

export interface MapHoverCardProps {
  readonly selection: MapSelection | undefined;
  readonly lookups: GameUiLookups | undefined;
}

export function MapHoverCard(props: MapHoverCardProps): React.JSX.Element | null {
  if (props.selection === undefined || props.lookups === undefined) return null;
  const stats = hoverStats(props.selection, props.lookups);
  return (
    <div className="map-tooltip" aria-hidden="true">
      <strong>{stats.title}</strong>
      {stats.lines.map((line, index) => (
        <span key={index}>{line}</span>
      ))}
    </div>
  );
}
