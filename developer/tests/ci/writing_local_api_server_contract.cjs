#!/usr/bin/env node
'use strict';

const assert = require('assert');
const net = require('net');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const LocalApiServer = require(path.join(repoRoot, 'electron', 'local-api-server.js'));

function createServiceStubs() {
  const noop = async () => ({});
  const emptyList = async () => ({ data: [], total: 0, page: 1, limit: 20 });

  return {
    evaluateService: {
      start: async () => ({ sessionId: 'stub-session' }),
      cancel: noop,
      subscribeSession: () => () => {}
    },
    configService: {
      list: async () => [],
      create: noop,
      update: noop,
      delete: noop,
      test: async () => ({ latency: 1 }),
      setDefault: noop
    },
    promptService: {
      getActive: noop,
      import: noop,
      exportActive: noop,
      activate: noop
    },
    essayService: {
      create: async () => 1,
      list: emptyList,
      getById: noop,
      delete: noop,
      batchDelete: async () => 0,
      deleteAll: async () => 0,
      getStatistics: noop,
      exportCSV: async () => ''
    },
    topicService: {
      list: emptyList,
      create: async () => 1,
      update: noop,
      delete: noop
    },
    settingsService: {
      getAll: noop,
      update: noop
    },
    uploadService: {
      uploadImage: noop,
      deleteImage: async () => true,
      getImagePath: () => '/tmp/mock.png'
    }
  };
}

async function reserveFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

async function main() {
  const requestedPort = await reserveFreePort();
  const previousPort = process.env.WRITING_API_PORT;
  process.env.WRITING_API_PORT = String(requestedPort);

  const services = createServiceStubs();
  const primary = new LocalApiServer(services);
  const fallback = new LocalApiServer(services);

  try {
    const primaryInfo = await primary.start();
    const fallbackInfo = await fallback.start();

    assert.strictEqual(primaryInfo.port, requestedPort, 'primary server should bind requested port');
    assert.notStrictEqual(fallbackInfo.port, requestedPort, 'fallback server must not reuse occupied port');
    assert.ok(Number.isInteger(fallbackInfo.port) && fallbackInfo.port > 0, 'fallback server should expose a valid port');
    assert.ok(
      fallbackInfo.baseUrl.endsWith(`:${fallbackInfo.port}`),
      'fallback baseUrl should reflect actual fallback port'
    );

    process.stdout.write(JSON.stringify({
      status: 'pass',
      requestedPort,
      primaryPort: primaryInfo.port,
      fallbackPort: fallbackInfo.port
    }));
  } finally {
    await fallback.stop();
    await primary.stop();

    if (previousPort === undefined) {
      delete process.env.WRITING_API_PORT;
    } else {
      process.env.WRITING_API_PORT = previousPort;
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
