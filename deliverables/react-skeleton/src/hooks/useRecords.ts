import { useCallback, useEffect, useState } from 'react';
import { PracticeRecord } from '../types';
import { getAnyPracticeRecords } from '../utils/storage';

function normalizeRecord(r: any): PracticeRecord {
  const duration = typeof r.duration === 'number' ? r.duration
    : (r.realData?.duration ?? 0);
  const pct = typeof r.percentage === 'number' ? r.percentage
    : (typeof r.accuracy === 'number' ? Math.round(r.accuracy * 100)
      : (r.scoreInfo?.percentage ?? r.realData?.scoreInfo?.percentage ?? 0));
  const date = r.date || r.endTime || r.startTime || new Date().toISOString();
  const type: PracticeRecord['type'] = r.type === 'listening' ? 'listening' : 'reading';
  return {
    id: String(r.id ?? r.examId ?? Math.random()),
    examId: r.examId ? String(r.examId) : undefined,
    title: r.title ?? r.examTitle,
    type,
    category: r.category,
    date,
    startTime: r.startTime,
    endTime: r.endTime,
    duration: typeof duration === 'number' ? Math.max(0, duration) : 0,
    percentage: typeof pct === 'number' ? Math.max(0, Math.min(100, Math.round(pct))) : 0,
    accuracy: typeof r.accuracy === 'number' ? r.accuracy : undefined,
    scoreInfo: r.scoreInfo,
    realData: r.realData
  };
}

export function useRecords() {
  const [records, setRecords] = useState<PracticeRecord[]>([]);
  const [loadedFrom, setLoadedFrom] = useState<string>('none');

  const loadFromLocalStorage = useCallback(() => {
    try {
      const arr = getAnyPracticeRecords();
      const normalized = (arr || []).map(normalizeRecord);
      setRecords(normalized);
      setLoadedFrom(`localStorage(${normalized.length})`);
    } catch (e) {
      console.warn('[useRecords] loadFromLocalStorage failed', e);
      setLoadedFrom('error');
    }
  }, []);

  useEffect(() => { loadFromLocalStorage(); }, [loadFromLocalStorage]);

  const importJson = useCallback((file: File) => {
    return new Promise<void>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const json = JSON.parse(String(reader.result || '[]'));
          const arr: any[] = Array.isArray(json) ? json
            : (json.practiceRecords || json.data?.exam_system_practice_records?.data || []);
          const normalized = (arr || []).map(normalizeRecord);
          setRecords(normalized);
          setLoadedFrom(`import(${normalized.length})`);
          resolve();
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }, []);

  return { records, loadedFrom, loadFromLocalStorage, importJson };
}

