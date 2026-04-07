#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function main() {
  const modulePath = path.resolve(__dirname, '../../../apps/writing-vue/src/utils/radar-chart.js');
  const {
    RADAR_MAX_SCORE,
    clampRadarScore,
    buildRadarPoint,
    buildRadarPolygon,
    formatRadarPoints
  } = await import(pathToFileURL(modulePath).href);

  assert.strictEqual(RADAR_MAX_SCORE, 9);
  assert.strictEqual(clampRadarScore(-3), 0, 'negative score should clamp to zero');
  assert.strictEqual(clampRadarScore(99), 9, 'score should clamp to chart max');
  assert.strictEqual(clampRadarScore('6.5'), 6.5, 'numeric strings should normalize');

  const topPoint = buildRadarPoint({
    index: 0,
    totalDimensions: 4,
    value: 9,
    centerX: 160,
    centerY: 160,
    radius: 100
  });
  assert.strictEqual(topPoint.x.toFixed(2), '160.00');
  assert.strictEqual(topPoint.y.toFixed(2), '60.00');

  const polygon = buildRadarPolygon({
    values: [9, 4.5, 0, 12],
    centerX: 160,
    centerY: 160,
    radius: 100
  });
  assert.strictEqual(polygon.length, 4, 'polygon should preserve dimension count');
  assert.strictEqual(polygon[2].x.toFixed(2), '160.00', 'zero score should collapse to center on X');
  assert.strictEqual(polygon[2].y.toFixed(2), '160.00', 'zero score should collapse to center on Y');
  assert.strictEqual(polygon[3].x.toFixed(2), '60.00', 'values above max should clamp before plotting');

  const pointString = formatRadarPoints(polygon);
  assert(pointString.includes(','), 'formatted polygon should be svg-ready');
  assert.strictEqual(pointString.split(' ').length, 4, 'formatted polygon should contain one pair per dimension');

  process.stdout.write(JSON.stringify({
    status: 'pass',
    maxScore: RADAR_MAX_SCORE,
    topPoint,
    polygonPointCount: polygon.length,
    formattedPoints: pointString
  }));
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
