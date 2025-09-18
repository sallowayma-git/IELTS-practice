import type { PracticeRecord } from '../types';
import { Modal } from './Modal';

export function RecordDetailsModal({ record, open, onClose }: { record?: PracticeRecord; open: boolean; onClose: ()=>void }){
  const answers = (record as any)?.realData?.answers || (record as any)?.answers || {};
  const correct = (record as any)?.realData?.correctAnswers || (record as any)?.correctAnswers || {};

  const keys = Object.keys(answers);
  return (
    <Modal open={open} onClose={onClose} title={`记录详情 · ${record?.title ?? ''}`}>
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap: 8 }}>
          <div className="glass-card" style={{ padding: 12 }}><strong>日期</strong><div>{record?.date ? new Date(record.date).toLocaleString() : '-'}</div></div>
          <div className="glass-card" style={{ padding: 12 }}><strong>用时</strong><div>{fmtDuration(record?.duration ?? 0)}</div></div>
          <div className="glass-card" style={{ padding: 12 }}><strong>得分</strong><div>{record?.percentage ?? 0}%</div></div>
          <div className="glass-card" style={{ padding: 12 }}><strong>类型</strong><div>{record?.type === 'listening' ? '听力' : '阅读'} {record?.category ?? ''}</div></div>
        </div>
        {keys.length > 0 ? (
          <div className="glass-card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>答题详情</div>
            <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 1fr 80px', gap: 6 }}>
              <div style={{ opacity: .7 }}>序号</div>
              <div style={{ opacity: .7 }}>用户答案</div>
              <div style={{ opacity: .7 }}>正确答案</div>
              <div style={{ opacity: .7 }}>结果</div>
              {keys.map(k => {
                const ua = String(answers[k] ?? '');
                const ca = String(correct[k] ?? '');
                const ok = ua && ca && ua === ca;
                return (
                  <>
                    <div>{k}</div>
                    <div>{ua}</div>
                    <div>{ca}</div>
                    <div style={{ color: ok? '#10b981':'#ef4444', fontWeight: 700 }}>{ok ? '✓' : '✗'}</div>
                  </>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="glass-card" style={{ padding: 12, opacity: .8 }}>无答题详情</div>
        )}
      </div>
    </Modal>
  );
}

function fmtDuration(s: number) {
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s/60), rem = s%60;
  if (m < 60) return rem? `${m}分${rem}秒`:`${m}分钟`;
  const h = Math.floor(m/60), mm = m%60;
  return `${h}小时${mm}分钟`;
}

