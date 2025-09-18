import { useEffect, useState } from 'react';

export function ThemeSwitcher() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    document.body.classList.toggle('dark-mode', dark);
  }, [dark]);

  return (
    <div className="glass-card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 700 }}>🎨 主题切换</div>
          <div style={{ opacity: .8, fontSize: 13 }}>切换浅色/深色（占位示例）</div>
        </div>
        <button className="btn" onClick={() => setDark(v => !v)}>{dark ? '明亮' : '黑暗'}</button>
      </div>
    </div>
  );
}

