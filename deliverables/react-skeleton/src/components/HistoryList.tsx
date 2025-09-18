type RecordItem = { id: string; title: string; date: string; percentage: number; durationSec: number };
import { useMemo, useState } from 'react';
import { RecordDetailsModal } from './RecordDetailsModal';
import type { PracticeRecord } from '../types';

const fmtDuration = (s: number) => {
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}分${rem}秒` : `${m}分钟`;
};

export function HistoryList({ records }: { records: RecordItem[] | PracticeRecord[] }) {
  const norm = useMemo<RecordItem[]>(() => (records as any[]).map((r:any)=>({
    id: String(r.id),
    title: r.title || '未知题目',
    date: r.date || r.endTime || r.startTime || new Date().toISOString(),
    percentage: typeof r.percentage==='number'? r.percentage : (typeof r.accuracy==='number'? Math.round(r.accuracy*100):0),
    durationSec: typeof r.duration==='number'? r.duration : (r.realData?.duration ?? 0)
  })), [records]);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<PracticeRecord | undefined>(undefined);
  if (!records.length) {
    return (
      <div style={{ textAlign: 'center', padding: 32, opacity: .7 }}>
        <div style={{ fontSize: 48, marginBottom: 10 }}>📂</div>
        暂无练习记录
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {norm.map(r => (
        <div key={r.id} className="history-item glass-card" style={{ padding: 12, display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700, cursor:'pointer' }} onClick={()=>{ setCurrent(records.find((x:any)=>String(x.id)===r.id) as any); setOpen(true); }}>{r.title}</div>
            <div style={{ opacity: .8, marginTop: 6, fontSize: 13 }}>{new Date(r.date).toLocaleString()} · 用时 {fmtDuration(r.durationSec)}</div>
          </div>
          <div style={{ alignSelf: 'center', fontWeight: 800, color: '#10b981' }}>{r.percentage}%</div>
          <div style={{ alignSelf: 'center' }}>
            <button className="btn" aria-label="查看" onClick={()=>{ setCurrent(records.find((x:any)=>String(x.id)===r.id) as any); setOpen(true); }}>详情</button>
          </div>
        </div>
      ))}
      <RecordDetailsModal record={current} open={open} onClose={()=>setOpen(false)} />
    </div>
  );
}
