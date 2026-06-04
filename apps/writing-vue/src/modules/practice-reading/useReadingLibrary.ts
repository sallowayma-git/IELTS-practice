import { readingLibraryApi } from './api'
import { createReadingLibraryClient } from './readingLibraryCore.js'

export function useReadingLibrary(dependencies = {}) {
  const api = dependencies.api || readingLibraryApi
  return createReadingLibraryClient(api)
}
