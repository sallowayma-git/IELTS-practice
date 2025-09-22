/**
 * Markdown 导出器
 * 用于将练习数据导出为 Markdown 格式
 */
class MarkdownExporter {
    // 合并 comparison 与其他来源以补全缺失 correctAnswer
    mergeComparisonWithCorrections(record) {
        const comparison = JSON.parse(JSON.stringify(record.answerComparison || {}));
        const sources = [
            record.correctAnswers || {},
            (record.realData && record.realData.correctAnswers) || {},
        ];
        if (record.realData && record.realData.scoreInfo && record.realData.scoreInfo.details) {
            sources.push(Object.fromEntries(Object.entries(record.realData.scoreInfo.details).map(([k,v]) => [k, v && v.correctAnswer])));
        }
        if (record.scoreInfo && record.scoreInfo.details) {
            sources.push(Object.fromEntries(Object.entries(record.scoreInfo.details).map(([k,v]) => [k, v && v.correctAnswer])));
        }
        const getFromSources = (key) => {
            for (const src of sources) {
                if (src && src[key] != null && String(src[key]).trim() !== '') return src[key];
            }
            return null;
        };
        Object.keys(comparison).forEach(key => {
            const item = comparison[key] || {};
            if (item.correctAnswer == null || String(item.correctAnswer).trim() === '') {
                const fixed = getFromSources(key);
                if (fixed != null) item.correctAnswer = fixed;
            }
            if (item.userAnswer == null) item.userAnswer = '';
            if (item.correctAnswer == null) item.correctAnswer = '';
            comparison[key] = item;
        });
        // 映射 qa.. 到可能对应的数值区间 q14..q20
        const letterKeys = Object.keys(comparison).filter(k => /^q[a-z]$/i.test(k));
        if (letterKeys.length > 0) {
            let numericKeys = Object.keys(comparison).filter(k => /q\d+$/i.test(k));
            if (numericKeys.length === 0) {
                for (const src of sources) {
                    if (!src) continue;
                    numericKeys.push(...Object.keys(src).filter(k => /q\d+$/i.test(k)));
                }
                numericKeys = Array.from(new Set(numericKeys));
            }
            letterKeys.sort();
            numericKeys.sort((a,b) => (parseInt(a.replace(/\D/g,''))||0) - (parseInt(b.replace(/\D/g,''))||0));
            if (numericKeys.length >= letterKeys.length) {
                let bestStart = 0, found = false;
                for (let i=0; i+letterKeys.length-1 < numericKeys.length; i++) {
                    const first = parseInt(numericKeys[i].replace(/\D/g,''));
                    const last = parseInt(numericKeys[i+letterKeys.length-1].replace(/\D/g,''));
                    if (!isNaN(first) && !isNaN(last) && (last - first + 1) === letterKeys.length) { bestStart = i; found = true; break; }
                }
                const slice = numericKeys.slice(found ? bestStart : 0, (found ? bestStart : 0) + letterKeys.length);
                for (let i=0; i<letterKeys.length; i++) {
                    const lk = letterKeys[i], nk = slice[i];
                    if (!nk) continue;
                    const item = comparison[lk] || {};
                    if (!item.correctAnswer || String(item.correctAnswer).trim() === '') {
                        const nkItem = comparison[nk];
                        let val = nkItem && nkItem.correctAnswer;
                        if (!val) val = getFromSources(nk);
                        if (val != null) item.correctAnswer = val;
                    }
                    if (item.userAnswer == null) item.userAnswer = '';
                    if (item.correctAnswer == null) item.correctAnswer = '';
                    comparison[lk] = item;
                }
            }
        }
        return comparison;
    }
    constructor() {
        this.storage = window.storage;
    }

