/**
 * 薄弱环节识别算法
 * 负责错误模式识别、分类和生成针对性改进建议
 */
class WeaknessAnalyzer {
    constructor() {
        this.errorPatterns = new Map();
        this.weaknessThresholds = {
            accuracy: 0.7,        // 准确率低于70%视为薄弱
            consistency: 0.6,     // 一致性低于60%视为不稳定
            improvement: -0.05,   // 负增长超过5%视为退步
            frequency: 3          // 连续3次错误视为模式
        };
        
        this.initialize();
    }

    /**
     * 初始化薄弱环节分析器
     */
    initialize() {
        console.log('WeaknessAnalyzer initialized');
        
        // 初始化错误模式库
        this.initializeErrorPatterns();
    }

    /**
     * 初始化错误模式库
     */
    initializeErrorPatterns() {
        // 题型相关错误模式
        this.errorPatterns.set('heading-matching', {
            patterns: [
                {
                    id: 'keyword_misunderstanding',
                    name: '关键词理解错误',
                    description: '未能正确理解段落关键词含义',
                    indicators: ['consecutive_errors', 'similar_content_errors'],
                    suggestions: ['加强词汇理解', '练习关键词识别', '提高阅读理解能力']
                },
                {
                    id: 'structure_confusion',
                    name: '文章结构混淆',
                    description: '对文章整体结构把握不准确',
                    indicators: ['random_errors', 'time_pressure_errors'],
                    suggestions: ['练习文章结构分析', '提高逻辑思维能力', '加强段落主旨理解']
                }
            ]
        });

        this.errorPatterns.set('true-false-not-given', {
            patterns: [
                {
                    id: 'not_given_confusion',
                    name: 'Not Given判断困难',
                    description: '难以区分False和Not Given',
                    indicators: ['false_not_given_errors', 'overthinking'],
                    suggestions: ['明确判断标准', '练习逻辑推理', '避免过度解读']
                },
                {
                    id: 'detail_oversight',
                    name: '细节遗漏',
                    description: '忽略文中重要细节信息',
                    indicators: ['detail_errors', 'speed_errors'],
                    suggestions: ['提高细节注意力', '放慢阅读速度', '加强信息定位能力']
                }
            ]
        });

        this.errorPatterns.set('multiple-choice', {
            patterns: [
                {
                    id: 'distractor_attraction',
                    name: '干扰项吸引',
                    description: '容易被干扰选项误导',
                    indicators: ['consistent_wrong_choices', 'similar_errors'],
                    suggestions: ['提高批判性思维', '学习排除法', '加强选项分析能力']
                },
                {
                    id: 'time_pressure',
                    name: '时间压力影响',
                    description: '在时间压力下容易出错',
                    indicators: ['late_question_errors', 'rushed_answers'],
                    suggestions: ['提高阅读速度', '优化时间分配', '练习快速决策']
                }
            ]
        });
    }

    /**
     * 分析用户薄弱环节
     */
    analyzeWeaknesses(records, options = {}) {
        if (!records || records.length === 0) {
            return this.getEmptyWeaknessAnalysis();
        }

        const analysis = {
            overallWeaknesses: this.identifyOverallWeaknesses(records),
            categoryWeaknesses: this.identifyCategoryWeaknesses(records),
            questionTypeWeaknesses: this.identifyQuestionTypeWeaknesses(records),
            errorPatterns: this.identifyErrorPatterns(records),
            consistencyIssues: this.identifyConsistencyIssues(records),
            improvementAreas: this.identifyImprovementAreas(records),
            recommendations: []
        };

        // 生成综合建议
        analysis.recommendations = this.generateRecommendations(analysis);

        return analysis;
    }

    /**
     * 获取空的薄弱环节分析
     */
    getEmptyWeaknessAnalysis() {
        return {
            overallWeaknesses: [],
            categoryWeaknesses: {},
            questionTypeWeaknesses: {},
            errorPatterns: [],
            consistencyIssues: [],
            improvementAreas: [],
            recommendations: []
        };
    }

