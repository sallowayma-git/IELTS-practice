export function ExamCard({ title, type, category }: { title: string; type: string; category: string }) {
  return (
    <div className="exam-card glass-card" style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'flex', gap: 8, opacity: .85, fontSize: 13, marginBottom: 10 }}>
        <span>{type === 'reading' ? '📖 阅读' : '🎧 听力'}</span>
        <span>{category}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <button className="btn">开始练习</button>
        <span style={{ color: '#C08FC0', fontWeight: 600 }}>最好 0%</span>
      </div>
    </div>
  );
}

