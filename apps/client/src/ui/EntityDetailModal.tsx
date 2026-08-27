import { useEffect, useRef, type ReactNode } from "react";

export interface EntityDetailModalProps {
  readonly open: boolean;
  readonly title: string;
  readonly subtitle?: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
}

export function EntityDetailModal(props: EntityDetailModalProps): React.JSX.Element | null {
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;

  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.open]);

  if (!props.open) return null;

  return (
    <div className="entity-modal-backdrop" role="presentation" onClick={props.onClose}>
      <div
        className="entity-modal"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="entity-modal-header">
          <div>
            <h2>{props.title}</h2>
            {props.subtitle === undefined ? null : (
              <p className="entity-modal-sub">{props.subtitle}</p>
            )}
          </div>
          <button type="button" className="inspector-close" onClick={props.onClose}>
            Close
          </button>
        </header>
        <div className="entity-modal-body">{props.children}</div>
      </div>
    </div>
  );
}