    /**
     * 识别整体薄弱环节
     */
    identifyOverallWeaknesses(records) {
        const weaknesses = [];
        const completedRecords = records.filter(r => r.status === 'completed');
        
        if (completedRecords.length === 0) return weaknesses;

        // 计算整体统计
        const totalAccuracy = completedRecords.reduce((sum, r) => sum + (r.accuracy || 0), 0) / completedRecords.length;
        const recentRecords = completedRecords.slice(-10); // 最近10次
        const recentAccuracy = recentRecords.reduce((sum, r) => sum + (r.accuracy || 0), 0) / recentRecords.length;

        // 整体准确率偏低
        if (totalAccuracy < this.weaknessThresholds.accuracy) {
            weaknesses.push({
                type: 'low_overall_accuracy',
                severity: this.calculateSeverity(totalAccuracy, this.weaknessThresholds.accuracy),
                description: `整体准确率偏低 (${Math.round(totalAccuracy * 100)}%)`,
                value: totalAccuracy,
                threshold: this.weaknessThresholds.accuracy,
                impact: 'high',
                suggestions: [
                    '加强基础知识学习',
                    '提高阅读理解能力',
                    '增加练习频率',
                    '分析错误原因'
                ]
            });
        }

        // 最近表现下降
        if (recentAccuracy < totalAccuracy - 0.1) {
            weaknesses.push({
                type: 'recent_decline',
                severity: this.calculateSeverity(recentAccuracy - totalAccuracy, -0.1),
                description: `最近表现有所下降`,
                value: recentAccuracy - totalAccuracy,
                threshold: -0.1,
                impact: 'medium',
                suggestions: [
                    '检查学习方法',
                    '调整练习策略',
                    '注意休息和状态',
                    '重新复习基础知识'
                ]
            });
        }

        // 练习频率不足
        const daysSinceFirst = (new Date() - new Date(completedRecords[0].startTime)) / (1000 * 60 * 60 * 24);
        const practiceFrequency = completedRecords.length / daysSinceFirst;
        
        if (practiceFrequency < 0.5) { // 少于每两天一次
            weaknesses.push({
                type: 'low_practice_frequency',
                severity: 'medium',
                description: `练习频率偏低 (${Math.round(practiceFrequency * 7 * 10) / 10}次/周)`,
                value: practiceFrequency,
                threshold: 0.5,
                impact: 'medium',
                suggestions: [
                    '制定规律的练习计划',
                    '设置练习提醒',
                    '增加练习频率',
                    '保持学习连续性'
                ]
            });
        }

        // 时间效率问题
        const avgTimePerQuestion = completedRecords.reduce((sum, r) => {
            const questions = r.totalQuestions || 1;
            return sum + (r.duration || 0) / questions;
        }, 0) / completedRecords.length;

        if (avgTimePerQuestion > 90) { // 超过1.5分钟每题
            weaknesses.push({
                type: 'time_efficiency',
                severity: this.calculateSeverity(avgTimePerQuestion, 90),
                description: `答题速度偏慢 (${Math.round(avgTimePerQuestion)}秒/题)`,
                value: avgTimePerQuestion,
                threshold: 90,
                impact: 'medium',
                suggestions: [
                    '提高阅读速度',
                    '练习快速定位',
                    '优化答题策略',
                    '加强时间管理'
                ]
            });
        }

        return weaknesses.sort((a, b) => this.getSeverityScore(b.severity) - this.getSeverityScore(a.severity));
    }

