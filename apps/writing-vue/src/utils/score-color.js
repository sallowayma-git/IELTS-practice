/*
 * Shared score-band colour mapping.
 * Bands: >=85 success, >=70 accent, >=55 warning, else danger.
 */
export function getScoreColor(percentage) {
  if (percentage >= 85) return 'var(--anth-success)'
  if (percentage >= 70) return 'var(--anth-accent)'
  if (percentage >= 55) return 'var(--anth-warning)'
  return 'var(--anth-danger)'
}
