import { readingSuiteApi } from './api'
import type { ReadingSuitePayload } from './contracts'

export function useReadingSuite() {
  return {
    createReadingSuite: (payload: ReadingSuitePayload = {}) => readingSuiteApi.create(payload)
  }
}
