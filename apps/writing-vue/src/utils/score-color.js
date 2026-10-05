/*
 * Shared score-band colour mapping.
 * Bands: >=85 success, >=70 ink, >=55 warning, else danger. Clay stays rare.
 */
export function getScoreColor(percentage) {
  if (percentage >= 85) return 'var(--anth-success)'
  if (percentage >= 70) return 'var(--anth-ink)'
  if (percentage >= 55) return 'var(--anth-warning)'
  return 'var(--anth-danger)'
}
