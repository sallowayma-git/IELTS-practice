const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { ref, isProxy } = require(path.join(
    __dirname,
    '..',
    '..',
    '..',
    'apps',
    'writing-vue',
    'node_modules',
    'vue'
));

const { toIpcSerializable: toElectronIpcSerializable } = require(path.join(
    __dirname,
    '..',
    '..',
    '..',
    'electron',
    'utils',
    'ipc-serialize.js'
));

function createProxyObject(target) {
    return new Proxy(target, {
        get(source, key, receiver) {
            return Reflect.get(source, key, receiver);
        },
        ownKeys(source) {
            return Reflect.ownKeys(source);
        },
        getOwnPropertyDescriptor(source, key) {
            return Reflect.getOwnPropertyDescriptor(source, key);
        }
    });
}

async function loadRendererSerializer() {
    const moduleUrl = pathToFileURL(path.join(
        __dirname,
        '..',
        '..',
        '..',
        'apps',
        'writing-vue',
        'src',
        'utils',
        'ipc-serialize.js'
    )).href;
    return import(moduleUrl);
}

function assertSerializerBehavior(serializer, label) {
    const proxiedPayload = createProxyObject({
        page: 2,
        limit: 12,
        filters: createProxyObject({
            type: 'task2',
            category: 'environment'
        })
    });

    const normalizedPayload = serializer(proxiedPayload);
    assert.deepStrictEqual(normalizedPayload, {
        page: 2,
        limit: 12,
        filters: {
            type: 'task2',
            category: 'environment'
        }
    }, `${label} 未正确展开普通 Proxy`);
    assert.notStrictEqual(normalizedPayload, proxiedPayload, `${label} 仍然返回原始 Proxy`);
    assert.doesNotThrow(() => structuredClone(normalizedPayload), `${label} 普通 Proxy 结果不可 structuredClone`);

    const pagination = ref({ page: 1, limit: 20 });
    assert.ok(isProxy(pagination.value), 'Vue ref payload 预期应为 Proxy');
    const normalizedPagination = serializer(pagination.value);
    assert.deepStrictEqual(normalizedPagination, { page: 1, limit: 20 }, `${label} 未正确展开 Vue reactive Proxy`);
    assert.doesNotThrow(() => structuredClone(normalizedPagination), `${label} Vue Proxy 结果不可 structuredClone`);

    const binaryPayload = {
        name: 'chart.png',
        data: new Uint8Array([1, 2, 3, 4])
    };
    const normalizedBinaryPayload = serializer(binaryPayload);
    assert.ok(normalizedBinaryPayload.data instanceof Uint8Array, `${label} 丢失了 Uint8Array 类型`);
    assert.deepStrictEqual(Array.from(normalizedBinaryPayload.data), [1, 2, 3, 4], `${label} 改坏了二进制内容`);
    assert.doesNotThrow(() => structuredClone(normalizedBinaryPayload), `${label} 二进制载荷结果不可 structuredClone`);
}

async function run() {
    const clientPath = path.join(
        __dirname,
        '..',
        '..',
        '..',
        'apps',
        'writing-vue',
        'src',
        'api',
        'client.js'
    );
    const clientSource = fs.readFileSync(clientPath, 'utf-8');
    assert.ok(clientSource.includes('window.electronAPI.getLocalApiInfo'), 'client.js 未通过最小 shell IPC 解析本地 API 地址');
    assert.ok(clientSource.includes('fetch(`${baseUrl}${path}${buildQuery(query)}`'), 'client.js 未改为 fetch 调用本地 Fastify API');
    assert.ok(clientSource.includes('new EventSource('), 'client.js 未使用 SSE 订阅写作评测流');
    assert.ok(clientSource.includes('/api/writing/evaluations'), 'client.js 未指向新的写作评测 HTTP 路径');

    const { toIpcSerializable: toRendererIpcSerializable } = await loadRendererSerializer();

    assertSerializerBehavior(toElectronIpcSerializable, 'Electron preload serializer');
    assertSerializerBehavior(toRendererIpcSerializable, 'Renderer bridge serializer');

    return {
        status: 'pass',
        detail: '写作客户端已切换到 local API + SSE，序列化工具仍可安全展开 Proxy 与二进制载荷'
    };
}

run()
    .then((result) => {
        process.stdout.write(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
        process.stdout.write(JSON.stringify({
            status: 'fail',
            detail: error.message
        }, null, 2));
        process.exit(1);
    });
