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
    assert.ok(clientSource.includes('function callBridge(method, ...args)'), 'client.js 缺少 callBridge 包装层');
    assert.ok(clientSource.includes('callBridge(window.writingAPI.topics.list'), 'topics.list 未经过 renderer 序列化边界');
    assert.ok(clientSource.includes('callBridge(window.writingAPI.essays.list'), 'essays.list 未经过 renderer 序列化边界');

    const { toIpcSerializable: toRendererIpcSerializable } = await loadRendererSerializer();

    assertSerializerBehavior(toElectronIpcSerializable, 'Electron preload serializer');
    assertSerializerBehavior(toRendererIpcSerializable, 'Renderer bridge serializer');

    return {
        status: 'pass',
        detail: 'IPC 参数序列化可展开 Vue/普通 Proxy，且保留二进制载荷'
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
