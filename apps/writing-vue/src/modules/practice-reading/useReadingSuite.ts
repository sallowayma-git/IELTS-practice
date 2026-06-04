import { readingSuiteApi } from './api'

export function useReadingSuite() {
  return {
    createReadingSuite: (payload = {}) => readingSuiteApi.create(payload)
  }
}
