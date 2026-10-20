// Chinese labels for known sentence-error kinds. Unknown stored kinds retain
// their original label rather than inventing a classification.

const ERROR_KIND_LABELS = new Map([
  ['article', '冠词'],
  ['subject_verb_agreement', '主谓一致'],
  ['tense', '时态'],
  ['plural', '单复数'],
  ['comma_splice', '逗号粘连'],
  ['word_form', '词形'],
  ['collocation', '搭配'],
  ['spelling', '拼写'],
  ['register', '语域'],
  ['referencing', '指代'],
  ['topic_sentence', '主题句'],
  ['position_clarity', '立场不清'],
  ['other', '其他']
])

/**
 * Label for a stored kind. Unknown values (legacy rows written before the
 * taxonomy existed) are returned unchanged so no information is hidden.
 */
export function errorKindLabel(kind) {
  const key = typeof kind === 'string' ? kind.trim() : ''
  if (!key) return ERROR_KIND_LABELS.get('other')
  return ERROR_KIND_LABELS.get(key) ?? key
}

export function isErrorKind(kind) {
  return ERROR_KIND_LABELS.has(kind)
}
