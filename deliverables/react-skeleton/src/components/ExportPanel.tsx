import { useRef, useState } from 'react';
import type { PracticeRecord } from '../types';

function toMarkdown(records: PracticeRecord[]) {
  const lines: string[] = [];
  lines.push(`# 练习记录导出`);
  lines.push('');
  records.forEach((r, i) => {
    lines.push(`## ${i+1}. ${r.title || '未命名'}`);
    lines.push(`- 日期: ${r.date ? new Date(r.date).toLocaleString() : '-'}`);
    lines.push(`- 类型: ${r.type === 'listening' ? '听力' : '阅读'}`);
    lines.push(`- 分类: ${r.category ?? ''}`);
    lines.push(`- 用时: ${(r.duration ?? 0)} 秒`);
    lines.push(`- 得分: ${(r.percentage ?? 0)}%`);
    lines.push('');
  });
  return lines.join('\n');
}

export function ExportPanel({ records }: { records: PracticeRecord[] }){
  const [status, setStatus] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ practiceRecords: records, exportDate: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `practice-records-${Date.now()}.json`; a.click(); URL.revokeObjectURL(url);
    setStatus('JSON 导出完成');
  };
  const exportMd = () => {
    const md = toMarkdown(records);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `practice-records-${Date.now()}.md`; a.click(); URL.revokeObjectURL(url);
    setStatus('Markdown 导出完成');
  };
  const importJson = (file: File) => new Promise<void>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { try {
      const json = JSON.parse(String(reader.result || '{}'));
      const arr: any[] = Array.isArray(json) ? json : (json.practiceRecords || json.data?.exam_system_practice_records?.data || []);
      localStorage.setItem('practice_records', JSON.stringify(arr));
      setStatus(`已导入 ${arr.length} 条到 localStorage(practice_records)`);
      resolve();
    } catch (e) { reject(e); } };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });

  return (
    <div className="glass-card" style={{ padding: 16, display: 'grid', gap: 8 }}>
      <div style={{ fontWeight: 800 }}>导出 / 导入</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" onClick={exportJson}>导出 JSON</button>
        <button className="btn" onClick={exportMd}>导出 Markdown</button>
        <button className="btn" onClick={()=>fileInput.current?.click()}>导入 JSON 到 LocalStorage</button>
        <input ref={fileInput} type="file" accept=".json" style={{ display: 'none' }} onChange={async (e)=>{
          const f = e.target.files?.[0]; if (!f) return;
          await importJson(f); e.currentTarget.value='';
        }} />
        <div style={{ opacity: .8 }}>{status}</div>
      </div>
    </div>
  );
}

