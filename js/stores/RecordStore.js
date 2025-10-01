// RecordStore.js - Global class for file:// protocol compatibility
// Manages practice records and statistics using existing storage keys

window.RecordStore = class RecordStore {
    constructor() {
        if (typeof markStoreInitStart === 'function') markStoreInitStart('RecordStore');
        this.records = [];
        this.processedSessionIds = new Set(); // 按 sessionId 去重 PRACTICE_COMPLETE
        this.stats = {
            totalPracticed: 0,
            averageScore: 0,
            studyTime: 0,
            streakDays: 0,
            categoryStats: {}
        };
        this.observers = new Set();
        
        // Use existing storage system
        this.storage = window.storage;
        if (!this.storage) {
            console.warn('[RecordStore] Storage system not available yet, will retry during initialization');
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
            
            await this.loadRecords();
            this.calculateStats();
            console.log('[RecordStore] Initialized with', this.records.length, 'records');
            if (typeof markStoreInitEnd === 'function') markStoreInitEnd('RecordStore');
        } catch (error) {
            console.error('[RecordStore] Initialization failed:', error);
            if (typeof markStoreInitEnd === 'function') markStoreInitEnd('RecordStore');
            throw error;
        }
    }
    
    normalizeRecord(record) {
        if (!record || !record.id || !record.examId || !record.date) {
            return null; // Invalid record
        }

        const normalized = {
            id: record.id,
            examId: record.examId,
            date: record.date,
            duration: record.duration || 0,
            score: {
                percentage: record.score?.percentage || record.percentage || (record.scoreInfo?.percentage || 0)
            },
            dataSource: record.dataSource || 'real',
            answers: record.answers || (record.realData?.answers || {}),
            metadata: record.metadata || {},
            sessionId: record.sessionId, // Preserve for dedup
            ...record // Preserve other fields but override normalized ones
        };

        // Migrate old shapes lightly
        if (record.realData) {
            // Extract from realData if not already
            normalized.answers = normalized.answers || record.realData.answers || {};
            normalized.duration = normalized.duration || record.realData.duration || 0;
            normalized.metadata.realData = record.realData; // Keep original for legacy if needed
            delete normalized.realData; // Avoid duplication
        }
        if (record.scoreInfo) {
            normalized.score.percentage = normalized.score.percentage || record.scoreInfo.percentage || 0;
            normalized.metadata.scoreInfo = record.scoreInfo; // Keep original
            delete normalized.scoreInfo;
        }

        // Ensure score.percentage is number
        normalized.score.percentage = Number(normalized.score.percentage) || 0;

        return normalized;
    }

    async loadRecords() {
        try {
            // Use existing practice_records key
            const rawRecords = await this.storage.get('practice_records', []);
            
            // Normalize and validate record data
            this.records = rawRecords
                .map(record => this.normalizeRecord(record))
                .filter(record => record !== null);

            // 填充去重 Set
            this.processedSessionIds.clear();
            this.records.forEach(record => {
                if (record.sessionId && record.dataSource === 'real') {
                    this.processedSessionIds.add(record.sessionId);
                }
            });
            
            this.notify({ type: 'records_loaded', records: this.records });
            console.log('[RecordStore] Loaded', this.records.length, 'practice records (normalized)');
        } catch (error) {
            console.error('[RecordStore] Failed to load records:', error);
            this.records = [];
            throw error;
        }
    }
    
    async saveRecord(record) {
        try {
            // Validate required fields for normalized structure
            if (!record.examId || typeof record.score?.percentage !== 'number') {
                throw new Error('Invalid record: missing examId or score.percentage');
            }

            // 去重检查：PRACTICE_COMPLETE 按 sessionId
            if (record.sessionId && record.dataSource === 'real' && this.processedSessionIds.has(record.sessionId)) {
                console.log('[RecordStore] Duplicate PRACTICE_COMPLETE ignored for sessionId:', record.sessionId);
                return null; // 已存在，不保存
            }

            // Normalize to standard shape
            const fullRecord = this.normalizeRecord({
                ...record,
                score: { percentage: record.score?.percentage || record.percentage || 0 },
                answers: record.answers || {},
                metadata: record.metadata || {}
            });

            // 添加到 Set
            if (fullRecord.sessionId && fullRecord.dataSource === 'real') {
                this.processedSessionIds.add(fullRecord.sessionId);
            }
            
            // Add to memory
            this.records.push(fullRecord);
            
            // Save to storage using existing key
            await this.storage.set('practice_records', this.records);
            
            // Update stats and notify
            this.calculateStats();
            this.notify({ type: 'record_saved', record: fullRecord });
            
            console.log('[RecordStore] Saved normalized record:', fullRecord.id);
            return fullRecord;
        } catch (error) {
            console.error('[RecordStore] Failed to save record:', error);
            throw error;
        }
    }
    
    getRecords(filters = {}) {
        let filtered = [...this.records];
        
        if (filters.category) {
            // Need to cross-reference with exam data
            filtered = filtered.filter(record => {
                const exam = window.App?.stores?.exams?.getExamById(record.examId);
                return exam && exam.category === filters.category;
            });
        }
        
        if (filters.type) {
            filtered = filtered.filter(record => {
                const exam = window.App?.stores?.exams?.getExamById(record.examId);
                return exam && exam.type === filters.type;
            });
        }
        
        if (filters.dateFrom) {
            filtered = filtered.filter(record => new Date(record.date) >= new Date(filters.dateFrom));
        }
        
        if (filters.dateTo) {
            filtered = filtered.filter(record => new Date(record.date) <= new Date(filters.dateTo));
        }
        
        if (filters.minScore !== undefined) {
            filtered = filtered.filter(record => {
                const percentage = record.score?.percentage || 0;
                return percentage >= filters.minScore;
            });
        }
        
        // Sort by date (newest first)
        return filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
    }
    
    getRecordById(recordId) {
        return this.records.find(record => record.id === recordId);
    }
    
    calculateStats() {
        const records = this.records;
        
        this.stats.totalPracticed = records.length;
        
        if (records.length > 0) {
            // Average score
            const totalScore = records.reduce((sum, record) => {
                const percentage = record.score?.percentage || 0;
                return sum + percentage;
            }, 0);
            this.stats.averageScore = Math.round(totalScore / records.length * 10) / 10;
            
            // Total study time
            this.stats.studyTime = records.reduce((sum, record) => sum + (record.duration || 0), 0);
            
            // Streak calculation
            this.stats.streakDays = this.calculateStreakDays(records);
            
            // Category statistics
            this.stats.categoryStats = this.calculateCategoryStats(records);
        } else {
            this.stats.averageScore = 0;
            this.stats.studyTime = 0;
            this.stats.streakDays = 0;
            this.stats.categoryStats = {};
        }
        
        this.notify({ type: 'stats_updated', stats: this.stats });
    }
    
    calculateStreakDays(records) {
        // Get unique practice dates
        const dates = [...new Set(records.map(r => new Date(r.date).toDateString()))]
            .sort((a, b) => new Date(b) - new Date(a));
        
        if (dates.length === 0) return 0;
        
        let streak = 0;
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        
        // Check if practiced today or yesterday
        const latestDate = new Date(dates[0]);
        if (latestDate.toDateString() === today.toDateString() || 
            latestDate.toDateString() === yesterday.toDateString()) {
            
            streak = 1;
            
            // Count consecutive days
            for (let i = 0; i < dates.length - 1; i++) {
                const current = new Date(dates[i]);
                const next = new Date(dates[i + 1]);
                const diffDays = Math.ceil((current - next) / (1000 * 60 * 60 * 24));
                
                if (diffDays === 1) {
                    streak++;
                } else {
                    break;
                }
            }
        }
        
        return streak;
    }
    
    calculateCategoryStats(records) {
        const categoryStats = {};
        
        records.forEach(record => {
            const exam = window.App?.stores?.exams?.getExamById(record.examId);
            const category = exam?.category || 'Unknown';
            
            if (!categoryStats[category]) {
                categoryStats[category] = {
                    count: 0,
                    totalScore: 0,
                    averageScore: 0,
                    totalTime: 0
                };
            }
            
            const stats = categoryStats[category];
            stats.count++;
            stats.totalScore += record.score?.percentage || 0;
            stats.totalTime += record.duration || 0;
            stats.averageScore = Math.round(stats.totalScore / stats.count * 10) / 10;
        });
        
        return categoryStats;
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
                console.error('[RecordStore] Observer error:', error);
            }
        });
    }
    
    // Utility methods for record management
    async deleteRecord(recordId) {
        try {
            const index = this.records.findIndex(record => record.id === recordId);
            if (index === -1) {
                throw new Error(`Record not found: ${recordId}`);
            }
            
            const deletedRecord = this.records.splice(index, 1)[0];
            await this.storage.set('practice_records', this.records);
            
            this.calculateStats();
            this.notify({ type: 'record_deleted', record: deletedRecord });
            
            console.log('[RecordStore] Deleted record:', recordId);
            return deletedRecord;
        } catch (error) {
            console.error('[RecordStore] Failed to delete record:', error);
            throw error;
        }
    }
    
    async clearAllRecords() {
        try {
            const recordCount = this.records.length;
            this.records = [];
            this.processedSessionIds.clear();
            await this.storage.set('practice_records', this.records);
            
            this.calculateStats();
            this.notify({ type: 'records_cleared', count: recordCount });
            
            console.log('[RecordStore] Cleared all records:', recordCount);
            return recordCount;
        } catch (error) {
            console.error('[RecordStore] Failed to clear records:', error);
            throw error;
        }
    }
    
    validateRecord(record) {
        const required = ['examId', 'score'];
        const missing = required.filter(field => !record[field]);
        
        if (missing.length > 0) {
            throw new Error(`Record validation failed. Missing fields: ${missing.join(', ')}`);
        }
        
        if (typeof record.score.percentage !== 'number') {
            throw new Error('Record score must include percentage as number');
        }
        
        return true;
    }
    
    exportRecords() {
        return {
            records: this.records,
            stats: this.stats,
            exportDate: new Date().toISOString(),
            version: '1.0'
        };
    }
    
    async importRecords(data) {
        try {
            if (!data.records || !Array.isArray(data.records)) {
                throw new Error('Invalid import data: records must be an array');
            }
            
            // Normalize and validate all records before importing
            const normalizedRecords = data.records
                .map(record => this.normalizeRecord(record))
                .filter(record => {
                    try {
                        this.validateRecord(record);
                        return true;
                    } catch (error) {
                        console.warn(`Invalid record during import: ${error.message}`);
                        return false;
                    }
                });
            
            // Import normalized records
            this.records = normalizedRecords;
            await this.storage.set('practice_records', this.records);
            
            this.calculateStats();
            this.notify({ type: 'records_imported', count: this.records.length });
            
            console.log('[RecordStore] Imported', this.records.length, 'normalized records');
            return this.records.length;
        } catch (error) {
            console.error('[RecordStore] Failed to import records:', error);
            throw error;
        }
    }
};