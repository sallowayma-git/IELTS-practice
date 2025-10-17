/**
 * PDF Handler Component
 * Handles PDF viewing, validation, and management for the IELTS practice system
 */
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
            console.log('[PDFHandler] Opening PDF:', pdfPath);
            
            // Validate PDF path
            if (!this.isValidPDFPath(pdfPath)) {
                throw new Error('Invalid PDF path provided');
            }

            // Prepare window options
            const windowOptions = this.prepareWindowOptions(options);
            
            // Generate unique window name
            const windowName = this.generateWindowName(examTitle);
            
            // Open PDF in new window
            const pdfWindow = window.open(pdfPath, windowName, windowOptions);
            
            if (!pdfWindow) {
                throw new Error('Failed to open PDF window. Please check popup blocker settings.');
            }

            // Track the opened window
            this.trackPDFWindow(pdfPath, pdfWindow, examTitle);
            
            // Set up window event handlers
            this.setupWindowHandlers(pdfWindow, pdfPath);
            
            console.log('[PDFHandler] PDF opened successfully:', examTitle);
            return pdfWindow;
            
        } catch (error) {
            console.error('[PDFHandler] Failed to open PDF:', error);
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
            console.log('[PDFHandler] Validating PDF:', pdfPath);
            
            if (!this.isValidPDFPath(pdfPath)) {
                return false;
            }

            // Use HEAD request to check if file exists
            const response = await fetch(pdfPath, { 
                method: 'HEAD',
                cache: 'no-cache'
            });
            
            const isValid = response.ok && this.isPDFContentType(response);
            
            console.log('[PDFHandler] PDF validation result:', isValid ? 'Valid' : 'Invalid');
            return isValid;
            
        } catch (error) {
            console.error('[PDFHandler] PDF validation failed:', error);
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
            console.log('[PDFHandler] Getting PDF info:', pdfPath);
            
            const response = await fetch(pdfPath, { method: 'HEAD' });
            
            if (!response.ok) {
                return null;
            }

            const info = {
                path: pdfPath,
                size: response.headers.get('content-length'),
                lastModified: response.headers.get('last-modified'),
                contentType: response.headers.get('content-type'),
                isAccessible: true,
                timestamp: new Date().toISOString()
            };

            console.log('[PDFHandler] PDF info retrieved:', info);
            return info;
            
        } catch (error) {
            console.error('[PDFHandler] Failed to get PDF info:', error);
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
        if (!path || typeof path !== 'string') {
            return false;
        }

        // Check file extension
        const hasValidExtension = this.supportedFormats.some(ext => 
            path.toLowerCase().endsWith(ext)
        );

        // Basic path validation
        const isValidPath = !path.includes('..') && // Prevent directory traversal
                           !path.startsWith('javascript:') && // Prevent XSS
                           !path.startsWith('data:'); // Prevent data URLs

        return hasValidExtension && isValidPath;
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

        const finalOptions = { ...defaultOptions, ...options };

        return Object.entries(finalOptions)
            .map(([key, value]) => `${key}=${value}`)
            .join(',');
    }

    /**
     * Generate unique window name for PDF
     * @param {string} examTitle - Exam title
     * @returns {string} - Unique window name
     */
    generateWindowName(examTitle) {
        const cleanTitle = examTitle.replace(/[^a-zA-Z0-9]/g, '_');
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
                console.log('[PDFHandler] PDF window closed:', examTitle);
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
                console.error('[PDFHandler] PDF window error:', error);
                this.onPDFError(pdfPath, error);
            });

        } catch (error) {
            // Cross-origin restrictions may prevent event listener setup
            console.warn('[PDFHandler] Could not set up window event handlers:', error.message);
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
            error: error.message,
            path: pdfPath,
            title: examTitle,
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
                    console.warn('[PDFHandler] Could not close window:', error);
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