    /**
     * 导出所有练习记录为 Markdown 格式
     */
    exportToMarkdown() {
        return new Promise((resolve, reject) => {
            try {
                console.log('[MarkdownExporter] 开始导出过程');
                
                // 显示进度指示器
                this.showProgressIndicator();
                
                // 设置超时机制
                const timeout = setTimeout(() => {
                    this.hideProgressIndicator();
                    reject(new Error('导出超时，请尝试减少数据量'));
                }, 30000); // 30秒超时
                
                // 使用setTimeout避免阻塞UI
                setTimeout(() => {
                    try {
                        this.performExport()
                            .then(result => {
                                clearTimeout(timeout);
                                resolve(result);
                            })
                            .catch(error => {
                                clearTimeout(timeout);
                                this.hideProgressIndicator();
                                reject(error);
                            });
                    } catch (error) {
                        clearTimeout(timeout);
                        this.hideProgressIndicator();
                        reject(error);
                    }
                }, 100);
                
            } catch (error) {
                console.error('Markdown导出失败:', error);
                this.hideProgressIndicator();
                reject(error);
            }
        });
    }

    /**
     * 执行实际的导出操作
     */
    async performExport() {
        try {
            // 尝试从不同的数据源获取记录
            let practiceRecords = [];
            let examIndex = [];
            
            this.updateProgress('正在加载数据...');
            
            // 让出控制权
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // 首先尝试从storage获取（注意：storage.get 为异步）
            if (this.storage && typeof this.storage.get === 'function') {
                try {
                    const recs = await this.storage.get('practice_records', []);
                    const idx = await this.storage.get('exam_index', []);
                    practiceRecords = Array.isArray(recs) ? recs : [];
                    examIndex = Array.isArray(idx) ? idx : [];
                } catch (_) {
                    practiceRecords = [];
                    examIndex = [];
                }
            }
            
            // 如果storage中没有数据，尝试从全局变量获取
            if ((!Array.isArray(practiceRecords) || practiceRecords.length === 0) && window.practiceRecords) {
                practiceRecords = Array.isArray(window.practiceRecords) ? window.practiceRecords : [];
            }
            
            if ((!Array.isArray(examIndex) || examIndex.length === 0) && window.examIndex) {
                examIndex = Array.isArray(window.examIndex) ? window.examIndex : [];
            }
            
            if (practiceRecords.length === 0) {
                throw new Error('没有练习记录可导出');
            }

            console.log(`[MarkdownExporter] 找到 ${practiceRecords.length} 条记录`);
            
            // 限制记录数量避免卡死
            if (practiceRecords.length > 50) {
                console.warn('[MarkdownExporter] 记录数量过多，只导出最新50条');
                practiceRecords = practiceRecords.slice(0, 50);
            }

            this.updateProgress('正在处理数据...');
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // 使用数据一致性管理器确保数据质量
            if (window.DataConsistencyManager) {
                const manager = new DataConsistencyManager();
                
                // 生成数据质量报告
                const qualityReport = manager.getDataQualityReport(practiceRecords);
                console.log('[MarkdownExporter] 数据质量报告:', qualityReport);
                
                // 修复数据不一致问题
                practiceRecords = await this.processRecordsInBatches(practiceRecords, manager);
                console.log('[MarkdownExporter] 数据一致性修复完成');
                
                // 验证修复结果
                const postFixReport = manager.getDataQualityReport(practiceRecords);
                console.log('[MarkdownExporter] 修复后质量报告:', postFixReport);
            }

            this.updateProgress('正在生成内容...');
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // 按日期分组记录
            const recordsByDate = await this.groupRecordsByDateAsync(practiceRecords, examIndex);
            
            // 生成 Markdown 内容
            const markdownContent = await this.generateMarkdownContentAsync(recordsByDate);
            
            this.updateProgress('正在下载文件...');
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // 下载文件
            this.downloadMarkdownFile(markdownContent);
            
            this.hideProgressIndicator();
            
            return markdownContent;
            
        } catch (error) {
            console.error('Markdown导出失败:', error);
            this.hideProgressIndicator();
            throw error;
        }
    }

