/**
 * 错误修复器
 * 负责自动检测和修复考试索引中的各种问题
 */
class ErrorFixer {
    constructor() {
        this.fixStrategies = new Map();
        this.fixHistory = [];
        this.brokenExams = [];
        
        // 注册修复策略
        this.registerDefaultStrategies();
    }

    /**
     * 注册默认修复策略
     */
    registerDefaultStrategies() {
        // 文件路径修复策略
        this.registerFixStrategy('file_not_found', this.fixFileNotFound.bind(this));
        this.registerFixStrategy('path_format_error', this.fixPathFormat.bind(this));
        this.registerFixStrategy('filename_mismatch', this.fixFilenameMismatch.bind(this));
        this.registerFixStrategy('missing_field', this.fixMissingField.bind(this));
    }

    /**
     * 注册修复策略
     */
    registerFixStrategy(errorType, strategy) {
        this.fixStrategies.set(errorType, strategy);
        console.log(`[ErrorFixer] 注册修复策略: ${errorType}`);
    }

    /**
     * 修复无法打开的考试页面
     */
    async fixBrokenExams() {
        console.log('[ErrorFixer] 开始修复无法打开的考试页面...');
        
        // 定义无法打开的考试列表
        const brokenExamTitles = [
            'A survivor\'s story 幸存者的故事',
            'Stress Less',
            'How Well Do We Concentrate? 我们的注意力有多集中？',
            'A closer examination of a study on verbal and non-verbal messages 语言与非语言信息研究审视',
            'Grimm\'s Fairy Tales 格林童话',
            'Jean Piaget (1896-1980) 让・皮亚杰',
            'The Pirahã people of Brazil 巴西的皮拉哈人',
            'What makes a musical expert? 是什么造就了音乐专家？',
            'Neanderthal Technology',
            'Does class size matter? 班级规模重要吗？',
            'Video Games\' Unexpected Benefits to the Human Brain 电子游戏对人类大脑的意外益处'
        ];

        const fixResults = [];
        
        try {
            // 获取当前索引
            const examIndex = window.completeExamIndex || [];
            
            // 查找并修复每个损坏的考试
            for (const brokenTitle of brokenExamTitles) {
                const exam = this.findExamByTitle(examIndex, brokenTitle);
                if (exam) {
                    console.log(`[ErrorFixer] 修复考试: ${exam.title}`);
                    const result = await this.fixSingleExam(exam);
                    fixResults.push(result);
                } else {
                    console.warn(`[ErrorFixer] 未找到考试: ${brokenTitle}`);
                    fixResults.push({
                        title: brokenTitle,
                        success: false,
                        error: '未在索引中找到该考试'
                    });
                }
            }

            // 生成修复报告
            const report = this.generateFixReport(fixResults);
            console.log('[ErrorFixer] 修复完成:', report);
            
            return report;
            
        } catch (error) {
            console.error('[ErrorFixer] 修复过程中发生错误:', error);
            throw error;
        }
    }

    /**
     * 根据标题查找考试
     */
    findExamByTitle(examIndex, title) {
        return examIndex.find(exam => {
            // 尝试多种匹配方式
            const normalizedTitle = this.normalizeTitle(title);
            const normalizedExamTitle = this.normalizeTitle(exam.title);
            
            return normalizedExamTitle.includes(normalizedTitle) ||
                   normalizedTitle.includes(normalizedExamTitle) ||
                   exam.title === title;
        });
    }

