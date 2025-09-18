import { ReactNode, useEffect } from 'react';

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: ()=>void; title?: string; children: ReactNode }){
  useEffect(()=>{
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div className="glass-card" style={{ maxWidth: 800, width: '92%', maxHeight: '80vh', overflow: 'auto', padding: 16 }} onClick={e=>e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontWeight: 800 }}>{title}</div>
          <button className="btn" onClick={onClose}>关闭</button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}