    /**
     * 识别分类薄弱环节
     */
    identifyCategoryWeaknesses(records) {
        const categoryWeaknesses = {};
        const categoryStats = this.calculateCategoryStats(records);

        Object.entries(categoryStats).forEach(([category, stats]) => {
            const weaknesses = [];

            // 准确率偏低
            if (stats.averageAccuracy < this.weaknessThresholds.accuracy) {
                weaknesses.push({
                    type: 'low_accuracy',
                    severity: this.calculateSeverity(stats.averageAccuracy, this.weaknessThresholds.accuracy),
                    description: `${category}类别准确率偏低`,
                    value: stats.averageAccuracy,
                    suggestions: [`加强${category}类别专项练习`, '分析错误模式', '重点复习相关知识点']
                });
            }

            // 表现不稳定
            if (stats.consistency < this.weaknessThresholds.consistency) {
                weaknesses.push({
                    type: 'inconsistent_performance',
                    severity: this.calculateSeverity(stats.consistency, this.weaknessThresholds.consistency),
                    description: `${category}类别表现不稳定`,
                    value: stats.consistency,
                    suggestions: [`稳定${category}练习节奏`, '建立答题模式', '加强基础训练']
                });
            }

            // 进步缓慢或退步
            if (stats.improvementTrend < this.weaknessThresholds.improvement) {
                weaknesses.push({
                    type: 'slow_improvement',
                    severity: this.calculateSeverity(stats.improvementTrend, this.weaknessThresholds.improvement),
                    description: `${category}类别进步缓慢`,
                    value: stats.improvementTrend,
                    suggestions: [`调整${category}学习方法`, '寻找新的练习资源', '请教专业指导']
                });
            }

            if (weaknesses.length > 0) {
                categoryWeaknesses[category] = {
                    category,
                    stats,
                    weaknesses: weaknesses.sort((a, b) => this.getSeverityScore(b.severity) - this.getSeverityScore(a.severity))
                };
            }
        });

        return categoryWeaknesses;
    }

    /**
     * 识别题型薄弱环节
     */
    identifyQuestionTypeWeaknesses(records) {
        const questionTypeWeaknesses = {};
        const questionTypeStats = this.calculateQuestionTypeStats(records);

        Object.entries(questionTypeStats).forEach(([questionType, stats]) => {
            const weaknesses = [];
            const patterns = this.errorPatterns.get(questionType);

            // 准确率偏低
            if (stats.averageAccuracy < this.weaknessThresholds.accuracy) {
                weaknesses.push({
                    type: 'low_accuracy',
                    severity: this.calculateSeverity(stats.averageAccuracy, this.weaknessThresholds.accuracy),
                    description: `${this.getQuestionTypeLabel(questionType)}准确率偏低`,
                    value: stats.averageAccuracy,
                    suggestions: patterns ? patterns.patterns[0].suggestions : ['加强专项练习']
                });
            }

            // 时间效率问题
            if (stats.averageTimePerQuestion > 120) { // 超过2分钟
                weaknesses.push({
                    type: 'time_inefficiency',
                    severity: this.calculateSeverity(stats.averageTimePerQuestion, 120),
                    description: `${this.getQuestionTypeLabel(questionType)}用时过长`,
                    value: stats.averageTimePerQuestion,
                    suggestions: ['提高解题速度', '优化答题策略', '加强技巧训练']
                });
            }

            // 错误模式识别
            const errorPatternAnalysis = this.analyzeQuestionTypeErrorPatterns(records, questionType);
            if (errorPatternAnalysis.length > 0) {
                weaknesses.push(...errorPatternAnalysis);
            }

            if (weaknesses.length > 0) {
                questionTypeWeaknesses[questionType] = {
                    questionType,
                    label: this.getQuestionTypeLabel(questionType),
                    stats,
                    weaknesses: weaknesses.sort((a, b) => this.getSeverityScore(b.severity) - this.getSeverityScore(a.severity))
                };
            }
        });

        return questionTypeWeaknesses;
    }

