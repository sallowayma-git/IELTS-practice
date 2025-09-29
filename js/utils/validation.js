// validation.js - Data validation functions for file:// protocol compatibility
// Pure functions for validating exam and record data integrity

// Exam validation functions
window.validateExam = function(exam) {
    if (!exam || typeof exam !== 'object') {
        throw new Error('Exam must be an object');
    }
    
    const required = ['id', 'title', 'category'];
    const missing = required.filter(field => !exam[field]);
    
    if (missing.length > 0) {
        throw new Error(`Exam validation failed. Missing required fields: ${missing.join(', ')}`);
    }
    
    // Validate field types
    if (typeof exam.id !== 'string' || exam.id.trim() === '') {
        throw new Error('Exam id must be a non-empty string');
    }
    
    if (typeof exam.title !== 'string' || exam.title.trim() === '') {
        throw new Error('Exam title must be a non-empty string');
    }
    
    if (typeof exam.category !== 'string' || exam.category.trim() === '') {
        throw new Error('Exam category must be a non-empty string');
    }
    
    // Validate category values
    const validCategories = ['P1', 'P2', 'P3', 'P4'];
    if (!validCategories.includes(exam.category)) {
        throw new Error(`Invalid exam category: ${exam.category}. Must be one of: ${validCategories.join(', ')}`);
    }
    
    // Validate optional fields
    if (exam.type && typeof exam.type !== 'string') {
        throw new Error('Exam type must be a string');
    }
    
    if (exam.difficulty && !['easy', 'medium', 'hard'].includes(exam.difficulty)) {
        throw new Error('Exam difficulty must be: easy, medium, or hard');
    }
    
    if (exam.topics && !Array.isArray(exam.topics)) {
        throw new Error('Exam topics must be an array');
    }
    
    return true;
};

// Record validation functions
window.validateRecord = function(record) {
    if (!record || typeof record !== 'object') {
        throw new Error('Record must be an object');
    }
    
    const required = ['examId', 'score'];
    const missing = required.filter(field => !record[field]);
    
    if (missing.length > 0) {
        throw new Error(`Record validation failed. Missing required fields: ${missing.join(', ')}`);
    }
    
    // Validate examId
    if (typeof record.examId !== 'string' || record.examId.trim() === '') {
        throw new Error('Record examId must be a non-empty string');
    }
    
    // Validate score object
    if (!record.score || typeof record.score !== 'object') {
        throw new Error('Record score must be an object');
    }
    
    if (typeof record.score.percentage !== 'number') {
        throw new Error('Record score must include percentage as number');
    }
    
    if (record.score.percentage < 0 || record.score.percentage > 100) {
        throw new Error('Record score percentage must be between 0 and 100');
    }
    
    // Validate optional fields
    if (record.date && !isValidDate(record.date)) {
        throw new Error('Record date must be a valid ISO date string');
    }
    
    if (record.duration && (typeof record.duration !== 'number' || record.duration < 0)) {
        throw new Error('Record duration must be a non-negative number');
    }
    
    if (record.answers && typeof record.answers !== 'object') {
        throw new Error('Record answers must be an object');
    }
    
    return true;
};

// Statistics validation functions
window.validateStats = function(stats) {
    if (!stats || typeof stats !== 'object') {
        throw new Error('Stats must be an object');
    }
    
    const required = ['totalPracticed', 'averageScore', 'studyTime', 'streakDays'];
    const missing = required.filter(field => typeof stats[field] !== 'number');
    
    if (missing.length > 0) {
        throw new Error(`Stats validation failed. Missing or invalid numeric fields: ${missing.join(', ')}`);
    }
    
    // Validate ranges
    if (stats.totalPracticed < 0) {
        throw new Error('Stats totalPracticed must be non-negative');
    }
    
    if (stats.averageScore < 0 || stats.averageScore > 100) {
        throw new Error('Stats averageScore must be between 0 and 100');
    }
    
    if (stats.studyTime < 0) {
        throw new Error('Stats studyTime must be non-negative');
    }
    
    if (stats.streakDays < 0) {
        throw new Error('Stats streakDays must be non-negative');
    }
    
    return true;
};

// Data sanitization functions
window.sanitizeExam = function(exam) {
    if (!exam) return null;
    
    const sanitized = {
        id: String(exam.id || '').trim(),
        title: String(exam.title || '').trim(),
        category: String(exam.category || '').trim().toUpperCase(),
        type: String(exam.type || 'reading').trim().toLowerCase(),
        path: String(exam.path || '').trim(),
        filename: String(exam.filename || '').trim(),
        hasHtml: Boolean(exam.hasHtml),
        hasPdf: Boolean(exam.hasPdf),
        difficulty: String(exam.difficulty || 'medium').trim().toLowerCase(),
        topics: Array.isArray(exam.topics) ? exam.topics.map(t => String(t).trim()) : [],
        createdAt: exam.createdAt || new Date().toISOString()
    };
    
    // Remove empty strings
    Object.keys(sanitized).forEach(key => {
        if (sanitized[key] === '') {
            delete sanitized[key];
        }
    });
    
    return sanitized;
};

