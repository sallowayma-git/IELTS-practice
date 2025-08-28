/**
 * 个性化推荐系统
 * 基于历史表现推荐练习题目，实现难度适应性调整和学习路径规划
 */
class RecommendationEngine {
    constructor() {
        this.scoreAnalyzer = null;
        this.weaknessAnalyzer = null;
        
        // 推荐算法配置
        this.config = {
            // 难度调整参数
            difficultyAdjustment: {
                highPerformance: 0.85,    // 高表现阈值
                lowPerformance: 0.6,      // 低表现阈值
                adjustmentRate: 0.1       // 调整幅度
            },
            
            // 推荐权重
            recommendationWeights: {
                weakness: 0.4,            // 薄弱环节权重
                performance: 0.3,         // 历史表现权重
                frequency: 0.2,           // 练习频率权重
                difficulty: 0.1           // 难度匹配权重
            },
            
            // 学习路径配置
            learningPath: {
                maxRecommendations: 10,   // 最大推荐数量
                diversityFactor: 0.3,     // 多样性因子
                progressionRate: 0.15     // 进阶速度
            }
        };
        
        this.initialize();
    }

    /**
     * 初始化推荐引擎
     */
    initialize() {
        console.log('RecommendationEngine initialized');
        
        // 初始化依赖组件
        this.scoreAnalyzer = new ScoreAnalyzer();
        this.weaknessAnalyzer = new WeaknessAnalyzer();
        
        // 初始化题目库映射
        this.initializeExamMapping();
    }

    /**
     * 初始化题目库映射
     */
    initializeExamMapping() {
        // 题目分类映射
        this.examCategories = {
            'P1': {
                label: 'P1类别',
                difficulty: 'easy',
                topics: ['基础阅读', '词汇理解', '简单推理'],
                questionTypes: ['multiple-choice', 'true-false-not-given']
            },
            'P2': {
                label: 'P2类别', 
                difficulty: 'medium',
                topics: ['段落理解', '信息匹配', '逻辑推理'],
                questionTypes: ['heading-matching', 'country-matching', 'gap-filling']
            },
            'P3': {
                label: 'P3类别',
                difficulty: 'hard',
                topics: ['深度分析', '复杂推理', '综合理解'],
                questionTypes: ['summary-completion', 'multiple-choice', 'true-false-not-given']
            }
        };

        // 题型难度映射
        this.questionTypeDifficulty = {
            'multiple-choice': 1,
            'true-false-not-given': 2,
            'gap-filling': 3,
            'country-matching': 4,
            'heading-matching': 5,
            'summary-completion': 6
        };
    }

    /**
     * 生成个性化推荐
     */
    generateRecommendations(userId, options = {}) {
        try {
            // 获取用户历史数据
            const practiceRecords = this.getUserPracticeRecords(userId);
            
            if (practiceRecords.length === 0) {
                return this.generateInitialRecommendations();
            }

            // 分析用户表现
            const performanceAnalysis = this.analyzeUserPerformance(practiceRecords);
            
            // 识别薄弱环节
            const weaknessAnalysis = this.weaknessAnalyzer.analyzeWeaknesses(practiceRecords);
            
            // 生成推荐策略
            const strategy = this.generateRecommendationStrategy(performanceAnalysis, weaknessAnalysis);
            
            // 生成具体推荐
            const recommendations = this.generateSpecificRecommendations(strategy, options);
            
            // 应用多样性和个性化调整
            const finalRecommendations = this.applyPersonalization(recommendations, performanceAnalysis);
            
            return {
                userId,
                timestamp: new Date().toISOString(),
                strategy,
                recommendations: finalRecommendations,
                metadata: {
                    totalRecords: practiceRecords.length,
                    analysisVersion: '1.0.0'
                }
            };
            
        } catch (error) {
            console.error('Failed to generate recommendations:', error);
            return this.generateFallbackRecommendations();
        }
    }

