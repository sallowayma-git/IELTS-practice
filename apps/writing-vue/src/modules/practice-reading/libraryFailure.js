/**
 * Learner-facing copy for Reading Library failures.
 *
 * Engine-generated exceptions ("x.slice is not a function", JSON "Unexpected
 * token ...") are bugs or bad input, not messages for a learner: they stay in
 * the console and the UI shows only the summary the page authored. Every other
 * error (backend envelope, errors the page throws itself) may add its detail.
 */

export const LIBRARY_LOAD_FAILURE = '阅读题库读取失败，请稍后重试；如仍失败请重启应用。'

const SCRIPT_ERRORS = [TypeError, ReferenceError, RangeError, SyntaxError, EvalError, URIError]

export function isScriptError(error) {
  return SCRIPT_ERRORS.some((type) => error instanceof type)
}

/** `hint` is the next step shown when there is no detail worth showing. */
export function libraryFailureMessage(summary, error, hint = '请稍后重试') {
  const detail = isScriptError(error) ? '' : String(error?.message ?? '').trim()
  return detail ? `${summary}：${detail}` : `${summary}，${hint}`
}
