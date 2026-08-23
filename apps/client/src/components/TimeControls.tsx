export type PlaySpeed = 0 | 1 | 5 | 30;

export interface TimeControlsProps {
  readonly dateLabel: string;
  readonly tick: number;
  readonly speed: PlaySpeed;
  readonly disabled?: boolean;
  readonly onPause: () => void;
  readonly onPlay: () => void;
  readonly onSetSpeed: (speed: PlaySpeed) => void;
  readonly onStep: () => void;
}

export function TimeControls(props: TimeControlsProps): React.JSX.Element {
  const paused = props.speed === 0;

  return (
    <div className="time-controls" aria-label="时间控制">
      <div className="time-readout">
        <p className="label">日期</p>
        <strong>{props.dateLabel}</strong>
        <span className="time-tick">第 {props.tick.toLocaleString()} 日</span>
      </div>

      <div className="time-actions">
        <button
          type="button"
          disabled={props.disabled}
          aria-pressed={paused}
          onClick={props.onPause}
        >
          暂停
        </button>
        <button
          type="button"
          disabled={props.disabled}
          aria-pressed={!paused && props.speed === 1}
          onClick={() => {
            props.onSetSpeed(1);
            props.onPlay();
          }}
        >
          1×
        </button>
        <button
          type="button"
          disabled={props.disabled}
          aria-pressed={props.speed === 5}
          onClick={() => props.onSetSpeed(5)}
        >
          5×
        </button>
        <button
          type="button"
          disabled={props.disabled}
          aria-pressed={props.speed === 30}
          onClick={() => props.onSetSpeed(30)}
        >
          30×
        </button>
        <button type="button" disabled={props.disabled === true || !paused} onClick={props.onStep}>
          +1 日
        </button>
      </div>
    </div>
  );
}
