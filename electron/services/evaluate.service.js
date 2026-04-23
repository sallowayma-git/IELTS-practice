const path = require('node:path');
const { ensureTsRuntime } = require('../tsx-register');

ensureTsRuntime();

module.exports = require(path.join(__dirname, '..', '..', 'server', 'src', 'lib', 'writing', 'evaluate-service.ts'));