    /**
     * 识别错误模式
     */
    identifyErrorPatterns(records) {
        const errorPatterns = [];
        const completedRecords = records.filter(r => r.status === 'completed' && r.answers);

        // 连续错误模式
        const consecutiveErrors = this.findConsecutiveErrors(completedRecords);
        if (consecutiveErrors.length > 0) {
            errorPatterns.push({
                type: 'consecutive_errors',
                pattern: 'consecutive',
                description: '存在连续错误模式',
                occurrences: consecutiveErrors.length,
                severity: consecutiveErrors.length > 5 ? 'high' : 'medium',
                details: consecutiveErrors,
                suggestions: [
                    '分析连续错误的共同原因',
                    '调整答题节奏',
                    '加强相关知识点复习',
                    '提高注意力集中度'
                ]
            });
        }

        // 重复错误模式
        const repeatedErrors = this.findRepeatedErrors(completedRecords);
        if (repeatedErrors.length > 0) {
            errorPatterns.push({
                type: 'repeated_errors',
                pattern: 'repeated',
                description: '存在重复错误模式',
                occurrences: repeatedErrors.length,
                severity: repeatedErrors.length > 3 ? 'high' : 'medium',
                details: repeatedErrors,
                suggestions: [
                    '深入分析重复错误原因',
                    '建立错误记录本',
                    '针对性强化练习',
                    '寻求专业指导'
                ]
            });
        }

        // 时间压力错误模式
        const timePressureErrors = this.findTimePressureErrors(completedRecords);
        if (timePressureErrors.length > 0) {
            errorPatterns.push({
                type: 'time_pressure_errors',
                pattern: 'time_related',
                description: '时间压力下容易出错',
                occurrences: timePressureErrors.length,
                severity: 'medium',
                details: timePressureErrors,
                suggestions: [
                    '提高阅读速度',
                    '优化时间分配策略',
                    '练习在压力下保持准确性',
                    '加强时间管理技能'
                ]
            });
        }

        return errorPatterns.sort((a, b) => this.getSeverityScore(b.severity) - this.getSeverityScore(a.severity));
    }

    /**
     * 识别一致性问题
     */
    identifyConsistencyIssues(records) {
        const issues = [];
        const completedRecords = records.filter(r => r.status === 'completed');
        
        if (completedRecords.length < 5) return issues;

        // 分析分数波动
        const scores = completedRecords.map(r => r.accuracy || 0);
        const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
        const variance = scores.reduce((sum, score) => sum + Math.pow(score - avgScore, 2), 0) / scores.length;
        const standardDeviation = Math.sqrt(variance);

        if (standardDeviation > 0.2) { // 标准差超过20%
            issues.push({
                type: 'high_score_variance',
                severity: this.calculateSeverity(standardDeviation, 0.2),
                description: '成绩波动较大',
                value: standardDeviation,
                impact: 'medium',
                suggestions: [
                    '保持稳定的学习状态',
                    '建立规律的练习习惯',
                    '注意休息和心理调节',
                    '分析高分和低分的原因'
                ]
            });
        }

        // 分析时间一致性
        const durations = completedRecords.map(r => r.duration || 0);
        const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
        const durationVariance = durations.reduce((sum, duration) => sum + Math.pow(duration - avgDuration, 2), 0) / durations.length;
        const durationStdDev = Math.sqrt(durationVariance);

        if (durationStdDev > avgDuration * 0.3) { // 时间标准差超过平均值的30%
            issues.push({
                type: 'inconsistent_timing',
                severity: 'medium',
                description: '答题时间不稳定',
                value: durationStdDev / avgDuration,
                impact: 'low',
                suggestions: [
                    '建立稳定的答题节奏',
                    '练习时间控制',
                    '避免过度思考或匆忙作答',
                    '制定时间分配策略'
                ]
            });
        }

        return issues.sort((a, b) => this.getSeverityScore(b.severity) - this.getSeverityScore(a.severity));
    }

