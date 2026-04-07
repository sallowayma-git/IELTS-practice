#!/usr/bin/env node
'use strict';

const assert = require('assert');
const Module = require('module');

const originalRequire = Module.prototype.require;
Module.prototype.require = function patchedRequire(id) {
  if (id === '../../utils/logger' || id === '../utils/logger' || id.includes('utils/logger')) {
    return {
      info() {},
      warn() {},
      error() {},
      debug() {}
    };
  }
  return originalRequire.apply(this, arguments);
};

const SettingsService = require('../../../electron/services/settings.service');

async function main() {
  const stored = new Map([
    ['temperature_mode', 'balanced'],
    ['temperature_task1', 0.3],
    ['temperature_task2', 0.5]
  ]);

  const service = new SettingsService(null);
  service.dao = {
    get(key) {
      return stored.has(key) ? stored.get(key) : null;
    },
    setMultiple(updates) {
      for (const [key, value] of Object.entries(updates)) {
        stored.set(key, value);
      }
    }
  };

  await service.update({
    temperature_mode: 'balanced',
    temperature_task1: 0.3,
    temperature_task2: 0.9
  });
  const balancedTask1 = await service.getTemperature('task1');
  const balancedTask2 = await service.getTemperature('task2');
  assert.strictEqual(balancedTask1, 0.5, 'balanced task1 should use preset temperature');
  assert.strictEqual(balancedTask2, 0.5, 'balanced task2 should use preset temperature');

  await service.update({
    temperature_mode: 'custom',
    temperature_task1: 0.35,
    temperature_task2: 0.65
  });
  const customTask1 = await service.getTemperature('task1');
  const customTask2 = await service.getTemperature('task2');
  assert.strictEqual(customTask1, 0.35, 'custom task1 should use stored override');
  assert.strictEqual(customTask2, 0.65, 'custom task2 should use stored override');

  await service.update({ temperature_mode: 'creative' });
  const creativeTask1 = await service.getTemperature('task1');
  const creativeTask2 = await service.getTemperature('task2');
  assert.strictEqual(creativeTask1, 0.8, 'creative task1 should use preset temperature');
  assert.strictEqual(creativeTask2, 0.8, 'creative task2 should use preset temperature');

  process.stdout.write(JSON.stringify({
    status: 'pass',
    detail: {
      balanced: { task1: balancedTask1, task2: balancedTask2 },
      custom: { task1: customTask1, task2: customTask2 },
      creative: { task1: creativeTask1, task2: creativeTask2 }
    }
  }));
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