    /**
     * 批量处理记录以避免阻塞
     */
    async processRecordsInBatches(practiceRecords, manager) {
        const batchSize = 10;
        const processedRecords = [];
        
        for (let i = 0; i < practiceRecords.length; i += batchSize) {
            const batch = practiceRecords.slice(i, i + batchSize);
            
            for (let j = 0; j < batch.length; j++) {
                const record = batch[j];
                try {
                    const processed = manager.ensureConsistency ? manager.ensureConsistency(record) : record;
                    processedRecords.push(processed);
                } catch (error) {
                    console.warn('[MarkdownExporter] 处理记录失败:', error);
                    processedRecords.push(record); // 使用原始记录
                }
            }
            
            // 每处理一批就让出控制权
            if (i + batchSize < practiceRecords.length) {
                await new Promise(resolve => setTimeout(resolve, 10));
                this.updateProgress(`正在处理数据... (${Math.min(i + batchSize, practiceRecords.length)}/${practiceRecords.length})`);
            }
        }
        
        return processedRecords;
    }

    /**
     * 异步按日期分组记录
     */
    async groupRecordsByDateAsync(practiceRecords, examIndex) {
        const grouped = {};
        
        for (let i = 0; i < practiceRecords.length; i++) {
            const record = practiceRecords[i];
            
            // 获取日期字符串 (YYYY-MM-DD)
            const date = new Date(record.startTime || record.date).toISOString().split('T')[0];
            
            if (!grouped[date]) {
                grouped[date] = [];
            }
            
            // 获取考试信息
            const exam = examIndex.find(e => e.id === record.examId);
            const enhancedRecord = {
                ...record,
                examInfo: exam || {},
                title: exam?.title || record.title || '未知题目',
                category: exam?.category || record.category || 'Unknown',
                frequency: exam?.frequency || record.frequency || 'unknown'
            };
            
            grouped[date].push(enhancedRecord);
            
            // 每处理20条记录就让出控制权
            if (i % 20 === 19) {
                await new Promise(resolve => setTimeout(resolve, 5));
            }
        }
        
        return grouped;
    }

    /**
     * 按日期分组记录（同步版本，保持兼容性）
     */
    groupRecordsByDate(practiceRecords, examIndex) {
        const grouped = {};
        
        practiceRecords.forEach(record => {
            // 获取日期字符串 (YYYY-MM-DD)
            const date = new Date(record.startTime || record.date).toISOString().split('T')[0];
            
            if (!grouped[date]) {
                grouped[date] = [];
            }
            
            // 获取考试信息
            const exam = examIndex.find(e => e.id === record.examId);
            const enhancedRecord = {
                ...record,
                examInfo: exam || {},
                title: exam?.title || record.title || '未知题目',
                category: exam?.category || record.category || 'Unknown',
                frequency: exam?.frequency || record.frequency || 'unknown'
            };
            
            grouped[date].push(enhancedRecord);
        });
        
        return grouped;
    }