    /**
     * 识别改进领域
     */
    identifyImprovementAreas(records) {
        const areas = [];
        const completedRecords = records.filter(r => r.status === 'completed');
        
        if (completedRecords.length < 3) return areas;

        // 分析各个维度的改进潜力
        const dimensions = [
            {
                name: '准确率',
                key: 'accuracy',
                current: completedRecords.reduce((sum, r) => sum + (r.accuracy || 0), 0) / completedRecords.length,
                target: 0.85,
                priority: 'high'
            },
            {
                name: '答题速度',
                key: 'speed',
                current: completedRecords.reduce((sum, r) => {
                    const questions = r.totalQuestions || 1;
                    return sum + (r.duration || 0) / questions;
                }, 0) / completedRecords.length,
                target: 60, // 1分钟每题
                priority: 'medium',
                inverse: true // 越小越好
            },
            {
                name: '稳定性',
                key: 'consistency',
                current: this.calculateConsistency(completedRecords),
                target: 0.8,
                priority: 'medium'
            }
        ];

        dimensions.forEach(dimension => {
            const gap = dimension.inverse 
                ? (dimension.current - dimension.target) / dimension.target
                : (dimension.target - dimension.current) / dimension.target;

            if (gap > 0.1) { // 差距超过10%
                areas.push({
                    dimension: dimension.name,
                    key: dimension.key,
                    current: dimension.current,
                    target: dimension.target,
                    gap: gap,
                    priority: dimension.priority,
                    improvementPotential: Math.min(gap, 1),
                    suggestions: this.getImprovementSuggestions(dimension.key)
                });
            }
        });

        return areas.sort((a, b) => {
            const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1 };
            return (priorityOrder[b.priority] - priorityOrder[a.priority]) || (b.gap - a.gap);
        });
    }

    /**
     * 生成综合建议
     */
    generateRecommendations(analysis) {
        const recommendations = [];

        // 基于整体薄弱环节的建议
        analysis.overallWeaknesses.forEach(weakness => {
            recommendations.push({
                type: 'overall',
                priority: weakness.severity,
                title: `改善${weakness.description}`,
                suggestions: weakness.suggestions,
                targetArea: weakness.type
            });
        });

        // 基于错误模式的建议
        analysis.errorPatterns.forEach(pattern => {
            recommendations.push({
                type: 'pattern',
                priority: pattern.severity,
                title: `解决${pattern.description}`,
                suggestions: pattern.suggestions,
                targetArea: pattern.type
            });
        });

        // 基于改进领域的建议
        analysis.improvementAreas.slice(0, 3).forEach(area => { // 只取前3个
            recommendations.push({
                type: 'improvement',
                priority: area.priority,
                title: `提升${area.dimension}`,
                suggestions: area.suggestions,
                targetArea: area.key,
                currentValue: area.current,
                targetValue: area.target
            });
        });

        // 去重并按优先级排序
        const uniqueRecommendations = this.deduplicateRecommendations(recommendations);
        return uniqueRecommendations.sort((a, b) => this.getSeverityScore(b.priority) - this.getSeverityScore(a.priority));
    }

    /**
     * 计算分类统计
     */
    calculateCategoryStats(records) {
        const categoryStats = {};
        const completedRecords = records.filter(r => r.status === 'completed');

        completedRecords.forEach(record => {
            const category = record.metadata?.category;
            if (!category) return;

            if (!categoryStats[category]) {
                categoryStats[category] = {
                    practices: 0,
                    accuracies: [],
                    totalAccuracy: 0,
                    averageAccuracy: 0,
                    consistency: 0,
                    improvementTrend: 0
                };
            }

            const stats = categoryStats[category];
            stats.practices++;
            stats.accuracies.push(record.accuracy || 0);
            stats.totalAccuracy += record.accuracy || 0;
        });

        // 计算派生指标
        Object.values(categoryStats).forEach(stats => {
            stats.averageAccuracy = stats.totalAccuracy / stats.practices;
            stats.consistency = this.calculateConsistency(stats.accuracies);
            stats.improvementTrend = this.calculateImprovementTrend(stats.accuracies);
        });

        return categoryStats;
    }

    /**
     * 计算题型统计
     */
    calculateQuestionTypeStats(records) {
        const questionTypeStats = {};
        const completedRecords = records.filter(r => r.status === 'completed' && r.questionTypePerformance);

        completedRecords.forEach(record => {
            Object.entries(record.questionTypePerformance).forEach(([type, performance]) => {
                if (!questionTypeStats[type]) {
                    questionTypeStats[type] = {
                        practices: 0,
                        totalQuestions: 0,
                        totalCorrect: 0,
                        totalTime: 0,
                        accuracies: [],
                        times: []
                    };
                }

                const stats = questionTypeStats[type];
                stats.practices++;
                stats.totalQuestions += performance.total || 0;
                stats.totalCorrect += performance.correct || 0;
                stats.totalTime += performance.timeSpent || 0;

                const accuracy = (performance.total > 0) ? (performance.correct / performance.total) : 0;
                stats.accuracies.push(accuracy);

                if (performance.timeSpent && performance.total) {
                    stats.times.push(performance.timeSpent / performance.total);
                }
            });
        });

        // 计算派生指标
        Object.values(questionTypeStats).forEach(stats => {
            stats.averageAccuracy = stats.totalQuestions > 0 ? stats.totalCorrect / stats.totalQuestions : 0;
            stats.averageTimePerQuestion = stats.totalQuestions > 0 ? stats.totalTime / stats.totalQuestions : 0;
            stats.consistency = this.calculateConsistency(stats.accuracies);
            stats.improvementTrend = this.calculateImprovementTrend(stats.accuracies);
        });

        return questionTypeStats;
    }

    /**
     * 分析题型错误模式
     */
    analyzeQuestionTypeErrorPatterns(records, questionType) {
        const patterns = [];
        const typeRecords = records.filter(r => 
            r.status === 'completed' && 
            r.questionTypePerformance && 
            r.questionTypePerformance[questionType]
        );

        if (typeRecords.length < 3) return patterns;

        // 分析准确率趋势
        const accuracies = typeRecords.map(r => {
            const perf = r.questionTypePerformance[questionType];
            return perf.total > 0 ? perf.correct / perf.total : 0;
        });

        const trend = this.calculateImprovementTrend(accuracies);
        if (trend < -0.05) { // 下降趋势
            patterns.push({
                type: 'declining_performance',
                severity: 'medium',
                description: `${this.getQuestionTypeLabel(questionType)}表现呈下降趋势`,
                value: trend,
                suggestions: ['重新学习解题技巧', '加强基础练习', '寻找新的学习方法']
            });
        }

        return patterns;
    }

    /**
     * 查找连续错误
     */
    findConsecutiveErrors(records) {
        const consecutiveErrors = [];
        
        records.forEach(record => {
            if (!record.answers) return;
            
            let consecutiveCount = 0;
            let startIndex = -1;
            
            record.answers.forEach((answer, index) => {
                if (!answer.correct) {
                    if (consecutiveCount === 0) {
                        startIndex = index;
                    }
                    consecutiveCount++;
                } else {
                    if (consecutiveCount >= this.weaknessThresholds.frequency) {
                        consecutiveErrors.push({
                            examId: record.examId,
                            startIndex,
                            count: consecutiveCount,
                            date: record.startTime
                        });
                    }
                    consecutiveCount = 0;
                }
            });
            
            // 检查结尾的连续错误
            if (consecutiveCount >= this.weaknessThresholds.frequency) {
                consecutiveErrors.push({
                    examId: record.examId,
                    startIndex,
                    count: consecutiveCount,
                    date: record.startTime
                });
            }
        });
        
        return consecutiveErrors;
    }

    /**
     * 查找重复错误
     */
    findRepeatedErrors(records) {
        const errorMap = new Map();
        const repeatedErrors = [];
        
        records.forEach(record => {
            if (!record.answers) return;
            
            record.answers.forEach(answer => {
                if (!answer.correct) {
                    const key = `${answer.questionType}_${answer.questionId}`;
                    if (!errorMap.has(key)) {
                        errorMap.set(key, []);
                    }
                    errorMap.get(key).push({
                        examId: record.examId,
                        date: record.startTime,
                        answer: answer.answer
                    });
                }
            });
        });
        
        errorMap.forEach((occurrences, key) => {
            if (occurrences.length >= this.weaknessThresholds.frequency) {
                repeatedErrors.push({
                    pattern: key,
                    count: occurrences.length,
                    occurrences
                });
            }
        });
        
        return repeatedErrors;
    }

    /**
     * 查找时间压力错误
     */
    findTimePressureErrors(records) {
        const timePressureErrors = [];
        
        records.forEach(record => {
            if (!record.answers || !record.duration) return;
            
            const avgTimePerQuestion = record.duration / record.answers.length;
            const fastAnswers = record.answers.filter(answer => 
                answer.timeSpent && answer.timeSpent < avgTimePerQuestion * 0.5
            );
            
            const fastErrorRate = fastAnswers.filter(answer => !answer.correct).length / fastAnswers.length;
            
            if (fastErrorRate > 0.6 && fastAnswers.length >= 3) { // 快速回答错误率超过60%
                timePressureErrors.push({
                    examId: record.examId,
                    date: record.startTime,
                    fastAnswers: fastAnswers.length,
                    fastErrors: fastAnswers.filter(a => !a.correct).length,
                    errorRate: fastErrorRate
                });
            }
        });
        
        return timePressureErrors;
    }

    /**
     * 计算一致性
     */
    calculateConsistency(values) {
        if (values.length < 2) return 1;
        
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length;
        const stdDev = Math.sqrt(variance);
        
        return Math.max(0, 1 - stdDev); // 标准差越小，一致性越高
    }

    /**
     * 计算改进趋势
     */
    calculateImprovementTrend(values) {
        if (values.length < 2) return 0;
        
        const n = values.length;
        const x = Array.from({ length: n }, (_, i) => i);
        const y = values;
        
        const sumX = x.reduce((a, b) => a + b, 0);
        const sumY = y.reduce((a, b) => a + b, 0);
        const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
        const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        return slope;
    }

    /**
     * 计算严重程度
     */
    calculateSeverity(value, threshold) {
        const ratio = Math.abs(value - threshold) / threshold;
        
        if (ratio > 0.5) return 'high';
        if (ratio > 0.2) return 'medium';
        return 'low';
    }

    /**
     * 获取严重程度分数
     */
    getSeverityScore(severity) {
        const scores = { 'high': 3, 'medium': 2, 'low': 1 };
        return scores[severity] || 0;
    }

    /**
     * 获取题型标签
     */
    getQuestionTypeLabel(type) {
        const labels = {
            'heading-matching': '段落标题匹配',
            'country-matching': '信息匹配',
            'true-false-not-given': '判断题',
            'multiple-choice': '选择题',
            'gap-filling': '填空题',
            'summary-completion': '摘要填空'
        };
        return labels[type] || type;
    }

    /**
     * 获取改进建议
     */
    getImprovementSuggestions(key) {
        const suggestions = {
            'accuracy': [
                '加强基础知识学习',
                '提高阅读理解能力',
                '练习解题技巧',
                '分析错误原因'
            ],
            'speed': [
                '提高阅读速度',
                '练习快速定位',
                '优化答题策略',
                '加强时间管理'
            ],
            'consistency': [
                '保持稳定的学习状态',
                '建立规律的练习习惯',
                '注意休息和心理调节',
                '制定标准化答题流程'
            ]
        };
        return suggestions[key] || ['加强相关练习'];
    }

    /**
     * 去重建议
     */
    deduplicateRecommendations(recommendations) {
        const seen = new Set();
        return recommendations.filter(rec => {
            const key = `${rec.type}_${rec.title}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
}

// 确保全局可用
window.WeaknessAnalyzer = WeaknessAnalyzer;