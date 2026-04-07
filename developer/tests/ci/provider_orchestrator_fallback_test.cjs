#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const Module = require('module');

const orchestratorPath = path.resolve(__dirname, '../../../electron/services/provider-orchestrator.service.js');

const providerCalls = [];
let behaviorByModel = {};

class MockLLMProvider {
    constructor(config) {
        this.config = config;
    }

    async streamCompletion() {
        providerCalls.push(this.config.model);
        const behavior = behaviorByModel[this.config.model];
        if (typeof behavior === 'function') {
            return behavior();
        }
        if (behavior instanceof Error) {
            throw behavior;
        }
        return null;
    }
}

const originalRequire = Module.prototype.require;
Module.prototype.require = function patchedRequire(id) {
    if (id === './llm-provider') {
        return MockLLMProvider;
    }
    if (id.includes('utils/logger')) {
        return {
            info: () => {},
            warn: () => {},
            error: () => {},
            debug: () => {}
        };
    }
    return originalRequire.apply(this, arguments);
};

const ProviderOrchestratorService = require(orchestratorPath);

function resetMock(behavior = {}) {
    providerCalls.length = 0;
    behaviorByModel = behavior;
}

async function testPreferredFailThenBackupSuccess() {
    const primary = {
        id: 101,
        provider: 'custom',
        base_url: 'https://a.example.com',
        api_key: 'k1',
        default_model: 'primary-model',
        max_retries: 0,
        enabled: 1,
        failure_count: 0
    };
    const backup = {
        id: 102,
        provider: 'custom',
        base_url: 'https://b.example.com',
        api_key: 'k2',
        default_model: 'backup-model',
        max_retries: 0,
        enabled: 1,
        failure_count: 0
    };

    const failMarks = [];
    const successMarks = [];
    const configService = {
        async getDecryptedEnabledConfigs() {
            return [primary, backup];
        },
        async getConfigByIdDecrypted(id) {
            if (id === primary.id) return primary;
            return null;
        },
        markFailure(id, cooldownUntil) {
            failMarks.push({ id, cooldownUntil });
        },
        markSuccess(id) {
            successMarks.push(id);
        }
    };

    const orchestrator = new ProviderOrchestratorService(configService);
    resetMock({
        'primary-model': new Error('invalid api key'),
        'backup-model': () => null
    });

    const result = await orchestrator.streamCompletion({
        preferredConfigId: primary.id,
        messages: [{ role: 'user', content: 'hello' }],
        onChunk: () => {}
    });

    assert.strictEqual(result.usedConfig.id, backup.id, 'should fallback to backup provider');
    assert.deepStrictEqual(providerCalls, ['primary-model', 'backup-model'], 'provider call order should keep preferred first');
    assert.strictEqual(failMarks.length, 1, 'primary failure should be recorded');
    assert.strictEqual(failMarks[0].id, primary.id);
    assert.deepStrictEqual(successMarks, [backup.id], 'backup success should be recorded');
}

async function testPreferredNotFoundFallsBackToEnabled() {
    const backup = {
        id: 202,
        provider: 'custom',
        base_url: 'https://b.example.com',
        api_key: 'k2',
        default_model: 'backup-only-model',
        max_retries: 0,
        enabled: 1,
        failure_count: 0
    };

    const configService = {
        async getDecryptedEnabledConfigs() {
            return [backup];
        },
        async getConfigByIdDecrypted() {
            return null;
        },
        markFailure() {},
        markSuccess() {}
    };

    const orchestrator = new ProviderOrchestratorService(configService);
    resetMock({
        'backup-only-model': () => null
    });

    const result = await orchestrator.streamCompletion({
        preferredConfigId: 99999,
        messages: [{ role: 'user', content: 'hello' }],
        onChunk: () => {}
    });

    assert.strictEqual(result.usedConfig.id, backup.id, 'missing preferred config should fallback to enabled config');
    assert.deepStrictEqual(providerCalls, ['backup-only-model']);
}

async function testDisabledPreferredFallsBackToEnabled() {
    const disabledPrimary = {
        id: 301,
        provider: 'custom',
        base_url: 'https://a.example.com',
        api_key: 'k1',
        default_model: 'disabled-primary-model',
        max_retries: 0,
        enabled: 0,
        failure_count: 0
    };
    const backup = {
        id: 302,
        provider: 'custom',
        base_url: 'https://b.example.com',
        api_key: 'k2',
        default_model: 'enabled-backup-model',
        max_retries: 0,
        enabled: 1,
        failure_count: 0
    };

    const configService = {
        async getDecryptedEnabledConfigs() {
            return [backup];
        },
        async getConfigByIdDecrypted() {
            return disabledPrimary;
        },
        markFailure() {},
        markSuccess() {}
    };

    const orchestrator = new ProviderOrchestratorService(configService);
    resetMock({
        'enabled-backup-model': () => null
    });

    const result = await orchestrator.streamCompletion({
        preferredConfigId: disabledPrimary.id,
        messages: [{ role: 'user', content: 'hello' }],
        onChunk: () => {}
    });

    assert.strictEqual(result.usedConfig.id, backup.id, 'disabled preferred config should not block fallback chain');
    assert.deepStrictEqual(providerCalls, ['enabled-backup-model']);
}

async function run() {
    await testPreferredFailThenBackupSuccess();
    await testPreferredNotFoundFallsBackToEnabled();
    await testDisabledPreferredFallsBackToEnabled();
    console.log('provider_orchestrator_fallback_test: PASS');
}

run().catch((error) => {
    console.error('provider_orchestrator_fallback_test: FAIL');
    console.error(error);
    process.exit(1);
});
