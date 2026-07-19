export interface StatStripItem {
  label: string;
  state?: "critical" | "live" | "neutral";
  value: string;
}

export function StatStrip({ items }: { items: StatStripItem[] }) {
  return (
    <dl className="stat-strip">
      {items.map((item) => (
        <div className="stat-strip__item" key={item.label}>
          <dt>{item.label}</dt>
          <dd className={item.state ? `is-${item.state}` : undefined}>
            {item.state ? (
              <span aria-hidden="true" className="status-dot" />
            ) : null}
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
