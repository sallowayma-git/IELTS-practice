(function (global) {
    'use strict';

    const mixin = {
        _isReadingLibraryExam(exam) {
            if (!exam || typeof exam !== 'object') {
                return false;
            }

            const examType = typeof exam.type === 'string'
                ? exam.type.trim().toLowerCase()
                : '';
            if (examType === 'listening') {
                return false;
            }

            const examId = typeof exam.id === 'string'
                ? exam.id.trim().toLowerCase()
                : '';
            if (examId.startsWith('listening-')) {
                return false;
            }

            return true;
        },

        _getUnifiedReadingManifestEntry(exam) {
            if (!this._isReadingLibraryExam(exam) || !exam.id) {
                return null;
            }
            const manifest = (typeof window !== 'undefined' && window.__READING_EXAM_MANIFEST__)
                ? window.__READING_EXAM_MANIFEST__
                : null;
            const manifestEntry = manifest && exam.id ? manifest[exam.id] : null;
            if (!manifestEntry || !(manifestEntry.dataKey || manifestEntry.examId)) {
                return null;
            }
            return manifestEntry;
        },

        _isUnifiedReadingExam(exam) {
            return !!this._getUnifiedReadingManifestEntry(exam);
        },

        _hasPracticeShellRouteApi() {
            return !!(
                typeof window !== 'undefined'
                && window.electronAPI
                && (
                    typeof window.electronAPI.openPracticeRoute === 'function'
                    || typeof window.electronAPI.openPracticeReading === 'function'
                )
            );
        },

        _isLegacyReadingLaunchContext(options = {}) {
            if (!options || typeof options !== 'object') {
                return false;
            }
            const practiceMode = typeof options.practiceMode === 'string'
                ? options.practiceMode.trim().toLowerCase()
                : '';
            const flowMode = typeof options.suiteFlowMode === 'string'
                ? options.suiteFlowMode.trim().toLowerCase()
                : (typeof options.flowMode === 'string' ? options.flowMode.trim().toLowerCase() : '');

            return Boolean(
                options.forceLegacyReading
                || options.reviewMode
                || options.reviewSessionId
                || options.suiteReviewMode
                || options.suiteSessionId
                || options.suiteFlowMode
                || options.simulationMode
                || practiceMode === 'suite'
                || flowMode === 'classic'
                || flowMode === 'simulation'
                || flowMode === 'stationary'
                || Number.isInteger(options.sequenceIndex)
                || Number.isInteger(options.sequenceTotal)
            );
        },

        _buildUnifiedReadingUrl(exam) {
            const manifestEntry = this._getUnifiedReadingManifestEntry(exam);
            if (!manifestEntry) {
                return '';
            }
            const params = new URLSearchParams();
            if (exam && exam.id) {
                params.set('examId', String(exam.id));
            }
            const resolvedDataKey = manifestEntry.dataKey || manifestEntry.examId || exam?.id;
            if (resolvedDataKey) {
                params.set('dataKey', String(resolvedDataKey));
            }
            const query = params.toString();
            const url = query
                ? `assets/generated/reading-exams/reading-practice-unified.html?${query}`
                : 'assets/generated/reading-exams/reading-practice-unified.html';
            return typeof this._ensureAbsoluteUrl === 'function'
                ? this._ensureAbsoluteUrl(url)
                : url;
        },

        _buildVuePracticeReadingRoute(exam, manifestEntry = null) {
            const resolvedEntry = manifestEntry || this._getUnifiedReadingManifestEntry(exam);
            const assetId = String(
                (exam && exam.id)
                || (resolvedEntry && (resolvedEntry.dataKey || resolvedEntry.examId))
                || ''
            ).trim();
            if (!assetId || !/^[A-Za-z0-9._-]+$/.test(assetId)) {
                return '';
            }
            return `/reading/${encodeURIComponent(assetId)}`;
        },

        _buildReadingPdfUrl(exam) {
            if (!this._isReadingLibraryExam(exam) || !exam || !exam.pdfFilename) {
                return '';
            }

            const pdfUrl = (typeof window.buildResourcePath === 'function')
                ? window.buildResourcePath(exam, 'pdf')
                : ((exam.path || '').replace(/\\/g, '/').replace(/\/+\//g, '/') + (exam.pdfFilename || ''));

            return typeof this._ensureAbsoluteUrl === 'function'
                ? this._ensureAbsoluteUrl(pdfUrl)
                : pdfUrl;
        },

        resolveReadingLaunchDescriptor(exam, options = {}) {
            if (!this._isReadingLibraryExam(exam)) {
                return null;
            }

            const manifestEntry = this._getUnifiedReadingManifestEntry(exam);
            if (manifestEntry) {
                const route = this._buildVuePracticeReadingRoute(exam, manifestEntry);
                if (
                    route
                    && this._hasPracticeShellRouteApi()
                    && !this._isLegacyReadingLaunchContext(options)
                ) {
                    return {
                        mode: 'vue_practice_reading',
                        examId: exam.id,
                        assetId: exam.id,
                        dataKey: manifestEntry.dataKey || manifestEntry.examId || exam.id,
                        manifestEntry,
                        route
                    };
                }

                return {
                    mode: 'unified_html',
                    examId: exam.id,
                    dataKey: manifestEntry.dataKey || manifestEntry.examId || exam.id,
                    manifestEntry,
                    url: this._buildUnifiedReadingUrl(exam)
                };
            }

            const pdfUrl = this._buildReadingPdfUrl(exam);
            if (!pdfUrl) {
                return null;
            }

            return {
                mode: 'pdf_manual',
                examId: exam.id,
                pdfUrl,
                reviewReason: 'manual_mapping_needed'
            };
        }
    };

    global.ExamSystemAppMixins = global.ExamSystemAppMixins || {};
    global.ExamSystemAppMixins.readingLaunch = mixin;
})(typeof window !== 'undefined' ? window : globalThis);
