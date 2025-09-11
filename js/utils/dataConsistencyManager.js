/**
 * 数据一致性管理器
 * 确保弹窗显示和导出数据的一致性
 */
class DataConsistencyManager {
    constructor() {
        this.validationRules = {
            requiredFields: ['id', 'startTime', 'answers'],
            optionalFields: ['correctAnswers', 'answerComparison', 'scoreInfo'],
            answerKeyFormats: ['q1', 'q2', 'question1', 'question2']
        };
    }

    /**
     * 验证记录数据完整性
     */
    validateRecordData(record) {
        const validation = {
            isValid: true,
            errors: [],
            warnings: [],
            missingFields: [],
            dataQuality: 'good'
        };

        // 检查必需字段
        this.validationRules.requiredFields.forEach(field => {
            if (!record[field]) {
                validation.errors.push(`缺少必需字段: ${field}`);
                validation.missingFields.push(field);
                validation.isValid = false;
            }
        });

        // 检查答案数据
        if (record.answers) {
            const answerValidation = this.validateAnswers(record.answers);
            if (!answerValidation.isValid) {
                validation.warnings.push('用户答案数据存在问题');
                validation.dataQuality = 'fair';
            }
        }

        // 检查正确答案数据
        if (record.correctAnswers) {
            const correctAnswerValidation = this.validateAnswers(record.correctAnswers);
            if (!correctAnswerValidation.isValid) {
                validation.warnings.push('正确答案数据存在问题');
            }
        } else {
            validation.warnings.push('缺少正确答案数据');
            validation.dataQuality = 'poor';
        }

        // 检查答案比较数据
        if (!record.answerComparison && record.answers && record.correctAnswers) {
            validation.warnings.push('缺少答案比较数据，将自动生成');
        }

        // 设置数据质量等级
        if (validation.errors.length > 0) {
            validation.dataQuality = 'invalid';
        } else if (validation.warnings.length > 2) {
            validation.dataQuality = 'poor';
        } else if (validation.warnings.length > 0) {
            validation.dataQuality = 'fair';
        }

        console.log('[DataConsistencyManager] 数据验证结果:', validation);
        return validation;
    }

    /**
     * 补充缺失的数据
     */
    enrichRecordData(record) {
        console.log('[DataConsistencyManager] 开始数据补充:', record.id);
        
        const enriched = { ...record };

        // 标准化答案格式
        if (enriched.answers) {
            enriched.answers = this.standardizeAnswerFormat(enriched.answers);
        }

        if (enriched.correctAnswers) {
            enriched.correctAnswers = this.standardizeAnswerFormat(enriched.correctAnswers);
        }

        // 生成缺失的答案比较数据
        if (!enriched.answerComparison && enriched.answers) {
            enriched.answerComparison = this.generateAnswerComparison(
                enriched.answers, 
                enriched.correctAnswers || {}
            );
            console.log('[DataConsistencyManager] 生成答案比较数据');
        }

        // 修复分数信息
        if (!enriched.scoreInfo && enriched.answerComparison) {
            enriched.scoreInfo = this.calculateScoreFromComparison(enriched.answerComparison);
            console.log('[DataConsistencyManager] 从答案比较计算分数');
        }

        // 确保realData结构的兼容性
        if (!enriched.realData) {
            enriched.realData = {
                answers: enriched.answers || {},
                correctAnswers: enriched.correctAnswers || {},
                answerComparison: enriched.answerComparison || {},
                scoreInfo: enriched.scoreInfo || null
            };
        } else {
            // 更新realData以包含新数据
            enriched.realData.correctAnswers = enriched.correctAnswers || enriched.realData.correctAnswers || {};
            enriched.realData.answerComparison = enriched.answerComparison || enriched.realData.answerComparison || {};
        }

        console.log('[DataConsistencyManager] 数据补充完成');
        return enriched;
    }

    /**
     * 标准化答案格式
     */
    standardizeAnswerFormat(answers) {
        const standardized = {};
        
        Object.keys(answers).forEach(key => {
            let normalizedKey = key;
            let value = answers[key];

            // 标准化键名 - 确保以q开头
            if (/^\d+$/.test(normalizedKey)) {
                normalizedKey = 'q' + normalizedKey;
            } else if (normalizedKey.startsWith('question')) {
                normalizedKey = normalizedKey.replace('question', 'q');
            }

            // 标准化值
            if (value !== null && value !== undefined) {
                value = String(value).trim();
                
                // 标准化常见答案格式
                if (value.toLowerCase() === 'true') value = 'TRUE';
                if (value.toLowerCase() === 'false') value = 'FALSE';
                if (value.toLowerCase() === 'not given') value = 'NOT GIVEN';
                
                standardized[normalizedKey] = value;
            }
        });

        return standardized;
    }

