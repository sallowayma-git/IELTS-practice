export const RADAR_MAX_SCORE = 9
export const RADAR_START_ANGLE = -Math.PI / 2

function toFiniteNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function clampRadarScore(value, maxScore = RADAR_MAX_SCORE) {
  const normalizedMax = toFiniteNumber(maxScore)
  if (normalizedMax <= 0) return 0
  return Math.max(0, Math.min(normalizedMax, toFiniteNumber(value)))
}

export function getRadarAngle(index, totalDimensions, startAngle = RADAR_START_ANGLE) {
  if (!Number.isInteger(totalDimensions) || totalDimensions <= 0) {
    throw new Error('totalDimensions must be a positive integer')
  }
  return startAngle + ((Math.PI * 2) / totalDimensions) * index
}

export function buildRadarPoint({
  index,
  totalDimensions,
  value = RADAR_MAX_SCORE,
  centerX,
  centerY,
  radius,
  maxScore = RADAR_MAX_SCORE,
  startAngle = RADAR_START_ANGLE
}) {
  const angle = getRadarAngle(index, totalDimensions, startAngle)
  const safeRadius = Math.max(0, toFiniteNumber(radius))
  const scoreRatio = clampRadarScore(value, maxScore) / Math.max(1, toFiniteNumber(maxScore))

  return {
    x: centerX + Math.cos(angle) * safeRadius * scoreRatio,
    y: centerY + Math.sin(angle) * safeRadius * scoreRatio,
    angle
  }
}

export function buildRadarPolygon({
  values,
  centerX,
  centerY,
  radius,
  maxScore = RADAR_MAX_SCORE,
  startAngle = RADAR_START_ANGLE
}) {
  const entries = Array.isArray(values) ? values : []
  return entries.map((value, index) => (
    buildRadarPoint({
      index,
      totalDimensions: entries.length,
      value,
      centerX,
      centerY,
      radius,
      maxScore,
      startAngle
    })
  ))
}

export function formatRadarPoints(points) {
  return points
    .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(' ')
}
