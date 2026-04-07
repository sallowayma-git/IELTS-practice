#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function main() {
  const modulePath = path.resolve(__dirname, '../../../apps/writing-vue/src/utils/provider-form.js');
  const providerForm = await import(pathToFileURL(modulePath).href);

  assert.strictEqual(
    providerForm.normalizeProviderUrl(' https://api.openai.com/v1/ '),
    'https://api.openai.com/v1',
    'normalizeProviderUrl should trim whitespace and trailing slash'
  );

  assert.strictEqual(
    providerForm.getProviderDefaultBaseUrl('openrouter'),
    'https://openrouter.ai/api/v1',
    'openrouter default base URL must stay stable'
  );

  assert.strictEqual(
    providerForm.isProviderDefaultUrl('deepseek', 'https://api.deepseek.com/v1/'),
    true,
    'default URL detection should ignore trailing slash'
  );

  assert.strictEqual(
    providerForm.resolveProviderBaseUrlOnChange({
      provider: 'deepseek',
      currentBaseUrl: 'https://api.openai.com/v1',
      isLinked: true
    }),
    'https://api.deepseek.com/v1',
    'linked form should switch to next provider default URL'
  );

  assert.strictEqual(
    providerForm.resolveProviderBaseUrlOnChange({
      provider: 'openrouter',
      currentBaseUrl: 'https://custom.example.com/v1',
      isLinked: false
    }),
    'https://custom.example.com/v1',
    'custom user URL must not be overwritten when link is broken'
  );

  process.stdout.write(JSON.stringify({
    status: 'pass',
    defaults: providerForm.PROVIDER_DEFAULTS,
    checked: [
      'normalizeProviderUrl',
      'getProviderDefaultBaseUrl',
      'isProviderDefaultUrl',
      'resolveProviderBaseUrlOnChange'
    ]
  }));
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