    /**
     * 标准化标题用于匹配
     */
    normalizeTitle(title) {
        return title.toLowerCase()
            .replace(/[【】\[\]()（）]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * 修复单个考试
     */
    async fixSingleExam(exam) {
        console.log(`[ErrorFixer] 开始修复考试: ${exam.title}`);
        
        const fixResult = {
            examId: exam.id,
            title: exam.title,
            originalPath: exam.path,
            originalFilename: exam.filename,
            fixes: [],
            success: false,
            error: null
        };

        try {
            // 检查并修复路径问题
            await this.fixPathIssues(exam, fixResult);
            
            // 检查并修复文件名问题
            await this.fixFilenameIssues(exam, fixResult);
            
            // 验证修复结果
            const isFixed = await this.validateExamAfterFix(exam);
            fixResult.success = isFixed;
            
            if (isFixed) {
                console.log(`[ErrorFixer] 考试修复成功: ${exam.title}`);
            } else {
                console.warn(`[ErrorFixer] 考试修复失败: ${exam.title}`);
                fixResult.error = '修复后仍无法访问文件';
            }

        } catch (error) {
            console.error(`[ErrorFixer] 修复考试时发生错误:`, error);
            fixResult.error = error.message;
        }

        return fixResult;
    }

    /**
     * 修复路径问题
     */
    async fixPathIssues(exam, fixResult) {
        console.log(`[ErrorFixer] 检查路径问题: ${exam.path}`);
        
        // 修复路径末尾斜杠
        if (!exam.path.endsWith('/')) {
            exam.path += '/';
            fixResult.fixes.push('添加路径末尾斜杠');
        }

        // 标准化路径分隔符
        const normalizedPath = exam.path.replace(/\\/g, '/');
        if (normalizedPath !== exam.path) {
            exam.path = normalizedPath;
            fixResult.fixes.push('标准化路径分隔符');
        }

        // 检查路径中的特殊字符
        const pathIssues = this.detectPathIssues(exam.path);
        if (pathIssues.length > 0) {
            const fixedPath = this.fixPathSpecialChars(exam.path);
            if (fixedPath !== exam.path) {
                exam.path = fixedPath;
                fixResult.fixes.push('修复路径中的特殊字符');
            }
        }
    }

    /**
     * 检测路径问题
     */
    detectPathIssues(path) {
        const issues = [];
        
        // 检查是否包含问题字符
        const problematicChars = ['?', '*', '<', '>', '|', '"'];
        for (const char of problematicChars) {
            if (path.includes(char)) {
                issues.push(`包含问题字符: ${char}`);
            }
        }

        return issues;
    }

    /**
     * 修复路径中的特殊字符
     */
    fixPathSpecialChars(path) {
        return path
            .replace(/\?/g, '_')
            .replace(/\*/g, '_')
            .replace(/</g, '_')
            .replace(/>/g, '_')
            .replace(/\|/g, '_')
            .replace(/"/g, '_');
    }

    /**
     * 修复文件名问题
     */
    async fixFilenameIssues(exam, fixResult) {
        console.log(`[ErrorFixer] 检查文件名问题: ${exam.filename}`);
        
        // 修复HTML文件名
        if (exam.hasHtml && exam.filename) {
            const fixedHtmlFilename = await this.fixHtmlFilename(exam);
            if (fixedHtmlFilename !== exam.filename) {
                exam.filename = fixedHtmlFilename;
                fixResult.fixes.push('修复HTML文件名');
            }
        }

        // 修复PDF文件名
        if (exam.hasPdf && exam.pdfFilename) {
            const fixedPdfFilename = await this.fixPdfFilename(exam);
            if (fixedPdfFilename !== exam.pdfFilename) {
                exam.pdfFilename = fixedPdfFilename;
                fixResult.fixes.push('修复PDF文件名');
            }
        }
    }

    /**
     * 修复HTML文件名
     */
    async fixHtmlFilename(exam) {
        const originalFilename = exam.filename;
        
        // 尝试不同的文件名模式
        const patterns = [
            originalFilename,
            `${exam.category} - ${exam.title.split(' ')[0]}【${exam.frequency === 'high' ? '高' : '次'}】.html`,
            `${exam.category} - ${exam.title.split(' ').slice(0, 2).join(' ')}【${exam.frequency === 'high' ? '高' : '次'}】.html`,
            `${exam.title.split(' ')[0]}.html`,
            'index.html'
        ];

        // 测试每个模式
        for (const pattern of patterns) {
            const testPath = exam.path + pattern;
            const exists = await this.checkFileExists(testPath);
            if (exists) {
                console.log(`[ErrorFixer] 找到有效的HTML文件: ${pattern}`);
                return pattern;
            }
        }

        console.warn(`[ErrorFixer] 未找到有效的HTML文件: ${exam.title}`);
        return originalFilename;
    }

    /**
     * 修复PDF文件名
     */
    async fixPdfFilename(exam) {
        const originalFilename = exam.pdfFilename;
        
        // 尝试不同的PDF文件名模式
        const patterns = [
            originalFilename,
            `${exam.category} - ${exam.title.split(' ')[0]}【${exam.frequency === 'high' ? '高' : '次'}】.pdf`,
            `${exam.category} - ${exam.title.split(' ').slice(0, 2).join(' ')}【${exam.frequency === 'high' ? '高' : '次'}】.pdf`,
            `${exam.title.split(' ')[0]}.pdf`
        ];

        // 测试每个模式
        for (const pattern of patterns) {
            const testPath = exam.path + pattern;
            const exists = await this.checkFileExists(testPath);
            if (exists) {
                console.log(`[ErrorFixer] 找到有效的PDF文件: ${pattern}`);
                return pattern;
            }
        }

        console.warn(`[ErrorFixer] 未找到有效的PDF文件: ${exam.title}`);
        return originalFilename;
    }

    /**
     * 检查文件是否存在
     */
    async checkFileExists(filePath) {
        try {
            const response = await fetch(filePath, { method: 'HEAD' });
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    /**
     * 验证修复后的考试
     */
    async validateExamAfterFix(exam) {
        console.log(`[ErrorFixer] 验证修复后的考试: ${exam.title}`);
        
        try {
            // 检查HTML文件
            if (exam.hasHtml && exam.filename) {
                const htmlPath = exam.path + exam.filename;
                const htmlExists = await this.checkFileExists(htmlPath);
                if (!htmlExists) {
                    console.warn(`[ErrorFixer] HTML文件仍不存在: ${htmlPath}`);
                    return false;
                }
            }

            // 检查PDF文件（可选）
            if (exam.hasPdf && exam.pdfFilename) {
                const pdfPath = exam.path + exam.pdfFilename;
                const pdfExists = await this.checkFileExists(pdfPath);
                if (!pdfExists) {
                    console.warn(`[ErrorFixer] PDF文件不存在: ${pdfPath}`);
                    // PDF文件不存在不算致命错误
                }
            }

            return true;

        } catch (error) {
            console.error(`[ErrorFixer] 验证时发生错误:`, error);
            return false;
        }
    }

    /**
     * 修复文件未找到错误
     */
    async fixFileNotFound(exam, issue) {
        console.log(`[ErrorFixer] 修复文件未找到: ${exam.title}`);
        
        const fixes = [];
        
        // 尝试不同的文件路径
        if (issue.message.includes('HTML')) {
            const newFilename = await this.fixHtmlFilename(exam);
            if (newFilename !== exam.filename) {
                exam.filename = newFilename;
                fixes.push('更新HTML文件名');
            }
        }

        if (issue.message.includes('PDF')) {
            const newPdfFilename = await this.fixPdfFilename(exam);
            if (newPdfFilename !== exam.pdfFilename) {
                exam.pdfFilename = newPdfFilename;
                fixes.push('更新PDF文件名');
            }
        }

        return fixes;
    }

    /**
     * 修复路径格式错误
     */
    fixPathFormat(exam, issue) {
        console.log(`[ErrorFixer] 修复路径格式: ${exam.title}`);
        
        const fixes = [];
        
        // 确保路径以斜杠结尾
        if (!exam.path.endsWith('/')) {
            exam.path += '/';
            fixes.push('添加路径末尾斜杠');
        }

        return fixes;
    }

    /**
     * 修复文件名不匹配
     */
    fixFilenameMismatch(exam, issue) {
        console.log(`[ErrorFixer] 修复文件名不匹配: ${exam.title}`);
        
        const fixes = [];
        
        // 基于考试信息生成标准文件名
        const standardHtmlName = `${exam.category} - ${exam.title.split(' ')[0]}【${exam.frequency === 'high' ? '高' : '次'}】.html`;
        const standardPdfName = `${exam.category} - ${exam.title.split(' ')[0]}【${exam.frequency === 'high' ? '高' : '次'}】.pdf`;

        if (exam.hasHtml && exam.filename !== standardHtmlName) {
            exam.filename = standardHtmlName;
            fixes.push('标准化HTML文件名');
        }

        if (exam.hasPdf && exam.pdfFilename !== standardPdfName) {
            exam.pdfFilename = standardPdfName;
            fixes.push('标准化PDF文件名');
        }

        return fixes;
    }

    /**
     * 修复缺失字段
     */
    fixMissingField(exam, issue) {
        console.log(`[ErrorFixer] 修复缺失字段: ${exam.title}`);
        
        const fixes = [];
        
        // 根据问题信息修复缺失字段
        if (issue.message.includes('filename') && !exam.filename) {
            exam.filename = `${exam.category} - ${exam.title.split(' ')[0]}【${exam.frequency === 'high' ? '高' : '次'}】.html`;
            exam.hasHtml = true;
            fixes.push('添加HTML文件名');
        }

        return fixes;
    }

    /**
     * 自动修复索引问题
     */
    async autoFixIndexIssues(issues) {
        console.log(`[ErrorFixer] 开始自动修复 ${issues.length} 个索引问题...`);
        
        const fixResults = [];
        
        try {
            for (const examIssue of issues) {
                const exam = window.completeExamIndex.find(e => e.id === examIssue.examId);
                if (!exam) continue;

                const examFixResult = {
                    examId: exam.id,
                    title: exam.title,
                    fixes: [],
                    success: false
                };

                // 处理每个问题
                for (const issue of examIssue.issues) {
                    const strategy = this.fixStrategies.get(issue.type);
                    if (strategy && issue.fixable) {
                        try {
                            const fixes = await strategy(exam, issue);
                            examFixResult.fixes.push(...fixes);
                        } catch (error) {
                            console.error(`[ErrorFixer] 修复策略执行失败:`, error);
                        }
                    }
                }

                // 验证修复结果
                if (examFixResult.fixes.length > 0) {
                    const isValid = await this.validateExamAfterFix(exam);
                    examFixResult.success = isValid;
                }

                fixResults.push(examFixResult);
            }

            console.log(`[ErrorFixer] 自动修复完成，成功修复 ${fixResults.filter(r => r.success).length} 个考试`);
            
        } catch (error) {
            console.error('[ErrorFixer] 自动修复过程中发生错误:', error);
        }

        return fixResults;
    }

    /**
     * 生成修复报告
     */
    generateFixReport(fixResults) {
        const totalExams = fixResults.length;
        const successfulFixes = fixResults.filter(r => r.success).length;
        const failedFixes = fixResults.filter(r => !r.success).length;

        const report = {
            reportId: `fix_report_${Date.now()}`,
            reportTime: new Date().toISOString(),
            summary: {
                totalExams,
                successfulFixes,
                failedFixes,
                successRate: Math.round((successfulFixes / totalExams) * 100)
            },
            results: fixResults,
            recommendations: this.generateFixRecommendations(fixResults)
        };

        // 记录到修复历史
        this.fixHistory.push(report);

        return report;
    }

    /**
     * 生成修复建议
     */
    generateFixRecommendations(fixResults) {
        const recommendations = [];
        
        const failedFixes = fixResults.filter(r => !r.success);
        
        if (failedFixes.length > 0) {
            recommendations.push({
                priority: 'high',
                type: 'manual_fix_required',
                message: `${failedFixes.length} 个考试需要手动修复`,
                action: '检查这些考试的文件是否存在，或者路径配置是否正确',
                affectedExams: failedFixes.map(f => f.title)
            });
        }

        // 检查常见问题模式
        const pathIssues = fixResults.filter(r => r.fixes.some(f => f.includes('路径')));
        if (pathIssues.length > 0) {
            recommendations.push({
                priority: 'medium',
                type: 'path_standardization',
                message: '建议标准化所有考试的路径格式',
                action: '运行路径标准化工具来统一路径格式'
            });
        }

        return recommendations;
    }

    /**
     * 获取修复历史
     */
    getFixHistory() {
        return this.fixHistory;
    }

    /**
     * 清除修复历史
     */
    clearFixHistory() {
        this.fixHistory = [];
        console.log('[ErrorFixer] 修复历史已清除');
    }
}

// 导出类
window.ErrorFixer = ErrorFixer;