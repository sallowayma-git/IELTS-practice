import { useMemo, useState } from 'react';
import { Header } from './components/Header';
import { Nav } from './components/Nav';
import { CategoryGrid } from './components/CategoryGrid';
import { ExamCard } from './components/ExamCard';
import { HistoryList } from './components/HistoryList';
import { ThemeSwitcher } from './components/ThemeSwitcher';
import { SettingsPanel } from './components/SettingsPanel';
import { ExportPanel } from './components/ExportPanel';
import { useLibrary } from './hooks/useLibrary';
import { useRecords } from './hooks/useRecords';
import { buildHtmlPath, buildPdfPath } from './utils/path';

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
          <BrowseSection />
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
          <div style={{ height: 12 }} />
          <ExportPanel records={records} />
        </section>
      )}
    </div>
  );
}

function BrowseSection() {
  const { exams } = useLibrary();
  const { records } = useRecords();
  const [type, setType] = useState<'all'|'reading'|'listening'>('all');
  const [category, setCategory] = useState<'all'|'P1'|'P2'|'P3'|'P4'>('all');
  const [search, setSearch] = useState('');
  const filtered = useMemo(()=>{
    return exams.filter(e =>
      (type==='all' || e.type===type) &&
      (category==='all' || e.category===category) &&
      (e.title.toLowerCase().includes(search.toLowerCase()))
    );
  }, [exams, type, category, search]);

  const completionMap = useMemo(()=>{
    const map = new Map<string, { best: number }>();
    (records||[]).forEach((r:any)=>{
      const id = String(r.examId ?? r.id ?? r.title);
      const pct = typeof r.percentage==='number'? r.percentage : (typeof r.accuracy==='number'? Math.round(r.accuracy*100):0);
      const prev = map.get(id)?.best ?? 0;
      if (pct>prev) map.set(id, { best: pct });
    });
    return map;
  }, [records]);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        {/* Filter Bar */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="glass-card" style={{ padding: 6, borderRadius: 12, display: 'flex', gap: 6 }}>
            {(['all','reading','listening'] as const).map(t => (
              <button key={t} className={type===t?'nav-btn active':'nav-btn'} onClick={()=>setType(t)}>{t==='all'?'全部': t==='reading'?'阅读':'听力'}</button>
            ))}
          </div>
          <div className="glass-card" style={{ padding: 6, borderRadius: 12, display: 'flex', gap: 6 }}>
            {(['all','P1','P2','P3','P4'] as const).map(c => (
              <button key={c} className={category===c?'nav-btn active':'nav-btn'} onClick={()=>setCategory(c)}>{c==='all'?'全部':c}</button>
            ))}
          </div>
          <input placeholder="搜索题目..." value={search} onChange={e=>setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 220, padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(0,0,0,.12)' }} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        {filtered.map(exam => {
          const best = completionMap.get(String(exam.id))?.best ?? 0;
          return (
            <div key={exam.id} className="exam-card glass-card" style={{ padding: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>{exam.title}</div>
              <div style={{ display: 'flex', gap: 8, opacity: .85, fontSize: 13, marginBottom: 10 }}>
                <span>{exam.type === 'reading' ? '📖 阅读' : '🎧 听力'}</span>
                <span>{exam.category}</span>
                {best>0 && <span style={{ color:'#8b5cf6', fontWeight: 700 }}>最好 {best}%</span>}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn" onClick={()=>openExam(exam)}>打开 HTML</button>
                {exam.pdfFilename && <button className="btn" onClick={()=>openPdf(exam)}>打开 PDF</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function openExam(exam: any){
  const url = buildHtmlPath(exam);
  window.open(url, '_blank');
}
function openPdf(exam: any){
  const url = buildPdfPath(exam);
  if (url) window.open(url, '_blank');
}
