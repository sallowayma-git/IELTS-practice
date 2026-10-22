export const QUESTION_KIND_LABELS = Object.freeze({
  single_choice: '单选',
  multi_choice: '多选',
  judgement: '判断',
  completion: '填空',
  heading_match: '段落大意',
  paragraph_match: '段落匹配',
  matching: '配对'
})

// Canonical label order, not the order of the asset's questionKinds array.
export function questionKindTags(asset) {
  const kinds = Array.isArray(asset?.questionKinds) ? asset.questionKinds : []
  return Object.keys(QUESTION_KIND_LABELS)
    .filter((key) => kinds.includes(key))
    .map((key) => ({ key, label: QUESTION_KIND_LABELS[key] }))
}
