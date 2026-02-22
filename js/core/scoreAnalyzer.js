/**
 * 成绩统计分析引擎
 * 负责计算正确率、平均用时等基础指标，分析题型表现和学习趋势
 */
class ScoreAnalyzer {
    constructor() {
        this.analysisCache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5分钟缓存
        
        this.initialize();
    }

    /**
     * 初始化分析引擎
     */
    initialize() {
        console.log('ScoreAnalyzer initialized');
        
        // 清理过期缓存
        this.setupCacheCleanup();
    }

    /**
     * 设置缓存清理
     */
    setupCacheCleanup() {
        setInterval(() => {
            this.cleanExpiredCache();
        }, this.cacheTimeout);
    }

    /**
     * 清理过期缓存
     */
    cleanExpiredCache() {
        const now = Date.now();
        for (const [key, data] of this.analysisCache.entries()) {
            if (now - data.timestamp > this.cacheTimeout) {
                this.analysisCache.delete(key);
            }
        }
    }

    /**
     * 获取缓存的分析结果
     */
    getCachedAnalysis(cacheKey) {
        const cached = this.analysisCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
            return cached.data;
        }
        return null;
    }

    /**
     * 设置缓存
     */
    setCachedAnalysis(cacheKey, data) {
        this.analysisCache.set(cacheKey, {
            data,
            timestamp: Date.now()
        });
    }

    /**
     * 计算基础统计指标
     */
    calculateBasicStats(records) {
        if (!records || records.length === 0) {
            return this.getEmptyBasicStats();
        }

        const cacheKey = `basic_stats_${records.length}_${records[0]?.id}`;
        const cached = this.getCachedAnalysis(cacheKey);
        if (cached) return cached;

        const stats = {
            totalPractices: records.length,
            totalTimeSpent: 0,
            averageScore: 0,
            averageAccuracy: 0,
            averageTimePerPractice: 0,
            averageTimePerQuestion: 0,
            totalQuestions: 0,
            totalCorrectAnswers: 0,
            bestScore: 0,
            worstScore: 1,
            scoreVariance: 0,
            completionRate: 0,
            improvementTrend: 0
        };

        let totalScore = 0;
        let totalQuestions = 0;
        let totalCorrectAnswers = 0;
        let completedPractices = 0;
        const scores = [];

        records.forEach(record => {
            if (record.status === 'completed') {
                completedPractices++;
                
                // 累计时间
                stats.totalTimeSpent += record.duration || 0;
                
                // 累计分数和准确率
                const accuracy = record.accuracy || 0;
                totalScore += accuracy;
                scores.push(accuracy);
                
                // 累计题目数据
                totalQuestions += record.totalQuestions || 0;
                totalCorrectAnswers += record.correctAnswers || 0;
                
                // 最佳和最差分数
                stats.bestScore = Math.max(stats.bestScore, accuracy);
                stats.worstScore = Math.min(stats.worstScore, accuracy);
            }
        });

        if (completedPractices > 0) {
            stats.averageScore = totalScore / completedPractices;
            stats.averageAccuracy = totalCorrectAnswers / totalQuestions;
            stats.averageTimePerPractice = stats.totalTimeSpent / completedPractices;
            stats.completionRate = completedPractices / records.length;
            
            if (totalQuestions > 0) {
                stats.averageTimePerQuestion = stats.totalTimeSpent / totalQuestions;
            }
            
            // 计算分数方差
            if (scores.length > 1) {
                const variance = scores.reduce((sum, score) => {
                    return sum + Math.pow(score - stats.averageScore, 2);
                }, 0) / scores.length;
                stats.scoreVariance = Math.sqrt(variance);
            }
            
            // 计算改进趋势
            stats.improvementTrend = this.calculateImprovementTrend(scores);
        }

        stats.totalQuestions = totalQuestions;
        stats.totalCorrectAnswers = totalCorrectAnswers;

        this.setCachedAnalysis(cacheKey, stats);
        return stats;
    }

    /**
     * 获取空的基础统计
     */
    getEmptyBasicStats() {
        return {
            totalPractices: 0,
            totalTimeSpent: 0,
            averageScore: 0,
            averageAccuracy: 0,
            averageTimePerPractice: 0,
            averageTimePerQuestion: 0,
            totalQuestions: 0,
            totalCorrectAnswers: 0,
            bestScore: 0,
            worstScore: 0,
            scoreVariance: 0,
            completionRate: 0,
            improvementTrend: 0
        };
    }

    /**
     * 计算改进趋势
     */
    calculateImprovementTrend(scores) {
        if (scores.length < 2) return 0;
        
        // 使用线性回归计算趋势
        const n = scores.length;
        const x = Array.from({ length: n }, (_, i) => i);
        const y = scores;
        
        const sumX = x.reduce((a, b) => a + b, 0);
        const sumY = y.reduce((a, b) => a + b, 0);
        const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
        const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        
        return slope; // 正值表示上升趋势，负值表示下降趋势
    }

    /**
     * 分析分类表现
     */
    analyzeCategoryPerformance(records) {
        if (!records || records.length === 0) {
            return {};
        }

        const cacheKey = `category_performance_${records.length}`;
        const cached = this.getCachedAnalysis(cacheKey);
        if (cached) return cached;

        const categoryStats = {};

        records.forEach(record => {
            if (record.status !== 'completed') return;
            
            const category = record.metadata?.category;
            if (!category) return;

            if (!categoryStats[category]) {
                categoryStats[category] = {
                    practices: 0,
                    totalTimeSpent: 0,
                    totalScore: 0,
                    totalQuestions: 0,
                    totalCorrectAnswers: 0,
                    bestScore: 0,
                    worstScore: 1,
                    scores: [],
                    recentScores: []
                };
            }

            const stats = categoryStats[category];
            stats.practices++;
            stats.totalTimeSpent += record.duration || 0;
            stats.totalScore += record.accuracy || 0;
            stats.totalQuestions += record.totalQuestions || 0;
            stats.totalCorrectAnswers += record.correctAnswers || 0;
            stats.bestScore = Math.max(stats.bestScore, record.accuracy || 0);
            stats.worstScore = Math.min(stats.worstScore, record.accuracy || 0);
            stats.scores.push(record.accuracy || 0);
            
            // 保留最近10次成绩
            stats.recentScores.push(record.accuracy || 0);
            if (stats.recentScores.length > 10) {
                stats.recentScores.shift();
            }
        });

        // 计算派生指标
        Object.values(categoryStats).forEach(stats => {
            stats.averageScore = stats.totalScore / stats.practices;
            stats.averageAccuracy = stats.totalQuestions > 0 
                ? stats.totalCorrectAnswers / stats.totalQuestions 
                : 0;
            stats.averageTimePerPractice = stats.totalTimeSpent / stats.practices;
            stats.averageTimePerQuestion = stats.totalQuestions > 0 
                ? stats.totalTimeSpent / stats.totalQuestions 
                : 0;
            
            // 计算改进趋势
            stats.improvementTrend = this.calculateImprovementTrend(stats.scores);
            
            // 计算最近表现
            if (stats.recentScores.length > 0) {
                stats.recentAverageScore = stats.recentScores.reduce((a, b) => a + b, 0) / stats.recentScores.length;
                stats.recentImprovementTrend = this.calculateImprovementTrend(stats.recentScores);
            }
            
            // 计算稳定性（标准差）
            if (stats.scores.length > 1) {
                const variance = stats.scores.reduce((sum, score) => {
                    return sum + Math.pow(score - stats.averageScore, 2);
                }, 0) / stats.scores.length;
                stats.stability = 1 - Math.sqrt(variance); // 越接近1越稳定
            } else {
                stats.stability = 1;
            }
        });

        this.setCachedAnalysis(cacheKey, categoryStats);
        return categoryStats;
    }

    /**
     * 分析题型表现
     */
    analyzeQuestionTypePerformance(records) {
        if (!records || records.length === 0) {
            return {};
        }

        const cacheKey = `question_type_performance_${records.length}`;
        const cached = this.getCachedAnalysis(cacheKey);
        if (cached) return cached;

        const questionTypeStats = {};

        records.forEach(record => {
            if (record.status !== 'completed' || !record.questionTypePerformance) return;

            Object.entries(record.questionTypePerformance).forEach(([type, performance]) => {
                if (!questionTypeStats[type]) {
                    questionTypeStats[type] = {
                        practices: 0,
                        totalQuestions: 0,
                        totalCorrectAnswers: 0,
                        totalTimeSpent: 0,
                        accuracyHistory: [],
                        timeHistory: [],
                        bestAccuracy: 0,
                        worstAccuracy: 1
                    };
                }

                const stats = questionTypeStats[type];
                stats.practices++;
                stats.totalQuestions += performance.total || 0;
                stats.totalCorrectAnswers += performance.correct || 0;
                stats.totalTimeSpent += performance.timeSpent || 0;

                const accuracy = (performance.total > 0) 
                    ? (performance.correct / performance.total) 
                    : 0;
                
                stats.accuracyHistory.push(accuracy);
                stats.bestAccuracy = Math.max(stats.bestAccuracy, accuracy);
                stats.worstAccuracy = Math.min(stats.worstAccuracy, accuracy);

                if (performance.timeSpent && performance.total) {
                    const avgTimePerQuestion = performance.timeSpent / performance.total;
                    stats.timeHistory.push(avgTimePerQuestion);
                }
            });
        });

        // 计算派生指标
        Object.values(questionTypeStats).forEach(stats => {
            stats.overallAccuracy = stats.totalQuestions > 0 
                ? stats.totalCorrectAnswers / stats.totalQuestions 
                : 0;
            
            stats.averageTimePerQuestion = stats.totalQuestions > 0 
                ? stats.totalTimeSpent / stats.totalQuestions 
                : 0;
            
            // 计算准确率趋势
            stats.accuracyTrend = this.calculateImprovementTrend(stats.accuracyHistory);
            
            // 计算时间效率趋势（负值表示越来越快）
            stats.timeTrend = this.calculateImprovementTrend(stats.timeHistory);
            
            // 计算最近表现
            if (stats.accuracyHistory.length > 0) {
                const recentAccuracy = stats.accuracyHistory.slice(-5); // 最近5次
                stats.recentAccuracy = recentAccuracy.reduce((a, b) => a + b, 0) / recentAccuracy.length;
            }
            
            if (stats.timeHistory.length > 0) {
                const recentTime = stats.timeHistory.slice(-5);
                stats.recentAverageTime = recentTime.reduce((a, b) => a + b, 0) / recentTime.length;
            }
            
            // 计算稳定性
            if (stats.accuracyHistory.length > 1) {
                const avgAccuracy = stats.accuracyHistory.reduce((a, b) => a + b, 0) / stats.accuracyHistory.length;
                const variance = stats.accuracyHistory.reduce((sum, acc) => {
                    return sum + Math.pow(acc - avgAccuracy, 2);
                }, 0) / stats.accuracyHistory.length;
                stats.stability = 1 - Math.sqrt(variance);
            } else {
                stats.stability = 1;
            }
        });

        this.setCachedAnalysis(cacheKey, questionTypeStats);
        return questionTypeStats;
    }

    /**
     * 生成学习趋势分析
     */
    analyzeLearningTrends(records, timeRange = 30) {
        if (!records || records.length === 0) {
            return this.getEmptyTrendAnalysis();
        }

        const cacheKey = `learning_trends_${records.length}_${timeRange}`;
        const cached = this.getCachedAnalysis(cacheKey);
        if (cached) return cached;

        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - timeRange * 24 * 60 * 60 * 1000);

        // 筛选时间范围内的记录
        const filteredRecords = records.filter(record => {
            const recordDate = new Date(record.startTime);
            return recordDate >= startDate && recordDate <= endDate && record.status === 'completed';
        });

        if (filteredRecords.length === 0) {
            return this.getEmptyTrendAnalysis();
        }

        // 按日期分组
        const dailyStats = this.groupRecordsByDate(filteredRecords);
        
        // 计算趋势指标
        const trends = {
            timeRange,
            totalDays: timeRange,
            activeDays: Object.keys(dailyStats).length,
            totalPractices: filteredRecords.length,
            averagePracticesPerDay: filteredRecords.length / timeRange,
            
            // 分数趋势
            scoreProgression: this.calculateScoreProgression(filteredRecords),
            accuracyProgression: this.calculateAccuracyProgression(filteredRecords),
            
            // 时间趋势
            timeEfficiencyTrend: this.calculateTimeEfficiencyTrend(filteredRecords),
            practiceFrequencyTrend: this.calculatePracticeFrequencyTrend(dailyStats, timeRange),
            
            // 每日统计
            dailyStats,
            
            // 周期性分析
            weekdayPerformance: this.analyzeWeekdayPerformance(filteredRecords),
            
            // 学习强度分析
            learningIntensity: this.analyzeLearningIntensity(dailyStats),
            
            // 进步速度
            improvementRate: this.calculateImprovementRate(filteredRecords)
        };

        this.setCachedAnalysis(cacheKey, trends);
        return trends;
    }

    /**
     * 获取空的趋势分析
     */
    getEmptyTrendAnalysis() {
        return {
            timeRange: 0,
            totalDays: 0,
            activeDays: 0,
            totalPractices: 0,
            averagePracticesPerDay: 0,
            scoreProgression: [],
            accuracyProgression: [],
            timeEfficiencyTrend: 0,
            practiceFrequencyTrend: 0,
            dailyStats: {},
            weekdayPerformance: {},
            learningIntensity: 'low',
            improvementRate: 0
        };
    }

    /**
     * 按日期分组记录
     */
    groupRecordsByDate(records) {
        const dailyStats = {};

        records.forEach(record => {
            const date = new Date(record.startTime).toDateString();
            
            if (!dailyStats[date]) {
                dailyStats[date] = {
                    date,
                    practices: 0,
                    totalTime: 0,
                    totalScore: 0,
                    totalQuestions: 0,
                    totalCorrectAnswers: 0,
                    scores: []
                };
            }

            const dayStats = dailyStats[date];
            dayStats.practices++;
            dayStats.totalTime += record.duration || 0;
            dayStats.totalScore += record.accuracy || 0;
            dayStats.totalQuestions += record.totalQuestions || 0;
            dayStats.totalCorrectAnswers += record.correctAnswers || 0;
            dayStats.scores.push(record.accuracy || 0);
        });

        // 计算每日派生指标
        Object.values(dailyStats).forEach(dayStats => {
            dayStats.averageScore = dayStats.totalScore / dayStats.practices;
            dayStats.averageAccuracy = dayStats.totalQuestions > 0 
                ? dayStats.totalCorrectAnswers / dayStats.totalQuestions 
                : 0;
            dayStats.averageTimePerPractice = dayStats.totalTime / dayStats.practices;
            dayStats.bestScore = Math.max(...dayStats.scores);
            dayStats.worstScore = Math.min(...dayStats.scores);
        });

        return dailyStats;
    }

    /**
     * 计算分数进展
     */
    calculateScoreProgression(records) {
        const progression = [];
        const windowSize = Math.max(1, Math.floor(records.length / 10)); // 分成10个时间窗口

        for (let i = 0; i < records.length; i += windowSize) {
            const window = records.slice(i, i + windowSize);
            const avgScore = window.reduce((sum, record) => sum + (record.accuracy || 0), 0) / window.length;
            
            progression.push({
                period: Math.floor(i / windowSize) + 1,
                averageScore: avgScore,
                practiceCount: window.length,
                startDate: window[0].startTime,
                endDate: window[window.length - 1].startTime
            });
        }

        return progression;
    }

    /**
     * 计算准确率进展
     */
    calculateAccuracyProgression(records) {
        const progression = [];
        const windowSize = Math.max(1, Math.floor(records.length / 10));

        for (let i = 0; i < records.length; i += windowSize) {
            const window = records.slice(i, i + windowSize);
            
            const totalQuestions = window.reduce((sum, record) => sum + (record.totalQuestions || 0), 0);
            const totalCorrect = window.reduce((sum, record) => sum + (record.correctAnswers || 0), 0);
            const accuracy = totalQuestions > 0 ? totalCorrect / totalQuestions : 0;
            
            progression.push({
                period: Math.floor(i / windowSize) + 1,
                accuracy,
                totalQuestions,
                totalCorrect,
                startDate: window[0].startTime,
                endDate: window[window.length - 1].startTime
            });
        }

        return progression;
    }

    /**
     * 计算时间效率趋势
     */
    calculateTimeEfficiencyTrend(records) {
        const timePerQuestion = records.map(record => {
            const questions = record.totalQuestions || 1;
            return (record.duration || 0) / questions;
        });

        return this.calculateImprovementTrend(timePerQuestion) * -1; // 负值表示时间减少（效率提高）
    }

    /**
     * 计算练习频率趋势
     */
    calculatePracticeFrequencyTrend(dailyStats, timeRange) {
        const dates = Object.keys(dailyStats).sort();
        if (dates.length < 2) return 0;

        const halfPoint = Math.floor(timeRange / 2);
        const firstHalf = dates.slice(0, halfPoint);
        const secondHalf = dates.slice(-halfPoint);

        const firstHalfAvg = firstHalf.reduce((sum, date) => sum + dailyStats[date].practices, 0) / firstHalf.length;
        const secondHalfAvg = secondHalf.reduce((sum, date) => sum + dailyStats[date].practices, 0) / secondHalf.length;

        return secondHalfAvg - firstHalfAvg; // 正值表示频率增加
    }

    /**
     * 分析工作日表现
     */
    analyzeWeekdayPerformance(records) {
        const weekdayStats = {};
        const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        weekdays.forEach(day => {
            weekdayStats[day] = {
                practices: 0,
                totalScore: 0,
                totalTime: 0,
                averageScore: 0,
                averageTime: 0
            };
        });

        records.forEach(record => {
            const weekday = weekdays[new Date(record.startTime).getDay()];
            const stats = weekdayStats[weekday];
            
            stats.practices++;
            stats.totalScore += record.accuracy || 0;
            stats.totalTime += record.duration || 0;
        });

        // 计算平均值
        Object.values(weekdayStats).forEach(stats => {
            if (stats.practices > 0) {
                stats.averageScore = stats.totalScore / stats.practices;
                stats.averageTime = stats.totalTime / stats.practices;
            }
        });

        return weekdayStats;
    }

    /**
     * 分析学习强度
     */
    analyzeLearningIntensity(dailyStats) {
        const activeDays = Object.keys(dailyStats).length;
        const totalPractices = Object.values(dailyStats).reduce((sum, day) => sum + day.practices, 0);
        const averagePracticesPerActiveDay = activeDays > 0 ? totalPractices / activeDays : 0;

        if (averagePracticesPerActiveDay >= 5) return 'high';
        if (averagePracticesPerActiveDay >= 2) return 'medium';
        return 'low';
    }

    /**
     * 计算改进速度
     */
    calculateImprovementRate(records) {
        if (records.length < 10) return 0;

        const firstQuarter = records.slice(0, Math.floor(records.length / 4));
        const lastQuarter = records.slice(-Math.floor(records.length / 4));

        const firstAvg = firstQuarter.reduce((sum, record) => sum + (record.accuracy || 0), 0) / firstQuarter.length;
        const lastAvg = lastQuarter.reduce((sum, record) => sum + (record.accuracy || 0), 0) / lastQuarter.length;

        return lastAvg - firstAvg; // 正值表示有改进
    }

    /**
     * 生成个人能力雷达图数据
     */
    generateRadarChartData(records) {
        if (!records || records.length === 0) {
            return this.getEmptyRadarData();
        }

        const cacheKey = `radar_chart_${records.length}`;
        const cached = this.getCachedAnalysis(cacheKey);
        if (cached) return cached;

        // Optimized single-pass calculation
        let basicTotalTimeSpent = 0;
        let basicTotalScore = 0;
        let basicTotalQuestions = 0;
        let basicTotalCorrectAnswers = 0;
        let basicCompletedPractices = 0;
        const basicScores = [];

        const categoryStats = new Map();
        const questionTypeStats = new Map();

        for (const record of records) {
            if (record.status !== 'completed') continue;

            // --- Basic Stats ---
            basicCompletedPractices++;
            basicTotalTimeSpent += record.duration || 0;
            basicTotalScore += record.accuracy || 0;
            basicScores.push(record.accuracy || 0);
            basicTotalQuestions += record.totalQuestions || 0;
            basicTotalCorrectAnswers += record.correctAnswers || 0;

            // --- Category Stats ---
            const category = record.metadata?.category;
            if (category) {
                let catStat = categoryStats.get(category);
                if (!catStat) {
                    catStat = { totalScore: 0, practices: 0 };
                    categoryStats.set(category, catStat);
                }
                catStat.practices++;
                catStat.totalScore += record.accuracy || 0;
            }

            // --- Question Type Stats ---
            if (record.questionTypePerformance) {
                for (const [type, performance] of Object.entries(record.questionTypePerformance)) {
                    let typeStat = questionTypeStats.get(type);
                    if (!typeStat) {
                        typeStat = { totalCorrect: 0, totalQuestions: 0 };
                        questionTypeStats.set(type, typeStat);
                    }
                    typeStat.totalQuestions += performance.total || 0;
                    typeStat.totalCorrect += performance.correct || 0;
                }
            }
        }

        // --- Calculate Derived Metrics ---
        let averageAccuracy = 0;
        let scoreVariance = 0;
        let averageTimePerQuestion = 0;
        let improvementTrend = 0;

        if (basicCompletedPractices > 0) {
            const averageScore = basicTotalScore / basicCompletedPractices;
            averageAccuracy = basicTotalQuestions > 0 ? basicTotalCorrectAnswers / basicTotalQuestions : 0;

            if (basicTotalQuestions > 0) {
                averageTimePerQuestion = basicTotalTimeSpent / basicTotalQuestions;
            }

            if (basicScores.length > 1) {
                const variance = basicScores.reduce((sum, score) => sum + Math.pow(score - averageScore, 2), 0) / basicScores.length;
                scoreVariance = Math.sqrt(variance);
            }

            improvementTrend = this.calculateImprovementTrend(basicScores);
        }

        const radarData = {
            // 分类能力
            categories: Array.from(categoryStats.entries()).map(([category, stats]) => ({
                label: category,
                value: Math.round((stats.totalScore / stats.practices) * 100),
                maxValue: 100,
                color: this.getCategoryColor(category)
            })),
            
            // 题型能力
            questionTypes: Array.from(questionTypeStats.entries()).map(([type, stats]) => ({
                label: this.getQuestionTypeLabel(type),
                value: Math.round((stats.totalQuestions > 0 ? stats.totalCorrect / stats.totalQuestions : 0) * 100),
                maxValue: 100,
                color: this.getQuestionTypeColor(type)
            })),
            
            // 综合能力指标
            overallMetrics: [
                {
                    label: '准确率',
                    value: Math.round(averageAccuracy * 100),
                    maxValue: 100,
                    color: '#4CAF50'
                },
                {
                    label: '稳定性',
                    value: Math.round((1 - scoreVariance) * 100),
                    maxValue: 100,
                    color: '#2196F3'
                },
                {
                    label: '效率',
                    value: Math.round(Math.max(0, (60 - averageTimePerQuestion)) / 60 * 100),
                    maxValue: 100,
                    color: '#FF9800'
                },
                {
                    label: '进步趋势',
                    value: Math.round(Math.max(0, (improvementTrend + 0.1) / 0.2 * 100)),
                    maxValue: 100,
                    color: '#9C27B0'
                }
            ]
        };

        this.setCachedAnalysis(cacheKey, radarData);
        return radarData;
    }

    /**
     * 获取空的雷达图数据
     */
    getEmptyRadarData() {
        return {
            categories: [],
            questionTypes: [],
            overallMetrics: [
                { label: '准确率', value: 0, maxValue: 100, color: '#4CAF50' },
                { label: '稳定性', value: 0, maxValue: 100, color: '#2196F3' },
                { label: '效率', value: 0, maxValue: 100, color: '#FF9800' },
                { label: '进步趋势', value: 0, maxValue: 100, color: '#9C27B0' }
            ]
        };
    }

    /**
     * 生成进度曲线数据
     */
    generateProgressCurveData(records, timeRange = 30) {
        if (!records || records.length === 0) {
            return this.getEmptyProgressCurve();
        }

        const cacheKey = `progress_curve_${records.length}_${timeRange}`;
        const cached = this.getCachedAnalysis(cacheKey);
        if (cached) return cached;

        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - timeRange * 24 * 60 * 60 * 1000);

        // 筛选时间范围内的记录
        const filteredRecords = records.filter(record => {
            const recordDate = new Date(record.startTime);
            return recordDate >= startDate && recordDate <= endDate && record.status === 'completed';
        });

        // 按日期分组并计算移动平均
        const dailyStats = this.groupRecordsByDate(filteredRecords);
        const sortedDates = Object.keys(dailyStats).sort();

        const progressData = {
            timeRange,
            dataPoints: [],
            movingAverages: [],
            trendLine: [],
            milestones: []
        };

        // 生成每日数据点
        sortedDates.forEach((date, index) => {
            const dayStats = dailyStats[date];
            
            progressData.dataPoints.push({
                date,
                day: index + 1,
                averageScore: dayStats.averageScore,
                practices: dayStats.practices,
                totalTime: dayStats.totalTime,
                bestScore: dayStats.bestScore,
                worstScore: dayStats.worstScore
            });
        });

        // 计算7日移动平均
        const windowSize = 7;
        for (let i = windowSize - 1; i < progressData.dataPoints.length; i++) {
            const window = progressData.dataPoints.slice(i - windowSize + 1, i + 1);
            const avgScore = window.reduce((sum, point) => sum + point.averageScore, 0) / window.length;
            
            progressData.movingAverages.push({
                date: progressData.dataPoints[i].date,
                day: i + 1,
                movingAverage: avgScore
            });
        }

        // 计算趋势线
        if (progressData.dataPoints.length > 1) {
            const scores = progressData.dataPoints.map(point => point.averageScore);
            const trend = this.calculateImprovementTrend(scores);
            const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
            
            progressData.dataPoints.forEach((point, index) => {
                progressData.trendLine.push({
                    date: point.date,
                    day: index + 1,
                    trendValue: avgScore + trend * (index - scores.length / 2)
                });
            });
        }

        // 识别里程碑
        progressData.milestones = this.identifyMilestones(progressData.dataPoints);

        this.setCachedAnalysis(cacheKey, progressData);
        return progressData;
    }

    /**
     * 获取空的进度曲线
     */
    getEmptyProgressCurve() {
        return {
            timeRange: 0,
            dataPoints: [],
            movingAverages: [],
            trendLine: [],
            milestones: []
        };
    }

    /**
     * 识别学习里程碑
     */
    identifyMilestones(dataPoints) {
        const milestones = [];
        
        if (dataPoints.length === 0) return milestones;

        // 最高分里程碑
        const bestDay = dataPoints.reduce((best, current) => 
            current.bestScore > best.bestScore ? current : best
        );
        
        milestones.push({
            type: 'best_score',
            date: bestDay.date,
            day: bestDay.day,
            value: bestDay.bestScore,
            description: `最高分: ${Math.round(bestDay.bestScore * 100)}%`
        });

        // 连续进步里程碑
        let consecutiveImprovement = 0;
        let maxConsecutive = 0;
        let maxConsecutiveEnd = 0;

        for (let i = 1; i < dataPoints.length; i++) {
            if (dataPoints[i].averageScore > dataPoints[i - 1].averageScore) {
                consecutiveImprovement++;
                if (consecutiveImprovement > maxConsecutive) {
                    maxConsecutive = consecutiveImprovement;
                    maxConsecutiveEnd = i;
                }
            } else {
                consecutiveImprovement = 0;
            }
        }

        if (maxConsecutive >= 3) {
            milestones.push({
                type: 'consecutive_improvement',
                date: dataPoints[maxConsecutiveEnd].date,
                day: dataPoints[maxConsecutiveEnd].day,
                value: maxConsecutive,
                description: `连续${maxConsecutive}天进步`
            });
        }

        // 练习量里程碑
        const maxPracticeDay = dataPoints.reduce((max, current) => 
            current.practices > max.practices ? current : max
        );

        if (maxPracticeDay.practices >= 5) {
            milestones.push({
                type: 'high_volume',
                date: maxPracticeDay.date,
                day: maxPracticeDay.day,
                value: maxPracticeDay.practices,
                description: `单日${maxPracticeDay.practices}次练习`
            });
        }

        return milestones.sort((a, b) => a.day - b.day);
    }

    /**
     * 获取分类颜色
     */
    getCategoryColor(category) {
        const colors = {
            'P1': '#4CAF50',
            'P2': '#2196F3',
            'P3': '#FF9800'
        };
        return colors[category] || '#9E9E9E';
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
     * 获取题型颜色
     */
    getQuestionTypeColor(type) {
        const colors = {
            'heading-matching': '#E91E63',
            'country-matching': '#9C27B0',
            'true-false-not-given': '#673AB7',
            'multiple-choice': '#3F51B5',
            'gap-filling': '#009688',
            'summary-completion': '#795548'
        };
        return colors[type] || '#607D8B';
    }

    /**
     * 清理分析缓存
     */
    clearCache() {
        this.analysisCache.clear();
        console.log('Analysis cache cleared');
    }

    /**
     * 获取缓存统计
     */
    getCacheStats() {
        return {
            cacheSize: this.analysisCache.size,
            cacheTimeout: this.cacheTimeout,
            memoryUsage: JSON.stringify(Array.from(this.analysisCache.values())).length
        };
    }
}

// 确保全局可用
window.ScoreAnalyzer = ScoreAnalyzer;