    /**
     * 验证答案数据
     */
    validateAnswers(answers) {
        const validation = {
            isValid: true,
            errors: [],
            answerCount: 0,
            emptyAnswers: 0,
            invalidKeys: []
        };

        if (!answers || typeof answers !== 'object') {
            validation.isValid = false;
            validation.errors.push('答案数据不是有效对象');
            return validation;
        }

        Object.keys(answers).forEach(key => {
            validation.answerCount++;
            
            // 检查键名格式
            if (!key.match(/^q\d+$/) && !key.match(/^question\d+$/)) {
                validation.invalidKeys.push(key);
            }
            
            // 检查值
            const value = answers[key];
            if (!value || String(value).trim() === '') {
                validation.emptyAnswers++;
            }
        });

        if (validation.invalidKeys.length > 0) {
            validation.errors.push(`无效的键名格式: ${validation.invalidKeys.join(', ')}`);
        }

        if (validation.emptyAnswers > validation.answerCount * 0.5) {
            validation.isValid = false;
            validation.errors.push('超过50%的答案为空');
        }

        return validation;
    }

    /**
     * 生成答案比较数据
     */
    generateAnswerComparison(userAnswers, correctAnswers) {
        const comparison = {};
        
        // 获取所有问题键
        const allKeys = new Set([
            ...Object.keys(userAnswers || {}),
            ...Object.keys(correctAnswers || {})
        ]);

        allKeys.forEach(key => {
            const userAnswer = userAnswers[key];
            const correctAnswer = correctAnswers[key];
            
            comparison[key] = {
                userAnswer: userAnswer || null,
                correctAnswer: correctAnswer || null,
                isCorrect: this.compareAnswers(userAnswer, correctAnswer)
            };
        });

        return comparison;
    }

    /**
     * 从答案比较计算分数
     */
    calculateScoreFromComparison(answerComparison) {
        let correct = 0;
        let total = 0;

        Object.values(answerComparison).forEach(comparison => {
            if (comparison.userAnswer !== null) {
                total++;
                if (comparison.isCorrect) {
                    correct++;
                }
            }
        });

        const accuracy = total > 0 ? correct / total : 0;
        
        return {
            correct: correct,
            total: total,
            accuracy: accuracy,
            percentage: Math.round(accuracy * 100),
            source: 'comparison_calculation'
        };
    }

    /**
     * 比较两个答案
     */
    compareAnswers(userAnswer, correctAnswer) {
        if (!userAnswer || !correctAnswer) {
            return false;
        }

        // 标准化比较
        const normalize = (str) => String(str).trim().toLowerCase();
        return normalize(userAnswer) === normalize(correctAnswer);
    }

    /**
     * 修复数据不一致问题
     */
    fixDataInconsistencies(records) {
        console.log('[DataConsistencyManager] 开始修复数据不一致问题');
        
        const fixed = records.map(record => {
            const validation = this.validateRecordData(record);
            
            if (!validation.isValid || validation.dataQuality === 'poor') {
                console.log(`[DataConsistencyManager] 修复记录: ${record.id}`);
                return this.enrichRecordData(record);
            }
            
            return record;
        });

        console.log('[DataConsistencyManager] 数据修复完成');
        return fixed;
    }

    /**
     * 确保弹窗和导出数据一致性
     */
    ensureConsistency(record) {
        // 验证数据
        const validation = this.validateRecordData(record);
        
        // 如果数据有问题，进行修复
        if (!validation.isValid || validation.dataQuality !== 'good') {
            return this.enrichRecordData(record);
        }
        
        return record;
    }

    /**
     * 获取数据质量报告
     */
    getDataQualityReport(records) {
        const report = {
            totalRecords: records.length,
            validRecords: 0,
            recordsWithCorrectAnswers: 0,
            recordsWithComparison: 0,
            averageAnswerCount: 0,
            qualityDistribution: {
                good: 0,
                fair: 0,
                poor: 0,
                invalid: 0
            }
        };

        let totalAnswers = 0;

        records.forEach(record => {
            const validation = this.validateRecordData(record);
            
            if (validation.isValid) {
                report.validRecords++;
            }
            
            if (record.correctAnswers && Object.keys(record.correctAnswers).length > 0) {
                report.recordsWithCorrectAnswers++;
            }
            
            if (record.answerComparison) {
                report.recordsWithComparison++;
            }
            
            if (record.answers) {
                totalAnswers += Object.keys(record.answers).length;
            }
            
            report.qualityDistribution[validation.dataQuality]++;
        });

        report.averageAnswerCount = records.length > 0 ? totalAnswers / records.length : 0;

        console.log('[DataConsistencyManager] 数据质量报告:', report);
        return report;
    }
}

// 导出类
window.DataConsistencyManager = DataConsistencyManager;