    /**
     * 获取用户练习记录
     */
    getUserPracticeRecords(userId) {
        // 从存储中获取用户记录
        const allRecords = storage.get('practice_records', []);
        return allRecords.filter(record => record.status === 'completed');
    }

    /**
     * 分析用户表现
     */
    analyzeUserPerformance(records) {
        const basicStats = this.scoreAnalyzer.calculateBasicStats(records);
        const categoryPerformance = this.scoreAnalyzer.analyzeCategoryPerformance(records);
        const questionTypePerformance = this.scoreAnalyzer.analyzeQuestionTypePerformance(records);
        const learningTrends = this.scoreAnalyzer.analyzeLearningTrends(records);

        return {
            overall: basicStats,
            categories: categoryPerformance,
            questionTypes: questionTypePerformance,
            trends: learningTrends,
            
            // 计算用户水平
            userLevel: this.calculateUserLevel(basicStats),
            
            // 计算学习偏好
            learningPreferences: this.analyzeLearningPreferences(records),
            
            // 计算进步速度
            progressRate: this.calculateProgressRate(records)
        };
    }

    /**
     * 计算用户水平
     */
    calculateUserLevel(basicStats) {
        const accuracy = basicStats.averageAccuracy;
        const consistency = 1 - basicStats.scoreVariance;
        const efficiency = Math.max(0, (120 - basicStats.averageTimePerQuestion) / 120);
        
        const overallScore = (accuracy * 0.5) + (consistency * 0.3) + (efficiency * 0.2);
        
        if (overallScore >= 0.8) return 'advanced';
        if (overallScore >= 0.6) return 'intermediate';
        return 'beginner';
    }

    /**
     * 分析学习偏好
     */
    analyzeLearningPreferences(records) {
        const preferences = {
            preferredCategories: [],
            preferredQuestionTypes: [],
            practiceFrequency: 'medium',
            sessionLength: 'medium'
        };

        // 分析偏好分类
        const categoryStats = {};
        records.forEach(record => {
            const category = record.metadata?.category;
            if (category) {
                if (!categoryStats[category]) {
                    categoryStats[category] = { count: 0, totalAccuracy: 0 };
                }
                categoryStats[category].count++;
                categoryStats[category].totalAccuracy += record.accuracy || 0;
            }
        });

        preferences.preferredCategories = Object.entries(categoryStats)
            .map(([category, stats]) => ({
                category,
                frequency: stats.count,
                performance: stats.totalAccuracy / stats.count
            }))
            .sort((a, b) => (b.frequency * b.performance) - (a.frequency * a.performance))
            .slice(0, 2)
            .map(item => item.category);

        // 分析练习频率
        if (records.length > 0) {
            const daysSinceFirst = (new Date() - new Date(records[0].startTime)) / (1000 * 60 * 60 * 24);
            const frequency = records.length / daysSinceFirst;
            
            if (frequency > 1) preferences.practiceFrequency = 'high';
            else if (frequency > 0.5) preferences.practiceFrequency = 'medium';
            else preferences.practiceFrequency = 'low';
        }

        // 分析会话长度偏好
        const avgDuration = records.reduce((sum, r) => sum + (r.duration || 0), 0) / records.length;
        if (avgDuration > 1800) preferences.sessionLength = 'long';      // 超过30分钟
        else if (avgDuration > 900) preferences.sessionLength = 'medium'; // 15-30分钟
        else preferences.sessionLength = 'short';                         // 少于15分钟

        return preferences;
    }

    /**
     * 计算进步速度
     */
    calculateProgressRate(records) {
        if (records.length < 5) return 'unknown';
        
        const recentRecords = records.slice(-10);
        const earlyRecords = records.slice(0, 10);
        
        const recentAvg = recentRecords.reduce((sum, r) => sum + (r.accuracy || 0), 0) / recentRecords.length;
        const earlyAvg = earlyRecords.reduce((sum, r) => sum + (r.accuracy || 0), 0) / earlyRecords.length;
        
        const improvement = recentAvg - earlyAvg;
        
        if (improvement > 0.1) return 'fast';
        if (improvement > 0.05) return 'moderate';
        if (improvement > -0.05) return 'slow';
        return 'declining';
    }

