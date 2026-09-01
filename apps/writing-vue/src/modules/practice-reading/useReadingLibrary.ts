import { readingLibraryApi } from './api'
import { createReadingLibraryClient } from './readingLibraryCore.js'

interface ReadingLibraryDependencies { api?: typeof readingLibraryApi }

export function useReadingLibrary(dependencies: ReadingLibraryDependencies = {}) {
  const api = dependencies.api || readingLibraryApi
  return createReadingLibraryClient(api)
}
