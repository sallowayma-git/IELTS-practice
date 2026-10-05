/** Browser-side file download + export filenames for the History page. */

export function downloadTextFile(filename, content, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

/** ielts-history-2026-10-05-writing-task1-date-filtered.csv */
export function csvFilename(view, now = new Date()) {
  const scored = view.minScore !== null || view.maxScore !== null
  const suffix = [
    view.activity,
    view.kind,
    (view.startDate || view.endDate) && 'date-filtered',
    scored && 'score-filtered'
  ].filter(Boolean)
  const date = now.toISOString().slice(0, 10)
  return `ielts-history-${date}${suffix.length > 0 ? `-${suffix.join('-')}` : ''}.csv`
}
