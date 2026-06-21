/**
 * PDF Handler Component
 * Handles PDF viewing, validation, and management for the IELTS practice system
 */
function summarizePdfHandlerErrorForLog(error) {
    if (!error || typeof error !== 'object') {
        return { name: typeof error };
    }
    const status = Number(error.status);
    return {
        name: typeof error.name === 'string' && error.name ? error.name.slice(0, 80) : 'Error',
        status: Number.isFinite(status) ? status : undefined
    };
}

class PDFHandler {
    constructor() {
        this.pdfViewerUrl = null;
        this.supportedFormats = ['.pdf'];
        this.openWindows = new Map(); // Track opened PDF windows

        // 全局引用，供事件委托使用
        window.pdfHandler = this;

        console.log('[PDFHandler] PDF Handler initialized');
    }

    /**
     * Open PDF in new tab/window
     * @param {string} pdfPath - Path to the PDF file
     * @param {string} examTitle - Title of the exam for window naming
     * @param {Object} options - Additional options for PDF viewing
     * @returns {Window|null} - Reference to opened window or null if failed
     */
    openPDF(pdfPath, examTitle = 'PDF Exam', options = {}) {
        try {
            console.log('[PDFHandler] Opening PDF');

            // Validate PDF path
            const safePdfPath = this.resolvePDFPath(pdfPath);
            if (!safePdfPath) {
                throw new Error('Invalid PDF path provided');
            }

            // Prepare window options
            const windowOptions = this.prepareWindowOptions(options);

            // Generate unique window name
            const windowName = this.generateWindowName(examTitle);

            // Open PDF in new window
            const pdfWindow = window.open(safePdfPath, windowName, windowOptions);

            if (!pdfWindow) {
                throw new Error('Failed to open PDF window. Please check popup blocker settings.');
            }

            try {
                pdfWindow.opener = null;
            } catch (_) {
                // Some browsers block access when noopener is enforced.
            }

            // Track the opened window
            this.trackPDFWindow(safePdfPath, pdfWindow, examTitle);

            // Set up window event handlers
            this.setupWindowHandlers(pdfWindow, safePdfPath);

            console.log('[PDFHandler] PDF opened successfully');
            return pdfWindow;

        } catch (error) {
            console.error('[PDFHandler] Failed to open PDF:', this.summarizeErrorForLog(error));
            this.handlePDFError(error, pdfPath, examTitle);
            return null;
        }
    }

    /**
     * Validate PDF file accessibility
     * @param {string} pdfPath - Path to the PDF file
     * @returns {Promise<boolean>} - True if PDF is accessible
     */
    async validatePDF(pdfPath) {
        try {
            console.log('[PDFHandler] Validating PDF');

            const safePdfPath = this.resolvePDFPath(pdfPath);
            if (!safePdfPath) {
                return false;
            }

            // Use HEAD request to check if file exists
            const response = await fetch(safePdfPath, {
                method: 'HEAD',
                cache: 'no-cache'
            });

            const isValid = response.ok && this.isPDFContentType(response);

            console.log('[PDFHandler] PDF validation result:', isValid ? 'Valid' : 'Invalid');
            return isValid;

        } catch (error) {
            console.error('[PDFHandler] PDF validation failed:', this.summarizeErrorForLog(error));
            return false;
        }
    }

