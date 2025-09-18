type Props = { value: 'overview' | 'browse' | 'practice' | 'settings'; onChange: (v: Props['value']) => void };

const items: Array<{ key: Props['value']; label: string }> = [
  { key: 'overview', label: '📊 总览' },
  { key: 'browse', label: '📚 题库浏览' },
  { key: 'practice', label: '📝 练习记录' },
  { key: 'settings', label: '⚙️ 设置' }
];

export function Nav({ value, onChange }: Props) {
  return (
    <nav style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
      {items.map(it => (
        <button
          key={it.key}
          className={value === it.key ? 'nav-btn active' : 'nav-btn'}
          onClick={() => onChange(it.key)}
        >
          {it.label}
        </button>
      ))}
    </nav>
  );
}

