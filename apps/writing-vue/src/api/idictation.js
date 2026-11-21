import { invoke } from '@tauri-apps/api/core'

export const isIdictationMaterial = id => String(id || '').startsWith('idictation-material-')
export const isIdictationArticle = id => String(id || '').startsWith('idictation-article-')
export const isIdictationReading = id => String(id || '').startsWith('idictation-reading-')

export const idictation = {
  readingCatalog: () => invoke('idictation_reading_catalog'),
  openReading: testId => invoke('idictation_reading_open', { testId }),
  saveReading: cmd => invoke('idictation_reading_save', { cmd }),
  submitReading: cmd => invoke('idictation_reading_submit', { cmd }),
  readingReview: (assetId, attemptId) => invoke('idictation_reading_review', { assetId, attemptId }),
  openLogin: () => invoke('idictation_open_login'),
  connect: () => invoke('idictation_connect'),
  disconnect: () => invoke('idictation_disconnect'),
  books: scope => invoke('idictation_books', { scope }),
  chapters: bookId => invoke('idictation_chapters', { bookId }),
  syncChapter: (bookId, chapterId) => invoke('idictation_sync_chapter', { bookId, chapterId }),
  readerCatalog: (track, book, page) => invoke('idictation_reader_catalog', { track, book, page }),
  openReader: documentId => invoke('idictation_open_reader', { documentId }),
  readerPayload: assetId => invoke('idictation_reader_payload', { assetId }),
  trainingStart: (bookId,unitId,mode,resume) => invoke('idictation_training_start',{bookId,unitId,mode,resume}),
  trainingAnswer: (sessionId,promptId,typed,choice=null,skipMissing=false) => invoke('idictation_training_answer',{sessionId,promptId,typed,choice,skipMissing}),
  trainingAudio: (sessionId,promptId,sentence=false) => invoke('idictation_training_audio',{sessionId,promptId,sentence}),
  trainingFinish: (sessionId,promptId) => invoke('idictation_training_finish',{sessionId,promptId}),
  trainingClose: sessionId => invoke('idictation_training_close',{sessionId}),
  articleBooks:()=>invoke('idictation_article_books'),
  articleChapters:bookId=>invoke('idictation_article_chapters',{bookId}),
  openArticle:(chapterId,mode)=>invoke('idictation_open_article',{chapterId,mode}),
  articlePayload:assetId=>invoke('idictation_article_payload',{assetId}),
  articleAudio:(sessionId,action,mediaId=null,value=null)=>invoke('idictation_article_audio',{sessionId,action,mediaId,value}),
}
