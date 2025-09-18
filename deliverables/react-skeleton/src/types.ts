export type Exam = {
  id: string;
  title: string;
  category?: string;
  type?: 'reading' | 'listening';
  path?: string;
  filename?: string;
  pdfFilename?: string;
  mp3Filename?: string;
  hasHtml?: boolean;
  hasPdf?: boolean;
};

export type PracticeRecord = {
  id: string;
  examId?: string;
  title?: string;
  type?: 'reading' | 'listening';
  category?: string;
  date?: string; // ISO
  startTime?: string; // ISO
  endTime?: string; // ISO
  duration?: number; // seconds
  percentage?: number; // 0-100
  accuracy?: number; // 0-1
  scoreInfo?: { percentage?: number; accuracy?: number; total?: number; correct?: number };
  realData?: { duration?: number; scoreInfo?: { percentage?: number; accuracy?: number } };
};
