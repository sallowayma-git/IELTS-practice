(function initEnvironmentDetector(global) {
    if (!global) {
        return;
    }

    const FLAG_KEY = '__ielts_test_env__';
    const LOCATION_HINTS = ['test_env=1', 'suite_test=1', 'ci=1'];

    const readStorageFlag = () => {
        try {
            if (global.localStorage) {
                return global.localStorage.getItem(FLAG_KEY) === 'true';
            }
        } catch (error) {
            console.warn('[EnvDetector] 无法读取测试标记:', error);
        }
        return false;
    };

    const persistFlag = (value) => {
        try {
            if (global.localStorage) {
                if (value) {
                    global.localStorage.setItem(FLAG_KEY, 'true');
                } else {
                    global.localStorage.removeItem(FLAG_KEY);
                }
            }
        } catch (error) {
            console.warn('[EnvDetector] 无法写入测试标记:', error);
        }
    };

    const shouldActivateFromLocation = () => {
        if (!global.location) {
            return false;
        }
        const search = (global.location.search || '').toLowerCase();
        const hash = (global.location.hash || '').toLowerCase();
        return LOCATION_HINTS.some((hint) => search.includes(hint) || hash.includes(hint));
    };

    const environmentDetector = {
        isInTestEnvironment() {
            if (global.__IELTS_FORCE_TEST_ENV__ === true) {
                return true;
            }

            if (shouldActivateFromLocation()) {
                this.enableTestEnvironment({ persist: true });
                return true;
            }

            if (readStorageFlag()) {
                global.__IELTS_FORCE_TEST_ENV__ = true;
                return true;
            }

            const userAgent = (global.navigator && global.navigator.userAgent) || '';
            if (/\b(playwright|puppeteer|headlesschrome)\b/i.test(userAgent)) {
                return true;
            }

            return false;
        },

        enableTestEnvironment(options = {}) {
            global.__IELTS_FORCE_TEST_ENV__ = true;
            if (options.persist !== false) {
                persistFlag(true);
            }
        },

        disableTestEnvironment() {
            global.__IELTS_FORCE_TEST_ENV__ = false;
            persistFlag(false);
        }
    };

    global.EnvironmentDetector = environmentDetector;
})(typeof window !== 'undefined' ? window : null);
