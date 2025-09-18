type Props = {
  type: 'all' | 'reading' | 'listening';
  setType: (v: 'all' | 'reading' | 'listening') => void;
  category: 'all' | 'P1' | 'P2' | 'P3' | 'P4';
  setCategory: (v: 'all' | 'P1' | 'P2' | 'P3' | 'P4') => void;
  search: string;
  setSearch: (v: string) => void;
};

export function FilterBar({ type, setType, category, setCategory, search, setSearch }: Props) {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
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
      <input
        placeholder="搜索题目..."
        value={search}
        onChange={e=>setSearch(e.target.value)}
        style={{ flex: 1, minWidth: 220, padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(0,0,0,.12)' }}
      />
    </div>
  );
}

