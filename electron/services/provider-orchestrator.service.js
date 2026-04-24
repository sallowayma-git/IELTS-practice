const path = require('node:path');
module.exports = require(path.join(__dirname, '..', '..', 'server', 'dist', 'lib', 'shared', 'provider-orchestrator.js')).ProviderOrchestratorService;
