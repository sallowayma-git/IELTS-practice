// ExamStore.js - Global class for file:// protocol compatibility
// Manages exam library data and operations using existing storage keys

window.ExamStore = class ExamStore {
    constructor() {
        this.exams = [];
        this.categories = new Map(); // P1, P2, P3, P4
        this.observers = new Set();
        
        // Use existing storage system
        this.storage = window.storage;
        if (!this.storage) {
            console.warn('[ExamStore] Storage system not available yet, will retry during initialization');
        }
    }
    
    async initialize() {
        try {
            // Ensure storage is available
            if (!this.storage && window.storage) {
                this.storage = window.storage;
            }
            if (!this.storage) {
                throw new Error('Storage system not available. Check script loading order.');
            }

            // Load from existing storage keys
            await this.loadExams();
            this.categorizeExams();

            // Expose methods globally for UI access
            this.exposeToGlobal();

            console.log('[ExamStore] Initialized with', this.exams.length, 'exams');
        } catch (error) {
            console.error('[ExamStore] Initialization failed:', error);
            throw error;
        }
    }
    
    async loadExams() {
        try {
            // Use existing exam_index key and active configuration system
            const activeKey = await this.storage.get('active_exam_index_key', 'exam_index');
            const rawExams = await this.storage.get(activeKey, []);
            
            // Validate and normalize exam data
            if (Array.isArray(rawExams)) {
                this.exams = rawExams.filter(exam => exam && exam.id && exam.title);
            } else {
                console.warn('[ExamStore] Raw exams is not an array:', rawExams);
                this.exams = [];
            }
            this.notify({ type: 'exams_loaded', exams: this.exams });
            
            console.log('[ExamStore] Loaded', this.exams.length, 'exams from key:', activeKey);
        } catch (error) {
            console.error('[ExamStore] Failed to load exams:', error);
            this.exams = [];
            throw error;
        }
    }
    
    getExamsByCategory(category) {
        if (category === 'all' || !category) return this.exams;
        return this.exams.filter(exam => exam.category === category);
    }
    
    searchExams(query) {
        if (!query || query.trim() === '') return this.exams;
        
        const lowerQuery = query.toLowerCase().trim();
        return this.exams.filter(exam => 
            exam.title.toLowerCase().includes(lowerQuery) ||
            (exam.category && exam.category.toLowerCase().includes(lowerQuery)) ||
            (exam.topics && exam.topics.some(topic => topic.toLowerCase().includes(lowerQuery)))
        );
    }
    
    getExamById(examId) {
        return this.exams.find(exam => exam.id === examId);
    }
    
    categorizeExams() {
        this.categories.clear();
        this.exams.forEach(exam => {
            const category = exam.category || 'Unknown';
            if (!this.categories.has(category)) {
                this.categories.set(category, []);
            }
            this.categories.get(category).push(exam);
        });
        
        this.notify({ type: 'categories_updated', categories: this.categories });
    }
    
    getCategoryStats() {
        const stats = {};
        this.categories.forEach((exams, category) => {
            stats[category] = {
                count: exams.length,
                types: [...new Set(exams.map(e => e.type || 'reading'))]
            };
        });
        return stats;
    }
    
    // Simple observer pattern for UI updates
    subscribe(callback) {
        if (typeof callback !== 'function') {
            throw new Error('Observer callback must be a function');
        }
        this.observers.add(callback);
        return () => this.observers.delete(callback); // Return unsubscribe function
    }
    
    notify(event) {
        this.observers.forEach(callback => {
            try {
                callback(event);
            } catch (error) {
                console.error('[ExamStore] Observer error:', error);
            }
        });
    }
    
    // Utility methods for exam management
    async refreshExams() {
        await this.loadExams();
        this.categorizeExams();
    }

    // Expose refreshExams globally for UI access
    exposeToGlobal() {
        if (typeof window !== 'undefined') {
            window.refreshExamLibrary = () => this.refreshExams();
            window.loadExamLibrary = () => this.refreshExams();
        }
    }
    
    getExamPath(exam) {
        if (!exam || !exam.path || !exam.filename) {
            return null;
        }
        return exam.path + exam.filename;
    }
    
    validateExam(exam) {
        const required = ['id', 'title', 'category'];
        const missing = required.filter(field => !exam[field]);
        
        if (missing.length > 0) {
            throw new Error(`Exam validation failed. Missing fields: ${missing.join(', ')}`);
        }
        
        return true;
    }
};