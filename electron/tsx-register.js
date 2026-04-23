const path = require('node:path');

let unregister = null;

function ensureTsRuntime() {
    if (unregister) {
        return unregister;
    }

    const { register } = require('tsx/cjs/api');
    unregister = register({
        tsconfig: path.join(__dirname, '..', 'server', 'tsconfig.json')
    });
    return unregister;
}

module.exports = {
    ensureTsRuntime
};