    /**
     * 生成推荐策略
     */
    generateRecommendationStrategy(performanceAnalysis, weaknessAnalysis) {
        const strategy = {
            primaryFocus: 'balanced',
            targetAreas: [],
            difficultyAdjustment: 0,
            recommendationTypes: [],
            learningPath: []
        };

        // 确定主要关注点
        if (weaknessAnalysis.overallWeaknesses.length > 0) {
            strategy.primaryFocus = 'weakness_improvement';
            strategy.targetAreas = weaknessAnalysis.overallWeaknesses.slice(0, 3).map(w => w.type);
        } else if (performanceAnalysis.overall.averageAccuracy > 0.8) {
            strategy.primaryFocus = 'skill_advancement';
            strategy.targetAreas = ['advanced_techniques', 'speed_improvement', 'consistency'];
        } else {
            strategy.primaryFocus = 'foundation_building';
            strategy.targetAreas = ['basic_skills', 'accuracy_improvement', 'confidence_building'];
        }

        // 计算难度调整
        const userLevel = performanceAnalysis.userLevel;
        const recentPerformance = performanceAnalysis.trends.scoreProgression.slice(-3);
        const avgRecentScore = recentPerformance.reduce((sum, p) => sum + p.averageScore, 0) / recentPerformance.length;

        if (avgRecentScore > this.config.difficultyAdjustment.highPerformance) {
            strategy.difficultyAdjustment = this.config.difficultyAdjustment.adjustmentRate;
        } else if (avgRecentScore < this.config.difficultyAdjustment.lowPerformance) {
            strategy.difficultyAdjustment = -this.config.difficultyAdjustment.adjustmentRate;
        }

        // 确定推荐类型
        strategy.recommendationTypes = this.determineRecommendationTypes(strategy.primaryFocus, weaknessAnalysis);

        // 生成学习路径
        strategy.learningPath = this.generateLearningPath(performanceAnalysis, strategy);

        return strategy;
    }

    /**
     * 确定推荐类型
     */
    determineRecommendationTypes(primaryFocus, weaknessAnalysis) {
        const types = [];

        switch (primaryFocus) {
            case 'weakness_improvement':
                types.push('targeted_practice', 'skill_building', 'error_correction');
                break;
            case 'skill_advancement':
                types.push('challenging_practice', 'speed_training', 'advanced_techniques');
                break;
            case 'foundation_building':
                types.push('basic_practice', 'concept_review', 'confidence_building');
                break;
            default:
                types.push('mixed_practice', 'skill_maintenance', 'gradual_improvement');
        }

        // 基于具体薄弱环节添加类型
        if (weaknessAnalysis.categoryWeaknesses && Object.keys(weaknessAnalysis.categoryWeaknesses).length > 0) {
            types.push('category_specific');
        }

        if (weaknessAnalysis.questionTypeWeaknesses && Object.keys(weaknessAnalysis.questionTypeWeaknesses).length > 0) {
            types.push('question_type_specific');
        }

        return types;
    }

