type Props = { title: string; subtitle?: string };

export function Header({ title, subtitle }: Props) {
  return (
    <header className="header glass-card" style={{ padding: 24, margin: '24px auto', textAlign: 'center' }}>
      <div style={{ fontSize: 42, fontWeight: 800, marginBottom: 6 }}>🎀 {title}</div>
      {subtitle && <div style={{ opacity: .85 }}>{subtitle}</div>}
    </header>
  );
}

