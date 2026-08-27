import { useMemo, useState, type ReactNode } from "react";
import type { MapSelection, MapSelectionKind } from "./selection.js";
import { getRememberedTab, rememberTab } from "./tab-memory.js";

export interface EntityPanelTab {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
}

export interface EntityPanelProps {
  readonly kind: MapSelectionKind | undefined;
  readonly title: string;
  readonly subtitle?: string;
  readonly emptyHint: string;
  readonly tabs: readonly EntityPanelTab[];
  readonly onClose?: () => void;
}

export function EntityPanel(props: EntityPanelProps): React.JSX.Element {
  const tabIds = useMemo(() => props.tabs.map((tab) => tab.id), [props.tabs]);
  const fallback = tabIds[0] ?? "overview";
  const [activeTab, setActiveTab] = useState(() =>
    props.kind === undefined ? fallback : getRememberedTab(props.kind, tabIds, fallback)
  );

  // Re-sync when selection kind or available tabs change.
  const resolvedTab =
    props.kind === undefined
      ? fallback
      : getRememberedTab(props.kind, tabIds, activeTab);

  if (props.kind === undefined || props.tabs.length === 0) {
    return (
      <aside className="inspector" aria-label="实体检视">
        <header className="inspector-header">
          <p className="label">检视</p>
          <h2>未选择</h2>
        </header>
        <p className="inspector-empty">{props.emptyHint}</p>
      </aside>
    );
  }

  const active = props.tabs.find((tab) => tab.id === resolvedTab) ?? props.tabs[0]!;

  const onTabClick = (tabId: string): void => {
    if (props.kind === undefined) return;
    rememberTab(props.kind, tabId);
    setActiveTab(tabId);
  };

  return (
    <aside className="inspector" aria-label="实体检视">
      <header className="inspector-header">
        <div className="inspector-header-row">
          <p className="label">{props.kind === "province" ? "省份" : "国家"}</p>
          {props.onClose === undefined ? null : (
            <button type="button" className="inspector-close" onClick={props.onClose}>
              关闭
            </button>
          )}
        </div>
        <h2>{props.title}</h2>
        {props.subtitle === undefined ? null : <p className="inspector-sub">{props.subtitle}</p>}
      </header>

      {props.tabs.length > 1 ? (
        <div className="inspector-tabs" role="tablist" aria-label="面板标签">
          {props.tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === active.id}
              className={tab.id === active.id ? "inspector-tab is-active" : "inspector-tab"}
              onClick={() => onTabClick(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="inspector-tab-panel" role="tabpanel">
        {active.content}
      </div>
    </aside>
  );
}

export interface SelectionPanelProps {
  readonly selection: MapSelection | undefined;
  readonly title: string;
  readonly subtitle?: string;
  readonly tabs: readonly EntityPanelTab[];
  readonly emptyHint: string;
  readonly onClose?: () => void;
}

/** MapSelection → EntityPanel props. Extend here when new selectable entities need custom panel wiring. */
function panelPropsFromSelection(
  selection: MapSelection | undefined,
  model: Omit<SelectionPanelProps, "selection">
): EntityPanelProps {
  return {
    kind: selection?.kind,
    title: model.title,
    ...(model.subtitle === undefined ? {} : { subtitle: model.subtitle }),
    emptyHint: model.emptyHint,
    tabs: model.tabs,
    ...(model.onClose === undefined ? {} : { onClose: model.onClose })
  };
}

export function SelectionPanel(props: SelectionPanelProps): React.JSX.Element {
  return <EntityPanel {...panelPropsFromSelection(props.selection, props)} />;
}
