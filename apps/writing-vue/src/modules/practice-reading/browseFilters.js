export function normalizeCategory(category) {
  const value = String(category || '').trim().toUpperCase()
  if (value.includes('P1')) return 'P1'
  if (value.includes('P2')) return 'P2'
  if (value.includes('P3')) return 'P3'
  return value || 'P1'
}

export function normalizeFrequency(source) {
  const value = [
    source?.metadata?.frequency,
    source?.frequency,
    source?.difficulty,
    source?.title,
    source?.id,
    source?.assetId,
    source?.examId,
    source?.metadata?.dataKey,
    source?.metadata?.legacyFilename,
    source?.metadata?.pdfFilename
  ].filter(Boolean).join(' ').toLowerCase()
  if (value.includes('medium') || value.includes('次高频') || value.includes('中频') || value.includes('-medium')) return 'medium'
  if (value.includes('high') || value.includes('超高频') || value.includes('高频') || value.includes('-high')) return 'high'
  if (value.includes('low') || value.includes('低频') || value.includes('-low')) return 'low'
  return 'unknown'
}

export function frequencyRank(asset) {
  const ranks = { high: 3, medium: 2, low: 1, unknown: 0 }
  return ranks[normalizeFrequency(asset)] || 0
}

export function difficultyRank(asset) {
  const value = [
    asset?.metadata?.difficultyRank,
    asset?.metadata?.difficulty,
    asset?.difficulty,
    asset?.metadata?.frequency,
    asset?.frequency,
    asset?.title,
    asset?.id,
    asset?.metadata?.dataKey,
    asset?.metadata?.legacyFilename,
    asset?.metadata?.pdfFilename
  ].filter(Boolean).join(' ').toLowerCase()
  if (/(\b|_)(hard|difficult|advanced|high)(\b|_|-)/.test(value) || value.includes('困难') || value.includes('高难') || value.includes('超高频') || value.includes('高频')) return 3
  if (/(\b|_)(medium|intermediate|mid)(\b|_|-)/.test(value) || value.includes('中等') || value.includes('中频') || value.includes('次高频')) return 2
  if (/(\b|_)(easy|basic|low)(\b|_|-)/.test(value) || value.includes('简单') || value.includes('低频')) return 1
  const numeric = Number(asset?.metadata?.difficultyRank ?? asset?.difficultyRank ?? asset?.metadata?.difficultyScore)
  return Number.isFinite(numeric) ? numeric : 0
}

export function buildBrowseTitle(selectedCategory, selectedType) {
  if (selectedCategory === 'all' && selectedType === 'all') return '题库浏览'
  if (selectedCategory === 'all') return '阅读题库'
  return `${selectedCategory} 阅读`
}

export function filterReadingAssets(readingAssets, options = {}) {
  const {
    keyword = '',
    selectedType = 'all',
    selectedCategory = 'all',
    frequencyFilter = 'all',
    sortMode = 'default'
  } = options
  const query = String(keyword || '').trim().toLowerCase()
  const filtered = (Array.isArray(readingAssets) ? readingAssets : []).filter((asset) => {
    if (selectedType !== 'all' && asset?.activity !== selectedType) return false
    if (selectedCategory !== 'all' && normalizeCategory(asset?.category) !== selectedCategory) return false
    if (frequencyFilter !== 'all' && normalizeFrequency(asset) !== frequencyFilter) return false
    if (!query) return true
    return [
      asset?.id,
      asset?.title,
      asset?.source,
      asset?.category,
      asset?.difficulty,
      asset?.payloadRef,
      asset?.metadata?.dataKey,
      asset?.metadata?.pdfFilename,
      asset?.metadata?.legacyFilename
    ].filter(Boolean).join(' ').toLowerCase().includes(query)
  })

  return filtered.slice().sort((left, right) => {
    if (sortMode === 'frequency-desc') {
      return frequencyRank(right) - frequencyRank(left)
        || String(left?.category || '').localeCompare(String(right?.category || ''), 'zh-Hans-CN')
        || String(left?.title || '').localeCompare(String(right?.title || ''), 'zh-Hans-CN')
    }
    if (sortMode === 'difficulty-desc') {
      return difficultyRank(right) - difficultyRank(left)
        || frequencyRank(right) - frequencyRank(left)
        || String(left?.category || '').localeCompare(String(right?.category || ''), 'zh-Hans-CN')
        || String(left?.title || '').localeCompare(String(right?.title || ''), 'zh-Hans-CN')
    }
    return String(left?.category || '').localeCompare(String(right?.category || ''), 'zh-Hans-CN')
      || String(left?.title || '').localeCompare(String(right?.title || ''), 'zh-Hans-CN')
  })
}