window.sanitizeRecord = function(record) {
    if (!record) return null;
    
    const sanitized = {
        id: record.id || 'record_' + Date.now(),
        examId: String(record.examId || '').trim(),
        date: record.date || new Date().toISOString(),
        duration: Number(record.duration) || 0,
        score: record.score ? {
            correct: Number(record.score.correct) || 0,
            total: Number(record.score.total) || 0,
            percentage: Number(record.score.percentage) || 0
        } : { correct: 0, total: 0, percentage: 0 },
        answers: record.answers || {},
        dataSource: String(record.dataSource || 'real').trim()
    };
    
    return sanitized;
};

// Migration helpers for old data formats
window.migrateExamData = function(oldExam) {
    if (!oldExam) return null;
    
    try {
        // Handle various old formats
        const migrated = {
            id: oldExam.id || oldExam.examId || 'exam_' + Date.now(),
            title: oldExam.title || oldExam.name || 'Untitled Exam',
            category: oldExam.category || oldExam.part || 'P1',
            type: oldExam.type || 'reading',
            path: oldExam.path || oldExam.folder || '',
            filename: oldExam.filename || oldExam.file || '',
            hasHtml: oldExam.hasHtml !== false,
            hasPdf: oldExam.hasPdf !== false,
            difficulty: oldExam.difficulty || 'medium',
            topics: oldExam.topics || oldExam.tags || [],
            createdAt: oldExam.createdAt || oldExam.created || new Date().toISOString()
        };
        
        return sanitizeExam(migrated);
    } catch (error) {
        console.warn('[Migration] Failed to migrate exam:', oldExam, error);
        return null;
    }
};

window.migrateRecordData = function(oldRecord) {
    if (!oldRecord) return null;
    
    try {
        // Handle various old formats
        const migrated = {
            id: oldRecord.id || 'record_' + Date.now(),
            examId: oldRecord.examId || oldRecord.exam_id || oldRecord.exam,
            date: oldRecord.date || oldRecord.timestamp || new Date().toISOString(),
            duration: oldRecord.duration || oldRecord.time || 0,
            score: oldRecord.score || {
                correct: oldRecord.correct || 0,
                total: oldRecord.total || 0,
                percentage: oldRecord.percentage || oldRecord.score_percentage || 0
            },
            answers: oldRecord.answers || oldRecord.responses || {},
            dataSource: oldRecord.dataSource || oldRecord.source || 'real'
        };
        
        return sanitizeRecord(migrated);
    } catch (error) {
        console.warn('[Migration] Failed to migrate record:', oldRecord, error);
        return null;
    }
};

// Utility functions
function isValidDate(dateString) {
    if (!dateString) return false;
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date.getTime());
}

// Batch validation functions
window.validateExamArray = function(exams) {
    if (!Array.isArray(exams)) {
        throw new Error('Exams must be an array');
    }
    
    const errors = [];
    const validExams = [];
    
    exams.forEach((exam, index) => {
        try {
            validateExam(exam);
            validExams.push(exam);
        } catch (error) {
            errors.push({ index, exam, error: error.message });
        }
    });
    
    return {
        valid: validExams,
        errors: errors,
        totalCount: exams.length,
        validCount: validExams.length,
        errorCount: errors.length
    };
};

window.validateRecordArray = function(records) {
    if (!Array.isArray(records)) {
        throw new Error('Records must be an array');
    }
    
    const errors = [];
    const validRecords = [];
    
    records.forEach((record, index) => {
        try {
            validateRecord(record);
            validRecords.push(record);
        } catch (error) {
            errors.push({ index, record, error: error.message });
        }
    });
    
    return {
        valid: validRecords,
        errors: errors,
        totalCount: records.length,
        validCount: validRecords.length,
        errorCount: errors.length
    };
};

// Schema validation for import/export
window.validateImportData = function(data) {
    if (!data || typeof data !== 'object') {
        throw new Error('Import data must be an object');
    }
    
    const result = {
        valid: true,
        errors: [],
        warnings: []
    };
    
    // Check version compatibility
    if (data.version && data.version !== '1.0') {
        result.warnings.push(`Unknown data version: ${data.version}. Attempting to import anyway.`);
    }
    
    // Validate exams if present
    if (data.exams) {
        try {
            const examValidation = validateExamArray(data.exams);
            if (examValidation.errorCount > 0) {
                result.errors.push(`${examValidation.errorCount} invalid exams found`);
                result.valid = false;
            }
        } catch (error) {
            result.errors.push(`Exam data validation failed: ${error.message}`);
            result.valid = false;
        }
    }
    
    // Validate records if present
    if (data.records) {
        try {
            const recordValidation = validateRecordArray(data.records);
            if (recordValidation.errorCount > 0) {
                result.errors.push(`${recordValidation.errorCount} invalid records found`);
                result.valid = false;
            }
        } catch (error) {
            result.errors.push(`Record data validation failed: ${error.message}`);
            result.valid = false;
        }
    }
    
    return result;
};