    /**
     * 生成学习路径
     */
    generateLearningPath(performanceAnalysis, strategy) {
        const path = [];
        const userLevel = performanceAnalysis.userLevel;
        const weakCategories = Object.keys(performanceAnalysis.categories)
            .filter(cat => performanceAnalysis.categories[cat].averageScore < 0.7)
            .sort((a, b) => performanceAnalysis.categories[a].averageScore - performanceAnalysis.categories[b].averageScore);

        // 短期目标（1-2周）
        path.push({
            phase: 'short_term',
            duration: '1-2 weeks',
            goals: this.generateShortTermGoals(strategy, weakCategories),
            recommendations: this.generatePhaseRecommendations('short_term', strategy, performanceAnalysis)
        });

        // 中期目标（1个月）
        path.push({
            phase: 'medium_term',
            duration: '3-4 weeks',
            goals: this.generateMediumTermGoals(strategy, performanceAnalysis),
            recommendations: this.generatePhaseRecommendations('medium_term', strategy, performanceAnalysis)
        });

        // 长期目标（2-3个月）
        path.push({
            phase: 'long_term',
            duration: '2-3 months',
            goals: this.generateLongTermGoals(userLevel, performanceAnalysis),
            recommendations: this.generatePhaseRecommendations('long_term', strategy, performanceAnalysis)
        });

        return path;
    }

    /**
     * 生成短期目标
     */
    generateShortTermGoals(strategy, weakCategories) {
        const goals = [];

        if (strategy.primaryFocus === 'weakness_improvement' && weakCategories.length > 0) {
            goals.push(`提升${weakCategories[0]}类别准确率至70%以上`);
            goals.push('减少连续错误的发生频率');
        } else if (strategy.primaryFocus === 'foundation_building') {
            goals.push('建立稳定的答题节奏');
            goals.push('提高基础题型准确率');
        } else {
            goals.push('保持当前表现水平');
            goals.push('尝试更具挑战性的题目');
        }

        goals.push('每日完成至少1次练习');
        return goals;
    }

    /**
     * 生成中期目标
     */
    generateMediumTermGoals(strategy, performanceAnalysis) {
        const goals = [];
        const currentAccuracy = performanceAnalysis.overall.averageAccuracy;

        goals.push(`整体准确率提升至${Math.min(0.9, currentAccuracy + 0.1) * 100}%`);
        goals.push('掌握所有基础题型解题技巧');
        
        if (performanceAnalysis.overall.scoreVariance > 0.2) {
            goals.push('提高答题稳定性，减少分数波动');
        }
        
        if (performanceAnalysis.overall.averageTimePerQuestion > 90) {
            goals.push('提高答题效率，平均每题用时控制在90秒内');
        }

        return goals;
    }

    /**
     * 生成长期目标
     */
    generateLongTermGoals(userLevel, performanceAnalysis) {
        const goals = [];

        switch (userLevel) {
            case 'beginner':
                goals.push('达到中级水平，整体准确率稳定在75%以上');
                goals.push('熟练掌握所有题型的基本解题方法');
                break;
            case 'intermediate':
                goals.push('达到高级水平，整体准确率稳定在85%以上');
                goals.push('在时间压力下保持高准确率');
                break;
            case 'advanced':
                goals.push('保持专家级表现，准确率稳定在90%以上');
                goals.push('成为各题型的解题专家');
                break;
        }

        goals.push('建立完整的学习体系和自我评估能力');
        return goals;
    }

    /**
     * 生成阶段推荐
     */
    generatePhaseRecommendations(phase, strategy, performanceAnalysis) {
        const recommendations = [];

        // 基于阶段生成不同类型的推荐
        switch (phase) {
            case 'short_term':
                recommendations.push(...this.generateImmediateRecommendations(strategy, performanceAnalysis));
                break;
            case 'medium_term':
                recommendations.push(...this.generateProgressiveRecommendations(strategy, performanceAnalysis));
                break;
            case 'long_term':
                recommendations.push(...this.generateAdvancedRecommendations(strategy, performanceAnalysis));
                break;
        }

        return recommendations.slice(0, 5); // 限制每阶段推荐数量
    }

    /**
     * 生成具体推荐
     */
    generateSpecificRecommendations(strategy, options = {}) {
        const recommendations = [];
        const maxRecommendations = options.maxRecommendations || this.config.learningPath.maxRecommendations;

        // 基于策略生成不同类型的推荐
        strategy.recommendationTypes.forEach(type => {
            const typeRecommendations = this.generateRecommendationsByType(type, strategy, options);
            recommendations.push(...typeRecommendations);
        });

        // 应用多样性过滤
        const diverseRecommendations = this.applyDiversityFilter(recommendations);

        // 按优先级排序并限制数量
        return diverseRecommendations
            .sort((a, b) => b.priority - a.priority)
            .slice(0, maxRecommendations);
    }

