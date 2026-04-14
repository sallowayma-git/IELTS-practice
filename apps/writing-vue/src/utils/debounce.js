export function debounce(fn, delay) {
  let timeoutId = null
  return function debounceWrapper(...args) {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn.apply(this, args), delay)
  }
}

