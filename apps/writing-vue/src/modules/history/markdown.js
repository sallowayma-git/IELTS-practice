import { formatDuration, formatOccurredAt } from './records.js'

/**
 * Markdown export of normalized history records (any mix of activities).
 * Per-activity extras come from `record.meta`, never from the activity name.
 */
export function buildHistoryMarkdown(records, { scopeLabel = '全部', now = new Date() } = {}) {
  const lines = [
    `# 练习记录（${scopeLabel}）`,
    '',
    `导出时间: ${now.toLocaleString()}`,
    `记录数量: ${records.length}`,
    ''
  ]
  records.forEach((record, index) => {
    lines.push(
      `## ${index + 1}. ${record.title || '无标题'}`,
      '',
      `- 类型: ${record.subtitle}`,
      `- 提交时间: ${formatOccurredAt(record.occurredAt) || '未知时间'}`,
      `- 用时: ${formatDuration(record.durationSec)}`,
      `- ${record.score.label || '成绩'}: ${record.score.display}`
    )
    for (const [label, value] of record.meta) {
      if (value) lines.push(`- ${label}: ${value}`)
    }
    lines.push('')
  })
  return lines.join('\n')
}

export function markdownFilename(scopeKey, now = new Date()) {
  return `ielts-history-${scopeKey || 'all'}-${now.toISOString().slice(0, 10)}.md`
}