    /**
     * 按类型生成推荐
     */
    generateRecommendationsByType(type, strategy, options) {
        const recommendations = [];

        switch (type) {
            case 'targeted_practice':
                recommendations.push(...this.generateTargetedPracticeRecommendations(strategy));
                break;
            case 'skill_building':
                recommendations.push(...this.generateSkillBuildingRecommendations(strategy));
                break;
            case 'challenging_practice':
                recommendations.push(...this.generateChallengingPracticeRecommendations(strategy));
                break;
            case 'basic_practice':
                recommendations.push(...this.generateBasicPracticeRecommendations(strategy));
                break;
            case 'category_specific':
                recommendations.push(...this.generateCategorySpecificRecommendations(strategy));
                break;
            case 'question_type_specific':
                recommendations.push(...this.generateQuestionTypeSpecificRecommendations(strategy));
                break;
        }

        return recommendations;
    }

    /**
     * 生成针对性练习推荐
     */
    generateTargetedPracticeRecommendations(strategy) {
        const recommendations = [];

        strategy.targetAreas.forEach(area => {
            recommendations.push({
                id: `targeted_${area}_${Date.now()}`,
                type: 'targeted_practice',
                title: `${area}专项练习`,
                description: `针对${area}薄弱环节的专项训练`,
                category: this.getRecommendedCategory(area),
                questionTypes: this.getRecommendedQuestionTypes(area),
                difficulty: this.calculateRecommendedDifficulty(strategy),
                priority: 0.9,
                estimatedTime: 20,
                tags: ['targeted', 'weakness', area],
                reasoning: `基于分析发现您在${area}方面需要加强练习`
            });
        });

        return recommendations;
    }

    /**
     * 生成技能建设推荐
     */
    generateSkillBuildingRecommendations(strategy) {
        return [
            {
                id: `skill_building_${Date.now()}`,
                type: 'skill_building',
                title: '综合技能提升练习',
                description: '通过多样化练习提升整体解题能力',
                category: 'mixed',
                questionTypes: ['multiple-choice', 'true-false-not-given', 'gap-filling'],
                difficulty: this.calculateRecommendedDifficulty(strategy),
                priority: 0.7,
                estimatedTime: 30,
                tags: ['skill_building', 'comprehensive'],
                reasoning: '通过综合练习巩固和提升各项技能'
            }
        ];
    }

    /**
     * 生成挑战性练习推荐
     */
    generateChallengingPracticeRecommendations(strategy) {
        return [
            {
                id: `challenging_${Date.now()}`,
                type: 'challenging_practice',
                title: '高难度挑战练习',
                description: '挑战更高难度题目，突破能力上限',
                category: 'P3',
                questionTypes: ['heading-matching', 'summary-completion'],
                difficulty: 'hard',
                priority: 0.6,
                estimatedTime: 40,
                tags: ['challenging', 'advanced'],
                reasoning: '您的表现优秀，可以尝试更具挑战性的题目'
            }
        ];
    }

    /**
     * 生成基础练习推荐
     */
    generateBasicPracticeRecommendations(strategy) {
        return [
            {
                id: `basic_${Date.now()}`,
                type: 'basic_practice',
                title: '基础技能巩固练习',
                description: '巩固基础知识和解题技巧',
                category: 'P1',
                questionTypes: ['multiple-choice', 'true-false-not-given'],
                difficulty: 'easy',
                priority: 0.8,
                estimatedTime: 15,
                tags: ['basic', 'foundation'],
                reasoning: '通过基础练习建立扎实的解题基础'
            }
        ];
    }

