(function initEnvironmentDetector(global) {
    if (!global) {
        return;
    }

    const LOCATION_HINTS = ['test_env=1', 'suite_test=1', 'ci=1'];

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
                this.enableTestEnvironment();
                return true;
            }

            return false;
        },

        enableTestEnvironment() {
            global.__IELTS_FORCE_TEST_ENV__ = true;
        },

        disableTestEnvironment() {
            global.__IELTS_FORCE_TEST_ENV__ = false;
        }
    };

    global.EnvironmentDetector = environmentDetector;
})(typeof window !== 'undefined' ? window : null);
