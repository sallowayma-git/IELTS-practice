import { useMemo, useState } from 'react';
import { Header } from './components/Header';
import { Nav } from './components/Nav';
import { CategoryGrid } from './components/CategoryGrid';
import { ExamCard } from './components/ExamCard';
import { HistoryList } from './components/HistoryList';
import { ThemeSwitcher } from './components/ThemeSwitcher';
import { SettingsPanel } from './components/SettingsPanel';
import { useLibrary } from './hooks/useLibrary';
import { useRecords } from './hooks/useRecords';

type View = 'overview' | 'browse' | 'practice' | 'settings';

export default function App() {
  const [view, setView] = useState<View>('overview');
  const [search, setSearch] = useState('');
  const { exams, loadedFrom: libFrom, loadFromLocalStorage: loadLib, importJson: importLib } = useLibrary();
  const { records, loadedFrom: recFrom, loadFromLocalStorage: loadRecs, importJson: importRecs } = useRecords();
  const filtered = useMemo(() => exams.filter(e => e.title.toLowerCase().includes(search.toLowerCase())), [exams, search]);

  return (
    <div className="app-container">
      <Header title="My Melody IELTS 学习系统" subtitle="与美乐蒂一起练习 IELTS！" />
      <Nav value={view} onChange={setView} />

      {view === 'overview' && (
        <section className="view glass-card" aria-label="overview">
          <h2>📊 学习总览</h2>
          <CategoryGrid items={[
            { icon: '📖', title: '阅读（P1/P2/P3）', meta: `题目 ${exams.filter(e=>e.type==='reading').length} 项` },
            { icon: '🎧', title: '听力（P3/P4）', meta: `题目 ${exams.filter(e=>e.type==='listening').length} 项` },
            { icon: '📝', title: '练习记录', meta: `共 ${records.length} 条` }
          ]} />
        </section>
      )}

      {view === 'browse' && (
        <section className="view glass-card" aria-label="browse">
          <h2>📚 题库浏览</h2>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <input
              placeholder="搜索题目..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(0,0,0,.15)' }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
            {filtered.map(exam => (
              <ExamCard key={exam.id} title={exam.title} type={exam.type} category={exam.category} />
            ))}
          </div>
        </section>
      )}

      {view === 'practice' && (
        <section className="view glass-card" aria-label="practice">
          <h2>📝 练习记录</h2>
          <HistoryList records={records.map(r => ({ id: r.id, title: r.title || '未知题目', date: r.date || r.endTime || r.startTime || new Date().toISOString(), percentage: r.percentage ?? 0, durationSec: r.duration ?? 0 }))} />
        </section>
      )}

      {view === 'settings' && (
        <section className="view glass-card" aria-label="settings">
          <h2>⚙️ 设置</h2>
          <ThemeSwitcher />
          <div style={{ height: 12 }} />
          <SettingsPanel
            onLoadLibrary={loadLib}
            onImportLibrary={importLib}
            libraryInfo={`来源: ${libFrom} · 当前 ${exams.length} 项`}
            onLoadRecords={loadRecs}
            onImportRecords={importRecs}
            recordsInfo={`来源: ${recFrom} · 当前 ${records.length} 条`}
          />
        </section>
      )}
    </div>
  );
}