    /**
     * Get PDF metadata if available
     * @param {string} pdfPath - Path to the PDF file
     * @returns {Promise<Object|null>} - PDF metadata or null
     */
    async getPDFInfo(pdfPath) {
        try {
            console.log('[PDFHandler] Getting PDF info');

            const safePdfPath = this.resolvePDFPath(pdfPath);
            if (!safePdfPath) {
                return null;
            }

            const response = await fetch(safePdfPath, { method: 'HEAD' });

            if (!response.ok) {
                return null;
            }

            const info = {
                path: safePdfPath,
                size: response.headers.get('content-length'),
                lastModified: response.headers.get('last-modified'),
                contentType: response.headers.get('content-type'),
                isAccessible: true,
                timestamp: new Date().toISOString()
            };

            console.log('[PDFHandler] PDF info retrieved:', this.summarizePDFInfoForLog(info));
            return info;

        } catch (error) {
            console.error('[PDFHandler] Failed to get PDF info:', this.summarizeErrorForLog(error));
            return {
                path: pdfPath,
                isAccessible: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Check if path is a valid PDF path
     * @param {string} path - File path to check
     * @returns {boolean} - True if valid PDF path
     */
    isValidPDFPath(path) {
        return Boolean(this.resolvePDFPath(path));
    }

    resolvePDFPath(path) {
        if (!path || typeof path !== 'string') {
            return '';
        }

        const rawPath = path.trim();
        if (!rawPath || /[\u0000-\u001F\u007F]/.test(rawPath) || this.hasPathTraversal(rawPath)) {
            return '';
        }

        try {
            const baseHref = window.location && window.location.href ? window.location.href : 'http://localhost/';
            const resolved = new URL(rawPath, baseHref);
            const hasValidExtension = this.supportedFormats.some(ext =>
                resolved.pathname.toLowerCase().endsWith(ext)
            );
            if (!hasValidExtension) {
                return '';
            }

            if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
                const currentOrigin = window.location && window.location.origin;
                return currentOrigin && currentOrigin !== 'null' && resolved.origin === currentOrigin
                    ? resolved.href
                    : '';
            }

            if (resolved.protocol === 'file:' && window.location && window.location.protocol === 'file:') {
                return resolved.href;
            }
        } catch (_) {
            return '';
        }

        return '';
    }

    hasPathTraversal(path) {
        const text = String(path || '').replace(/\\/g, '/');
        if (/(^|\/)\.\.(?:\/|$)/.test(text)) {
            return true;
        }
        try {
            const decoded = decodeURIComponent(text).replace(/\\/g, '/');
            return /(^|\/)\.\.(?:\/|$)/.test(decoded);
        } catch (_) {
            return true;
        }
    }

    /**
     * Check if response has PDF content type
     * @param {Response} response - Fetch response object
     * @returns {boolean} - True if PDF content type
     */
    isPDFContentType(response) {
        const contentType = response.headers.get('content-type');
        return contentType && (
            contentType.includes('application/pdf') ||
            contentType.includes('application/x-pdf')
        );
    }

    redactLogText(value) {
        return String(value || '')
            .replace(/\b[A-Za-z]:[\\/][^\s"'<>]+/g, '[local-path]')
            .replace(/\bfile:\/\/[^\s"'<>]+/gi, '[local-path]')
            .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, '[url]')
            .slice(0, 200);
    }

    summarizeErrorForLog(error) {
        return {
            name: error && error.name ? this.redactLogText(error.name) : 'Error',
            message: error && error.message ? this.redactLogText(error.message) : 'Unknown error'
        };
    }

    summarizePDFInfoForLog(info) {
        return {
            sizeKnown: Boolean(info && info.size),
            contentType: info && info.contentType ? this.redactLogText(info.contentType) : null,
            isAccessible: Boolean(info && info.isAccessible)
        };
    }

    /**
     * Prepare window options for PDF viewing
     * @param {Object} options - Custom options
     * @returns {string} - Window features string
     */
    prepareWindowOptions(options = {}) {
        const defaultOptions = {
            width: Math.floor(window.screen.availWidth * 0.8),
            height: Math.floor(window.screen.availHeight * 0.9),
            left: Math.floor(window.screen.availWidth * 0.1),
            top: Math.floor(window.screen.availHeight * 0.05),
            scrollbars: 'yes',
            resizable: 'yes',
            status: 'yes',
            toolbar: 'yes', // Allow toolbar for PDF controls
            menubar: 'no',
            location: 'yes' // Show location bar for PDF URL
        };

        const allowedFeatures = ['width', 'height', 'left', 'top', 'scrollbars', 'resizable', 'status', 'toolbar', 'menubar', 'location'];
        const finalOptions = { ...defaultOptions };
        allowedFeatures.forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(options || {}, key)) {
                finalOptions[key] = this.normalizeWindowFeatureValue(key, options[key], defaultOptions[key]);
            } else {
                finalOptions[key] = this.normalizeWindowFeatureValue(key, defaultOptions[key], defaultOptions[key]);
            }
        });
        finalOptions.noopener = 'yes';
        finalOptions.noreferrer = 'yes';

        return Object.entries(finalOptions)
            .map(([key, value]) => `${key}=${value}`)
            .join(',');
    }

    normalizeWindowFeatureValue(key, value, fallback) {
        if (['width', 'height', 'left', 'top'].includes(key)) {
            const number = Number(value);
            const safeNumber = Number.isFinite(number) ? Math.round(number) : Number(fallback);
            return String(Math.max(0, Math.min(10000, safeNumber || 0)));
        }
        const text = String(value).trim().toLowerCase();
        if (['yes', '1', 'true'].includes(text)) {
            return 'yes';
        }
        if (['no', '0', 'false'].includes(text)) {
            return 'no';
        }
        return String(fallback).trim().toLowerCase() === 'no' ? 'no' : 'yes';
    }

    /**
     * Generate unique window name for PDF
     * @param {string} examTitle - Exam title
     * @returns {string} - Unique window name
     */
    generateWindowName(examTitle) {
        const cleanTitle = String(examTitle || 'PDF Exam')
            .replace(/[^a-zA-Z0-9]/g, '_')
            .replace(/_+/g, '_')
            .slice(0, 80);
        const timestamp = Date.now();
        return `pdf_${cleanTitle}_${timestamp}`;
    }

    /**
     * Track opened PDF window
     * @param {string} pdfPath - PDF file path
     * @param {Window} pdfWindow - Window reference
     * @param {string} examTitle - Exam title
     */
    trackPDFWindow(pdfPath, pdfWindow, examTitle) {
        const windowInfo = {
            window: pdfWindow,
            path: pdfPath,
            title: examTitle,
            openedAt: new Date().toISOString(),
            isActive: true
        };

        this.openWindows.set(pdfPath, windowInfo);

        // Clean up when window is closed
        const checkClosed = () => {
            if (pdfWindow.closed) {
                this.openWindows.delete(pdfPath);
                console.log('[PDFHandler] PDF window closed');
            } else {
                setTimeout(checkClosed, 1000);
            }
        };

        setTimeout(checkClosed, 1000);
    }

    /**
     * Set up event handlers for PDF window
     * @param {Window} pdfWindow - PDF window reference
     * @param {string} pdfPath - PDF file path
     */
    setupWindowHandlers(pdfWindow, pdfPath) {
        try {
            // Handle window load event
            pdfWindow.addEventListener('load', () => {
                console.log('[PDFHandler] PDF loaded successfully');
                this.onPDFLoaded(pdfPath);
            });

            // Handle window error event
            pdfWindow.addEventListener('error', (error) => {
                console.error('[PDFHandler] PDF window error:', this.summarizeErrorForLog(error));
                this.onPDFError(pdfPath, error);
            });

        } catch (error) {
            // Cross-origin restrictions may prevent event listener setup
            console.warn('[PDFHandler] Could not set up window event handlers:', this.redactLogText(error.message));
        }
    }

    /**
     * Handle PDF loading success
     * @param {string} pdfPath - PDF file path
     */
    onPDFLoaded(pdfPath) {
        const windowInfo = this.openWindows.get(pdfPath);
        if (windowInfo) {
            windowInfo.loadedAt = new Date().toISOString();
            windowInfo.status = 'loaded';
        }

        // Dispatch custom event
        document.dispatchEvent(new CustomEvent('pdfLoaded', {
            detail: { path: pdfPath }
        }));
    }

    /**
     * Handle PDF loading error
     * @param {string} pdfPath - PDF file path
     * @param {Error} error - Error object
     */
    onPDFError(pdfPath, error) {
        const windowInfo = this.openWindows.get(pdfPath);
        if (windowInfo) {
            windowInfo.status = 'error';
            windowInfo.error = error.message;
        }

        // Dispatch custom event
        document.dispatchEvent(new CustomEvent('pdfError', {
            detail: { path: pdfPath, error: error.message }
        }));
    }

    /**
     * Handle PDF opening errors
     * @param {Error} error - Error object
     * @param {string} pdfPath - PDF file path
     * @param {string} examTitle - Exam title
     */
    handlePDFError(error, pdfPath, examTitle) {
        let userMessage = 'Failed to open PDF';
        let suggestion = '';

        if (error.message.includes('popup blocker')) {
            userMessage = 'PDF blocked by popup blocker';
            suggestion = 'Please allow popups for this site and try again';
        } else if (error.message.includes('Invalid PDF path')) {
            userMessage = 'Invalid PDF file';
            suggestion = 'The PDF file path is not valid';
        } else {
            userMessage = 'Cannot open PDF';
            suggestion = 'Please check if the file exists and try again';
        }

        // Show user-friendly error message
        if (window.showMessage) {
            window.showMessage(`${userMessage}: ${examTitle}. ${suggestion}`, 'error');
        }

        // Log detailed error for debugging
        console.error('[PDFHandler] Detailed error:', {
            error: this.redactLogText(error.message),
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Get list of currently open PDF windows
     * @returns {Array} - Array of open window information
     */
    getOpenWindows() {
        const openWindows = [];

        for (const [path, info] of this.openWindows.entries()) {
            if (!info.window.closed) {
                openWindows.push({
                    path: path,
                    title: info.title,
                    openedAt: info.openedAt,
                    status: info.status || 'open'
                });
            }
        }

        return openWindows;
    }

    /**
     * Close all open PDF windows
     */
    closeAllWindows() {
        let closedCount = 0;

        for (const [path, info] of this.openWindows.entries()) {
            if (!info.window.closed) {
                try {
                    info.window.close();
                    closedCount++;
                } catch (error) {
                    console.warn('[PDFHandler] Could not close window:', summarizePdfHandlerErrorForLog(error));
                }
            }
        }

        this.openWindows.clear();
        console.log(`[PDFHandler] Closed ${closedCount} PDF windows`);

        return closedCount;
    }

    /**
     * Get handler status and statistics
     * @returns {Object} - Handler status information
     */
    getStatus() {
        return {
            isInitialized: true,
            supportedFormats: this.supportedFormats,
            openWindowsCount: this.openWindows.size,
            openWindows: this.getOpenWindows(),
            timestamp: new Date().toISOString()
        };
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.PDFHandler = PDFHandler;
}

// Export for Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFHandler;
}
