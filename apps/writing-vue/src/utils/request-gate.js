export function createRequestGate() {
  let currentId = 0

  return {
    begin() {
      currentId += 1
      return currentId
    },
    isCurrent(requestId) {
      return requestId === currentId
    },
    invalidate() {
      currentId += 1
      return currentId
    }
  }
}