    /**
     * 生成分类特定推荐
     */
    generateCategorySpecificRecommendations(strategy) {
        const recommendations = [];
        
        // 基于薄弱分类生成推荐
        strategy.targetAreas.forEach(area => {
            if (this.examCategories[area]) {
                recommendations.push({
                    id: `category_${area}_${Date.now()}`,
                    type: 'category_specific',
                    title: `${area}类别专项训练`,
                    description: `专门针对${area}类别的强化练习`,
                    category: area,
                    questionTypes: this.examCategories[area].questionTypes,
                    difficulty: this.examCategories[area].difficulty,
                    priority: 0.85,
                    estimatedTime: 25,
                    tags: ['category_specific', area],
                    reasoning: `您在${area}类别表现有待提升，建议进行专项练习`
                });
            }
        });

        return recommendations;
    }

    /**
     * 生成题型特定推荐
     */
    generateQuestionTypeSpecificRecommendations(strategy) {
        const recommendations = [];
        
        // 基于薄弱题型生成推荐
        const weakQuestionTypes = strategy.targetAreas.filter(area => 
            this.questionTypeDifficulty.hasOwnProperty(area)
        );

        weakQuestionTypes.forEach(questionType => {
            recommendations.push({
                id: `question_type_${questionType}_${Date.now()}`,
                type: 'question_type_specific',
                title: `${this.getQuestionTypeLabel(questionType)}专项练习`,
                description: `专门练习${this.getQuestionTypeLabel(questionType)}题型`,
                category: this.getCategoryForQuestionType(questionType),
                questionTypes: [questionType],
                difficulty: this.getDifficultyForQuestionType(questionType),
                priority: 0.8,
                estimatedTime: 20,
                tags: ['question_type_specific', questionType],
                reasoning: `您在${this.getQuestionTypeLabel(questionType)}题型上需要加强练习`
            });
        });

        return recommendations;
    }

    /**
     * 应用个性化调整
     */
    applyPersonalization(recommendations, performanceAnalysis) {
        return recommendations.map(rec => {
            // 基于用户偏好调整
            const preferences = performanceAnalysis.learningPreferences;
            
            // 调整估计时间
            if (preferences.sessionLength === 'short') {
                rec.estimatedTime = Math.min(rec.estimatedTime, 15);
            } else if (preferences.sessionLength === 'long') {
                rec.estimatedTime = Math.max(rec.estimatedTime, 30);
            }

            // 调整难度
            if (performanceAnalysis.progressRate === 'fast') {
                rec.difficulty = this.increaseDifficulty(rec.difficulty);
            } else if (performanceAnalysis.progressRate === 'slow') {
                rec.difficulty = this.decreaseDifficulty(rec.difficulty);
            }

            // 添加个性化标签
            rec.tags.push(`level_${performanceAnalysis.userLevel}`);
            rec.tags.push(`progress_${performanceAnalysis.progressRate}`);

            return rec;
        });
    }

    /**
     * 应用多样性过滤
     */
    applyDiversityFilter(recommendations) {
        const diverseRecommendations = [];
        const typeCount = {};
        const categoryCount = {};
        
        const maxPerType = Math.ceil(recommendations.length * this.config.learningPath.diversityFactor);
        const maxPerCategory = Math.ceil(recommendations.length * this.config.learningPath.diversityFactor);

        recommendations.forEach(rec => {
            const typeKey = rec.type;
            const categoryKey = rec.category;
            
            if ((typeCount[typeKey] || 0) < maxPerType && 
                (categoryCount[categoryKey] || 0) < maxPerCategory) {
                
                diverseRecommendations.push(rec);
                typeCount[typeKey] = (typeCount[typeKey] || 0) + 1;
                categoryCount[categoryKey] = (categoryCount[categoryKey] || 0) + 1;
            }
        });

        return diverseRecommendations;
    }

