export interface EntityListItem {
  readonly id: string;
  readonly title: string;
  readonly meta?: string;
}

export interface EntityListProps {
  readonly items: readonly EntityListItem[];
  readonly emptyHint?: string;
  readonly ariaLabel?: string;
  readonly onSelect: (id: string) => void;
}

export function EntityList(props: EntityListProps): React.JSX.Element {
  if (props.items.length === 0) {
    return <p className="entity-list-empty">{props.emptyHint ?? "No entries."}</p>;
  }

  return (
    <ul className="entity-list" aria-label={props.ariaLabel ?? "Entries"}>
      {props.items.map((item) => (
        <li key={item.id}>
          <button type="button" className="entity-list-item" onClick={() => props.onSelect(item.id)}>
            <span className="entity-list-title">{item.title}</span>
            {item.meta === undefined ? null : <span className="entity-list-meta">{item.meta}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
