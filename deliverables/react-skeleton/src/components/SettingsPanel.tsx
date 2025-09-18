import { useRef, useState } from 'react';

type Props = {
  onLoadLibrary: () => void;
  onImportLibrary: (file: File) => Promise<void>;
  libraryInfo?: string;
  onLoadRecords: () => void;
  onImportRecords: (file: File) => Promise<void>;
  recordsInfo?: string;
};

export function SettingsPanel({ onLoadLibrary, onImportLibrary, libraryInfo, onLoadRecords, onImportRecords, recordsInfo }: Props) {
  const libInput = useRef<HTMLInputElement>(null);
  const recInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="glass-card" style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div style={{ fontWeight: 800 }}>数据管理</div>
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn" onClick={onLoadLibrary} disabled={busy}>从 LocalStorage 读取题库</button>
          <button className="btn" onClick={() => libInput.current?.click()} disabled={busy}>导入题库 JSON</button>
          <span style={{ opacity: .8, fontSize: 12 }}>{libraryInfo}</span>
          <input ref={libInput} type="file" accept=".json,application/json" style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return;
              try { setBusy(true); await onImportLibrary(f); } finally { setBusy(false); e.currentTarget.value=''; }
            }} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn" onClick={onLoadRecords} disabled={busy}>从 LocalStorage 读取练习记录</button>
          <button className="btn" onClick={() => recInput.current?.click()} disabled={busy}>导入记录 JSON</button>
          <span style={{ opacity: .8, fontSize: 12 }}>{recordsInfo}</span>
          <input ref={recInput} type="file" accept=".json,application/json" style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return;
              try { setBusy(true); await onImportRecords(f); } finally { setBusy(false); e.currentTarget.value=''; }
            }} />
        </div>
      </div>
    </div>
  );
}

