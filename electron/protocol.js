const fs = require('node:fs');
const path = require('node:path');
const { net, protocol } = require('electron');
const { pathToFileURL } = require('node:url');

function normalizeRelativePath(rawPathname) {
    const decoded = decodeURIComponent(rawPathname || '/');
    const withoutLeading = decoded.replace(/^\/+/, '');
    const relativePath = withoutLeading || 'index.html';

    if (relativePath.includes('\0')) {
        return null;
    }

    const normalized = path.posix.normalize(relativePath);
    if (normalized.startsWith('../') || normalized === '..') {
        return null;
    }

    return normalized;
}

function createNotFoundResponse(message = 'Not Found') {
    return new Response(message, {
        status: 404,
        headers: {
            'content-type': 'text/plain; charset=utf-8'
        }
    });
}

async function registerAppProtocol(assetResolver) {
    protocol.handle('app', async (request) => {
        try {
            const url = new URL(request.url);
            const relativePath = normalizeRelativePath(url.pathname);
            if (!relativePath) {
                return createNotFoundResponse('Invalid path');
            }

            const resolution = await assetResolver(relativePath);
            if (!resolution || resolution.deleted || !resolution.filePath || !fs.existsSync(resolution.filePath)) {
                return createNotFoundResponse();
            }

            return net.fetch(pathToFileURL(resolution.filePath).toString());
        } catch (error) {
            return new Response(String(error?.message || error || 'Failed to resolve app asset'), {
                status: 500,
                headers: {
                    'content-type': 'text/plain; charset=utf-8'
                }
            });
        }
    });
}

module.exports = {
    registerAppProtocol
};
