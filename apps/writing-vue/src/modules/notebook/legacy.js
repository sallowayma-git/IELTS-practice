import { formatWindowRange, weekThursday, windowDays } from './weekly.js'

// Resolve the stored snapshot's references as plain text. No HTML or links.
export function legacyText(value, facts = {}) {
  return String(value ?? '').replace(/\{\{[fq]:([^{}]+)\}\}/g, (_, id) => {
    const value = facts[id]?.value
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '〔引用不可用〕'
  })
}

function list(value) {
  return Array.isArray(value) ? value : []
}

// The legacy list may predate stored instants; a week key still names its
// Monday–Sunday range (Thursday is the anchor).
function legacyWindow(row) {
  const instant = windowDays(row?.start, row?.end)
  if (instant.startDay && instant.endDay) return instant
  const thursday = weekThursday({ window: row?.window })
  if (Number.isNaN(thursday.getTime())) return { startDay: '', endDay: '' }
  const start = new Date(thursday)
  const end = new Date(thursday)
  start.setUTCDate(start.getUTCDate() - 3)
  end.setUTCDate(end.getUTCDate() + 3)
  return { startDay: start.toISOString().slice(0, 10), endDay: end.toISOString().slice(0, 10) }
}

/**
 * A read-only v1/v2 digest as the same weekly entry the v3 cards use, so old
 * weeks sit in the shelf instead of a separate history block. Its body is
 * already resolved to plain text: a legacy digest has no citation contract.
 */
export function legacyWeeklyEntry(row) {
  const digest = row?.digest || {}
  const render = (item) => legacyText(typeof item === 'string' ? item : item?.text, digest.facts)
  const lines = (value) => list(value).map(render).filter(Boolean)
  const body = lines(digest.body || digest.observations)
  const groups = [
    ['changes', '变化', digest.changes],
    ['nextSteps', '下一步', digest.nextSteps || digest.nextPractice],
    ['strengths', '优势', digest.strengths],
    ['weaknesses', '劣势', digest.weaknesses]
  ]
    .map(([key, title, value]) => ({
      key,
      title,
      items: lines(value).map((text) => ({ text, route: null }))
    }))
    .filter((group) => group.items.length)
  const title = render(digest.title)
  if (!title && !body.length && !groups.length) return null
  const { startDay, endDay } = legacyWindow(row)
  const practiceCount = Number(digest.practiceCount)
  return {
    id: row?.runId || null,
    key: `week:${row?.window || row?.runId || ''}`,
    window: String(row?.window || ''),
    state: 'final',
    schemaVersion: 2,
    startDay,
    endDay,
    dateLabel: startDay && endDay ? formatWindowRange(startDay, endDay) : String(row?.window || ''),
    title: title || '历史周记',
    facts: {},
    paragraphs: body,
    body,
    groups,
    askUser: null,
    firstSentence: body[0]?.split(/[。！？]/)[0] || '',
    points: groups.flatMap((group) => group.items).map((item) => item.text).slice(0, 2),
    practiceCount: Number.isFinite(practiceCount) ? practiceCount : null,
    stateLine: null,
    blocks: [],
    memoryChanges: [],
    legacy: true
  }
}
