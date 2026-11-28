import { invokeCommand } from './tauri-bridge.js'

export const listBooks = () => invokeCommand('vocab_books')
export const listBookUnits = (bookId) => invokeCommand('vocab_book_units', { bookId })
export const listBookWords = (bookId, unitId, limit, offset) =>
  invokeCommand('vocab_book_words', { bookId, unitId: unitId || null, limit, offset })