    /**
     * 生成初始推荐（新用户）
     */
    generateInitialRecommendations() {
        return {
            userId: 'new_user',
            timestamp: new Date().toISOString(),
            strategy: {
                primaryFocus: 'foundation_building',
                targetAreas: ['basic_skills'],
                difficultyAdjustment: 0,
                recommendationTypes: ['basic_practice'],
                learningPath: []
            },
            recommendations: [
                {
                    id: `initial_${Date.now()}`,
                    type: 'basic_practice',
                    title: '新手入门练习',
                    description: '适合初学者的基础练习题目',
                    category: 'P1',
                    questionTypes: ['multiple-choice'],
                    difficulty: 'easy',
                    priority: 1.0,
                    estimatedTime: 15,
                    tags: ['beginner', 'foundation'],
                    reasoning: '作为新用户，建议从基础题目开始练习'
                }
            ],
            metadata: {
                totalRecords: 0,
                analysisVersion: '1.0.0'
            }
        };
    }

    /**
     * 生成降级推荐（错误处理）
     */
    generateFallbackRecommendations() {
        return {
            userId: 'unknown',
            timestamp: new Date().toISOString(),
            strategy: {
                primaryFocus: 'balanced',
                targetAreas: [],
                difficultyAdjustment: 0,
                recommendationTypes: ['mixed_practice'],
                learningPath: []
            },
            recommendations: [
                {
                    id: `fallback_${Date.now()}`,
                    type: 'mixed_practice',
                    title: '综合练习',
                    description: '包含多种题型的综合练习',
                    category: 'mixed',
                    questionTypes: ['multiple-choice', 'true-false-not-given'],
                    difficulty: 'medium',
                    priority: 0.5,
                    estimatedTime: 20,
                    tags: ['fallback', 'mixed'],
                    reasoning: '系统推荐的综合练习题目'
                }
            ],
            metadata: {
                totalRecords: 0,
                analysisVersion: '1.0.0',
                fallback: true
            }
        };
    }

    /**
     * 辅助方法
     */
    getRecommendedCategory(area) {
        // 基于薄弱领域推荐分类
        const categoryMapping = {
            'low_overall_accuracy': 'P1',
            'time_efficiency': 'P2',
            'consistency': 'P1'
        };
        return categoryMapping[area] || 'P2';
    }

    getRecommendedQuestionTypes(area) {
        const typeMapping = {
            'low_overall_accuracy': ['multiple-choice', 'true-false-not-given'],
            'time_efficiency': ['gap-filling'],
            'consistency': ['multiple-choice']
        };
        return typeMapping[area] || ['multiple-choice'];
    }

    calculateRecommendedDifficulty(strategy) {
        const baseDifficulty = 'medium';
        const adjustment = strategy.difficultyAdjustment;
        
        if (adjustment > 0) return 'hard';
        if (adjustment < 0) return 'easy';
        return baseDifficulty;
    }

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

    getCategoryForQuestionType(questionType) {
        for (const [category, info] of Object.entries(this.examCategories)) {
            if (info.questionTypes.includes(questionType)) {
                return category;
            }
        }
        return 'P2';
    }

    getDifficultyForQuestionType(questionType) {
        const difficulty = this.questionTypeDifficulty[questionType] || 3;
        if (difficulty <= 2) return 'easy';
        if (difficulty <= 4) return 'medium';
        return 'hard';
    }

    increaseDifficulty(currentDifficulty) {
        const levels = ['easy', 'medium', 'hard'];
        const currentIndex = levels.indexOf(currentDifficulty);
        return levels[Math.min(currentIndex + 1, levels.length - 1)];
    }

    decreaseDifficulty(currentDifficulty) {
        const levels = ['easy', 'medium', 'hard'];
        const currentIndex = levels.indexOf(currentDifficulty);
        return levels[Math.max(currentIndex - 1, 0)];
    }
}

// 确保全局可用
window.RecommendationEngine = RecommendationEngine;