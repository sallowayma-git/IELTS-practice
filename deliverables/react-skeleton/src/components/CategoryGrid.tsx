type Item = { icon: string; title: string; meta?: string };
export function CategoryGrid({ items }: { items: Item[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
      {items.map((it, idx) => (
        <div key={idx} className="category-card glass-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 32 }}>{it.icon}</div>
            <div>
              <div style={{ fontWeight: 700 }}>{it.title}</div>
              <div style={{ opacity: .7, fontSize: 12 }}>{it.meta}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

