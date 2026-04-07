#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function main() {
  const modulePath = path.resolve(__dirname, '../../../apps/writing-vue/src/utils/request-gate.js');
  const { createRequestGate } = await import(pathToFileURL(modulePath).href);

  const gate = createRequestGate();

  const firstId = gate.begin();
  assert.strictEqual(gate.isCurrent(firstId), true, 'first request should be current');

  const secondId = gate.begin();
  assert.strictEqual(gate.isCurrent(firstId), false, 'older request must become stale after a new one begins');
  assert.strictEqual(gate.isCurrent(secondId), true, 'latest request should remain current');

  const invalidatedId = gate.invalidate();
  assert.strictEqual(gate.isCurrent(secondId), false, 'invalidate should retire in-flight request');
  assert.strictEqual(gate.isCurrent(invalidatedId), true, 'invalidate should advance gate to a new current token');

  const thirdId = gate.begin();
  assert.strictEqual(gate.isCurrent(thirdId), true, 'begin should keep monotonic current token');
  assert.strictEqual(gate.isCurrent(invalidatedId), false, 'new begin should stale the invalidated token');

  process.stdout.write(JSON.stringify({
    status: 'pass',
    tokens: {
      firstId,
      secondId,
      invalidatedId,
      thirdId
    }
  }));
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
