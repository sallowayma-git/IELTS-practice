import { useCallback, useEffect, useState } from 'react';
import { Exam } from '../types';
import { getAnyExamIndex } from '../utils/storage';

function normalizeIndex(raw: any[]): Exam[] {
  return (raw || []).map((e: any) => ({
    id: String(e.id ?? e.title ?? Math.random()),
    title: String(e.title ?? '未命名'),
    type: (e.type === 'listening' ? 'listening' : 'reading'),
    category: e.category,
    path: e.path || e.basePath,
    filename: e.filename || e.fileName,
    pdfFilename: e.pdfFilename,
    mp3Filename: e.mp3Filename,
    hasHtml: !!e.hasHtml,
    hasPdf: !!e.hasPdf
  }));
}

export function useLibrary() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [loadedFrom, setLoadedFrom] = useState<string>('none');

  const loadFromLocalStorage = useCallback(() => {
    try {
      const arr = getAnyExamIndex();
      const normalized = normalizeIndex(arr);
      setExams(normalized);
      setLoadedFrom(`localStorage(${arr.length})`);
    } catch (e) {
      console.warn('[useLibrary] loadFromLocalStorage failed', e);
      setLoadedFrom('error');
    }
  }, []);

  // Initial try
  useEffect(() => { loadFromLocalStorage(); }, [loadFromLocalStorage]);

  const importJson = useCallback((file: File) => {
    return new Promise<void>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const json = JSON.parse(String(reader.result || '[]'));
          const arr: any[] = Array.isArray(json) ? json : (json.examIndex || json.exams || []);
          const normalized = normalizeIndex(arr);
          setExams(normalized);
          setLoadedFrom(`import(${normalized.length})`);
          resolve();
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }, []);

  return { exams, loadedFrom, loadFromLocalStorage, importJson };
}
