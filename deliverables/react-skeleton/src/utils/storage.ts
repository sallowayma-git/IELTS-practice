// Helpers to read data from localStorage with or without wrapper

export function safeParse<T=any>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

// StorageManager wrapper used in original app stores { data, timestamp, version }
export function unwrapStorageValue<T=any>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object' && 'data' in (value as any)) {
    return (value as any).data as T;
  }
  return (value as T) ?? fallback;
}

export function getLocal<T=any>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  return safeParse<T>(raw, fallback);
}

export function getAnyExamIndex(): any[] {
  // Try StorageManager prefixed key
  const smWrapped = getLocal('exam_system_exam_index', null);
  if (smWrapped) {
    const unwrapped = unwrapStorageValue<any[]>(smWrapped, []);
    if (Array.isArray(unwrapped)) return unwrapped;
  }
  // Try plain key
  const plain = getLocal<any[]>('exam_index', []);
  if (Array.isArray(plain)) return plain;
  return [];
}

export function getAnyPracticeRecords(): any[] {
  const smWrapped = getLocal('exam_system_practice_records', null);
  if (smWrapped) {
    const unwrapped = unwrapStorageValue<any[]>(smWrapped, []);
    if (Array.isArray(unwrapped)) return unwrapped;
    // Some deployments keep data under { data: { data: [] } }
    if (unwrapped && (unwrapped as any).data && Array.isArray((unwrapped as any).data)) {
      return (unwrapped as any).data;
    }
  }
  const plain = getLocal<any[]>('practice_records', []);
  if (Array.isArray(plain)) return plain;
  return [];
}

