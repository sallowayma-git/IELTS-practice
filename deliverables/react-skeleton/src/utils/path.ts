import type { Exam } from '../types';

export function normalizePath(p?: string): string {
  if (!p) return '';
  return p.replace(/\\/g, '/');
}

export function ensureSlashEnd(p: string): string {
  return p.endsWith('/') ? p : p + '/';
}

// Build a relative path to exam HTML, assuming the website is located under deliverables/react-skeleton
// and exam assets are in project root. We move up two levels from deliverables/react-skeleton to reach project root.
export function buildHtmlPath(exam: Exam): string {
  const base = ensureSlashEnd(normalizePath(exam.path || ''));
  const file = exam.filename || 'index.html';
  // '../../' from deliverables/react-skeleton to project root
  return '../../' + base + file;
}

export function buildPdfPath(exam: Exam): string | null {
  if (!exam.pdfFilename) return null;
  const base = ensureSlashEnd(normalizePath(exam.path || ''));
  return '../../' + base + exam.pdfFilename;
}

