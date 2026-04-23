const path = require('node:path');
const { ensureTsRuntime } = require('../tsx-register');

ensureTsRuntime();

module.exports = require(path.join(__dirname, '..', '..', 'server', 'src', 'lib', 'shared', 'provider-orchestrator.ts')).ProviderOrchestratorService;