    /**
     * 异步生成 Markdown 内容
     */
    async generateMarkdownContentAsync(recordsByDate) {
        let markdown = '# 练习记录导出\n\n';
        markdown += `导出时间: ${new Date().toLocaleString()}\n\n`;
        
        // 按日期排序（最新的在前）
        const sortedDates = Object.keys(recordsByDate).sort((a, b) => b.localeCompare(a));
        
        // 限制处理的日期数量
        const maxDates = 10;
        const datesToProcess = sortedDates.slice(0, maxDates);
        
        if (sortedDates.length > maxDates) {
            console.warn(`[MarkdownExporter] 日期过多，只处理最新${maxDates}天的记录`);
        }
        
        for (let i = 0; i < datesToProcess.length; i++) {
            const date = datesToProcess[i];
            const records = recordsByDate[date];
            
            // 更新进度
            this.updateProgress(`正在处理 ${date} 的记录... (${i + 1}/${datesToProcess.length})`);
            
            // 添加日期标题
            markdown += `## ${date}\n\n`;
            
            // 限制每天的记录数量
            const maxRecordsPerDay = 20;
            const recordsToProcess = records.slice(0, maxRecordsPerDay);
            
            for (let j = 0; j < recordsToProcess.length; j++) {
                const record = recordsToProcess[j];
                try {
                    const recordMarkdown = this.generateRecordMarkdown(record);
                    markdown += recordMarkdown;
                    markdown += '\n\n'; // 记录之间空两行
                } catch (error) {
                    console.warn('[MarkdownExporter] 生成记录Markdown失败:', error);
                    markdown += `### 记录处理失败: ${record.id || 'unknown'}\n\n`;
                }
                
                // 每处理5条记录就让出控制权
                if (j % 5 === 4) {
                    await new Promise(resolve => setTimeout(resolve, 5));
                }
            }
            
            // 每处理完一个日期就让出控制权
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        return markdown;
    }

    /**
     * 生成 Markdown 内容（同步版本，保持兼容性）
     */
    generateMarkdownContent(recordsByDate) {
        let markdown = '# 练习记录导出\n\n';
        markdown += `导出时间: ${new Date().toLocaleString()}\n\n`;
        
        // 按日期排序（最新的在前）
        const sortedDates = Object.keys(recordsByDate).sort((a, b) => b.localeCompare(a));
        
        for (let i = 0; i < sortedDates.length; i++) {
            const date = sortedDates[i];
            const records = recordsByDate[date];
            
            // 添加日期标题
            markdown += `## ${date}\n\n`;
            
            for (let j = 0; j < records.length; j++) {
                const record = records[j];
                markdown += this.generateRecordMarkdown(record);
                markdown += '\n\n'; // 记录之间空两行
            }
        }
        
        return markdown;
    }

    /**
     * 生成单个记录的 Markdown
     */
    generateRecordMarkdown(record) {
        const { title, category, frequency, realData } = record;
        const metrics = this.resolveScoreMetrics(record);
        
        // 标题行
        let markdown = `### ${category}-${frequency}-${title} ${metrics.correct}/${metrics.total} (${metrics.percentage}%)\n\n`;
        
        // 如果有详细答题数据，生成表格
        if (realData && realData.answers && realData.scoreInfo) {
            markdown += this.generateAnswerTable(realData, record);
        } else {
            // 如果没有详细数据，显示基本信息
            markdown += `**分数:** ${metrics.correct}/${metrics.total}\n`;
            markdown += `**准确率:** ${metrics.percentage}%\n`;
            markdown += `**用时:** ${record.duration || 0}秒\n`;
        }
        
        return markdown;
    }

    resolveScoreMetrics(record) {
        const rd = record.realData || {};
        const scoreInfo = record.scoreInfo || rd.scoreInfo || {};

        const totalFromRecord = typeof record.totalQuestions === 'number' ? record.totalQuestions : null;
        const totalFromScoreInfo = typeof scoreInfo.total === 'number' ? scoreInfo.total : null;
        const totalFromAnswers = record.answers ? Object.keys(record.answers).length
            : (rd.answers ? Object.keys(rd.answers).length : null);
        const totalFromComparison = record.answerComparison ? Object.keys(record.answerComparison).length : null;
        let total = totalFromRecord ?? totalFromScoreInfo ?? totalFromAnswers ?? totalFromComparison ?? 0;

        let correct = null;
        if (typeof record.correctAnswers === 'number') correct = record.correctAnswers;
        if (correct == null && typeof scoreInfo.correct === 'number') correct = scoreInfo.correct;
        if (correct == null && typeof record.score === 'number') {
            if (total && record.score <= total) {
                correct = record.score;
            }
        }
        if (correct == null && record.answerComparison) {
            try {
                correct = Object.values(record.answerComparison).filter(item => item && item.isCorrect).length;
            } catch (_) {}
        }
        if (correct == null) correct = 0;

        let percentage = null;
        if (typeof record.percentage === 'number') percentage = record.percentage;
        else if (typeof scoreInfo.percentage === 'number') percentage = scoreInfo.percentage;
        else if (typeof record.accuracy === 'number') percentage = Math.round(record.accuracy * 100);

        if ((!total || total <= 0) && percentage == null) {
            total = totalFromAnswers ?? totalFromComparison ?? 0;
        }
        if ((!total || total <= 0) && correct > 0) {
            total = correct;
        }
        if (!total || total <= 0) total = 0;

        if ((percentage == null || percentage > 100 || percentage < 0) && total > 0) {
            percentage = Math.round((correct / total) * 100);
        }
        if (percentage == null) percentage = 0;

        if (total > 0 && correct > total) {
            // 说明 score 字段可能是百分比
            correct = Math.round((percentage / 100) * total);
        }

        return {
            correct,
            total,
            percentage: Math.max(0, Math.min(100, Math.round(percentage)))
        };
    }

    /**
     * 生成答题表格
     */
    generateAnswerTable(realData, record) {
        try {
            // 优先使用answerComparison数据确保一致性（若有则合并补全缺失正确答案）
            if (record.answerComparison && Object.keys(record.answerComparison).length > 0) {
                const merged = this.mergeComparisonWithCorrections(record);
                return this.generateTableFromComparison(merged);
            }
            
            // 降级到原有逻辑
            const answers = record.answers || realData?.answers || {};
            const correctAnswers = this.getCorrectAnswers(record);
            
            let table = '| Question | Your Answer | Correct Answer | Result |\n';
            table += '| -------- | ----------- | -------------- | ------ |\n';
            
            // 获取所有题目编号并排序
            const questionNumbers = this.extractQuestionNumbers(answers, correctAnswers);
            
            // 限制题目数量避免表格过大
            const maxQuestions = 50;
            const questionsToProcess = questionNumbers.slice(0, maxQuestions);
            
            if (questionNumbers.length > maxQuestions) {
                console.warn(`[MarkdownExporter] 题目过多，只显示前${maxQuestions}题`);
            }
            
            for (let i = 0; i < questionsToProcess.length; i++) {
                const qNum = questionsToProcess[i];
                try {
                    const userAnswer = this.getUserAnswer(answers, qNum);
                    const correctAnswer = this.getCorrectAnswer(correctAnswers, qNum);
                    const result = this.compareAnswers(userAnswer, correctAnswer) ? '✓' : '✗';
                    
                    // 清理答案文本，避免Markdown格式问题
                    const cleanUserAnswer = this.cleanAnswerText(userAnswer || 'No Answer');
                    const cleanCorrectAnswer = this.cleanAnswerText(correctAnswer || 'N/A');
                    
                    table += `| ${qNum} | ${cleanUserAnswer} | ${cleanCorrectAnswer} | ${result} |\n`;
                } catch (error) {
                    console.warn('[MarkdownExporter] 处理题目失败:', qNum, error);
                    table += `| ${qNum} | Error | Error | ✗ |\n`;
                }
            }
            
            return table;
        } catch (error) {
            console.error('[MarkdownExporter] 生成答题表格失败:', error);
            return '答题详情生成失败\n';
        }
    }

    /**
     * 从answerComparison生成表格
     */
    generateTableFromComparison(answerComparison) {
        // 支持将 keys 中的非数字后缀/前缀保留下来，比如 qa/qb 显示为 a/b

        try {
            let table = '| Question | Your Answer | Correct Answer | Result |\n';
            table += '| -------- | ----------- | -------------- | ------ |\n';
            
            // 按问题编号排序
            const sortedKeys = Object.keys(answerComparison).sort((a, b) => {
                const numA = parseInt(a.replace(/\D/g, '')) || 0;
                const numB = parseInt(b.replace(/\D/g, '')) || 0;
                return numA - numB;
            });
            
            // 限制处理的题目数量
            const maxQuestions = 50;
            const keysToProcess = sortedKeys.slice(0, maxQuestions);
            
            for (let i = 0; i < keysToProcess.length; i++) {
                const key = keysToProcess[i];
                try {
                    const comparison = answerComparison[key];
                    // 如果没有数字，fallback 使用去掉前缀 q 的字母编号
                    let questionNum = key.replace(/\D/g, '');
                    if (!questionNum) {
                        questionNum = key.replace(/^q/i, '');
                    }
                    const result = comparison.isCorrect ? '✓' : '✗';
                    
                    // 清理答案文本
                    const cleanUserAnswer = this.cleanAnswerText(comparison.userAnswer || 'No Answer');
                    const cleanCorrectAnswer = this.cleanAnswerText(comparison.correctAnswer || 'N/A');
                    
                    table += `| ${questionNum} | ${cleanUserAnswer} | ${cleanCorrectAnswer} | ${result} |\n`;
                } catch (error) {
                    console.warn('[MarkdownExporter] 处理比较数据失败:', key, error);
                }
            }
            
            return table;
        } catch (error) {
            console.error('[MarkdownExporter] 从比较数据生成表格失败:', error);
            return '答题详情生成失败\n';
        }
    }

    /**
     * 清理答案文本，避免Markdown格式问题
     */
    cleanAnswerText(text) {
        if (!text) return '';
        
        return String(text)
            .replace(/\|/g, '\\|')  // 转义管道符
            .replace(/\n/g, ' ')    // 替换换行符
            .replace(/\r/g, '')     // 移除回车符
            .trim()
            .substring(0, 100);     // 限制长度
    }

    /**
     * 获取正确答案
     */
    getCorrectAnswers(record) {
        // 优先使用顶级的correctAnswers
        if (record.correctAnswers && Object.keys(record.correctAnswers).length > 0) {
            return record.correctAnswers;
        }
        
        // 其次使用realData中的correctAnswers
        if (record.realData && record.realData.correctAnswers && Object.keys(record.realData.correctAnswers).length > 0) {
            return record.realData.correctAnswers;
        }
        
        // 尝试从answerComparison中提取
        if (record.answerComparison) {
            const correctAnswers = {};
            Object.keys(record.answerComparison).forEach(key => {
                const comparison = record.answerComparison[key];
                if (comparison.correctAnswer) {
                    correctAnswers[key] = comparison.correctAnswer;
                }
            });
            if (Object.keys(correctAnswers).length > 0) {
                return correctAnswers;
            }
        }
        
        // 尝试从 scoreInfo 的 details 中获取（优先 realData.scoreInfo，其次顶层 scoreInfo）
        const detailsSources = [];
        if (record.realData && record.realData.scoreInfo && record.realData.scoreInfo.details) {
            detailsSources.push(record.realData.scoreInfo.details);
        }
        if (record.scoreInfo && record.scoreInfo.details) {
            detailsSources.push(record.scoreInfo.details);
        }
        for (const details of detailsSources) {
            const correctAnswers = {};
            Object.keys(details).forEach(key => {
                const detail = details[key];
                if (detail && detail.correctAnswer != null && String(detail.correctAnswer).trim() !== '') {
                    correctAnswers[key] = detail.correctAnswer;
                }
            });
            if (Object.keys(correctAnswers).length > 0) {
                return correctAnswers;
            }
        }
        
        console.warn('[MarkdownExporter] 未找到正确答案数据，记录ID:', record.id);
        return {};
    }

    /**
     * 提取题目编号
     */
    extractQuestionNumbers(userAnswers, correctAnswers) {
        const allQuestions = new Set();
        
        // 从用户答案中提取
        Object.keys(userAnswers).forEach(key => {
            const num = this.extractNumber(key);
            if (num) allQuestions.add(num);
        });
        
        // 从正确答案中提取
        Object.keys(correctAnswers).forEach(key => {
            const num = this.extractNumber(key);
            if (num) allQuestions.add(num);
        });
        
        // 如果没有找到题目，生成默认序号
        if (allQuestions.size === 0) {
            const maxQuestions = Math.max(
                Object.keys(userAnswers).length,
                Object.keys(correctAnswers).length,
                13 // 默认最大题目数
            );
            for (let i = 1; i <= maxQuestions; i++) {
                allQuestions.add(i);
            }
        }
        
        return Array.from(allQuestions).sort((a, b) => a - b);
    }

    /**
     * 从键名中提取数字
     */
    extractNumber(key) {
        const match = key.match(/(\d+)/);
        return match ? parseInt(match[1]) : null;
    }

    /**
     * 获取用户答案
     */
    getUserAnswer(answers, questionNum) {
        // 尝试不同的键名格式
        const possibleKeys = [`q${questionNum}`, `question${questionNum}`, questionNum.toString()];
        
        for (const key of possibleKeys) {
            if (answers[key] !== undefined) {
                const answer = answers[key];
                // 如果是数组（历史记录），取最后一个
                if (Array.isArray(answer)) {
                    return answer[answer.length - 1]?.value || answer[answer.length - 1];
                }
                return answer;
            }
        }
        
        return null;
    }

    /**
     * 获取正确答案
     */
    getCorrectAnswer(correctAnswers, questionNum) {
        const possibleKeys = [`q${questionNum}`, `question${questionNum}`, questionNum.toString()];
        
        for (const key of possibleKeys) {
            if (correctAnswers[key] !== undefined) {
                return correctAnswers[key];
            }
        }
        
        return null;
    }

    /**
     * 比较答案
     */
    compareAnswers(userAnswer, correctAnswer) {
        if (!userAnswer || !correctAnswer) {
            return false;
        }
        
        // 标准化答案进行比较
        const normalize = (str) => String(str).trim().toLowerCase();
        return normalize(userAnswer) === normalize(correctAnswer);
    }

    /**
     * 显示进度指示器
     */
    showProgressIndicator() {
        // 移除已存在的进度指示器
        this.hideProgressIndicator();
        
        const progressHtml = `
            <div id="export-progress-overlay" style="
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 10000;
            ">
                <div style="
                    background: white;
                    padding: 20px;
                    border-radius: 8px;
                    text-align: center;
                    min-width: 300px;
                ">
                    <div style="margin-bottom: 15px;">
                        <div style="
                            width: 40px;
                            height: 40px;
                            border: 4px solid #f3f3f3;
                            border-top: 4px solid #3498db;
                            border-radius: 50%;
                            animation: spin 1s linear infinite;
                            margin: 0 auto;
                        "></div>
                    </div>
                    <div id="export-progress-text">正在准备导出...</div>
                </div>
            </div>
            <style>
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
        `;
        
        document.body.insertAdjacentHTML('beforeend', progressHtml);
    }

    /**
     * 更新进度文本
     */
    updateProgress(text) {
        const progressText = document.getElementById('export-progress-text');
        if (progressText) {
            progressText.textContent = text;
        }
    }

    /**
     * 隐藏进度指示器
     */
    hideProgressIndicator() {
        const overlay = document.getElementById('export-progress-overlay');
        if (overlay) {
            overlay.remove();
        }
    }

    /**
     * 下载 Markdown 文件
     */
    downloadMarkdownFile(content) {
        try {
            const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            
            a.href = url;
            a.download = `ielts-practice-records-${new Date().toISOString().split('T')[0]}.md`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            console.log('[MarkdownExporter] 文件下载完成');
        } catch (error) {
            console.error('[MarkdownExporter] 文件下载失败:', error);
            throw error;
        }
    }
}

// 导出类
window.MarkdownExporter = MarkdownExporter;
