/**
 * 考试扫描器
 * 负责扫描目录、发现新考试文件并验证现有索引
 */
class ExamScanner {
    constructor() {
        this.scanDirectories = ['P1（12+8）', 'P2（14+2）', 'P3 （20+6）'];
        this.supportedFormats = ['.html', '.pdf'];
        this.currentIndex = [];
        this.discoveredExams = [];
        this.scanResults = {
            totalFound: 0,
            newExams: 0,
            existingExams: 0,
            brokenLinks: 0,
            updatedExams: 0
        };
    }

    /**
     * 扫描所有目录寻找考试文件
     */
    async scanAllDirectories() {
        console.log('[ExamScanner] 开始扫描所有目录...');
        
        try {
            // 加载当前索引
            this.currentIndex = window.completeExamIndex || [];
            console.log(`[ExamScanner] 当前索引包含 ${this.currentIndex.length} 个考试`);
            
            // 重置扫描结果
            this.resetScanResults();
            
            // 扫描每个目录
            for (const directory of this.scanDirectories) {
                await this.scanDirectory(directory);
            }
            
            // 生成扫描报告
            const report = this.generateScanReport();
            console.log('[ExamScanner] 扫描完成:', report);
            
            return report;
            
        } catch (error) {
            console.error('[ExamScanner] 扫描过程中发生错误:', error);
            throw error;
        }
    }

    /**
     * 扫描单个目录
     */
    async scanDirectory(directory) {
        console.log(`[ExamScanner] 扫描目录: ${directory}`);
        
        try {
            // 根据目录确定分类
            const category = this.getCategoryFromDirectory(directory);
            
            // 扫描高频和次高频子目录
            const highFreqPath = `${directory}/1.高频(网页由窦立盛老师制作)`;
            const lowFreqPath = `${directory}/2.次高频(网页由窦立盛老师制作)`;
            
            // 特殊处理P3目录的路径
            const p3HighFreqPath = `${directory}/1.高频(网页由🕊️制作)`;
            const p3LowFreqPath = `${directory}/2.次高频(网页由🕊️制作)`;
            
            if (category === 'P3') {
                await this.scanFrequencyDirectory(p3HighFreqPath, category, 'high');
                await this.scanFrequencyDirectory(p3LowFreqPath, category, 'low');
            } else {
                await this.scanFrequencyDirectory(highFreqPath, category, 'high');
                await this.scanFrequencyDirectory(lowFreqPath, category, 'low');
            }
            
        } catch (error) {
            console.error(`[ExamScanner] 扫描目录 ${directory} 时发生错误:`, error);
        }
    }

    /**
     * 扫描频率目录（高频/次高频）
     */
    async scanFrequencyDirectory(frequencyPath, category, frequency) {
        console.log(`[ExamScanner] 扫描频率目录: ${frequencyPath}`);
        
        // 模拟目录扫描 - 在实际环境中需要使用文件系统API
        const knownExams = this.getKnownExamsForPath(frequencyPath, category, frequency);
        
        for (const examInfo of knownExams) {
            await this.processExamDirectory(examInfo, category, frequency);
        }
    }

    /**
     * 获取已知的考试信息（基于实际目录结构）
     */
    getKnownExamsForPath(path, category, frequency) {
        const knownExams = [];
        
        // 根据您提供的目录结构信息，添加已知考试
        if (category === 'P1' && frequency === 'high') {
            knownExams.push(
                { name: 'P1- Katherine Mansfield 新西兰作家', path: `${path}/P1- Katherine Mansfield 新西兰作家/` },
                { name: 'P1 - The Development of Plastics塑料发展', path: `${path}/P1 - The Development of Plastics塑料发展/` }
            );
        }
        
        if (category === 'P2' && frequency === 'high') {
            knownExams.push(
                { name: 'P2 - Mind Music心灵音乐', path: `${path}/P2 - Mind Music心灵音乐/` }
            );
        }
        
        if (category === 'P3' && frequency === 'high') {
            knownExams.push(
                { name: 'P3 - Whale Culture 虎鲸文化', path: `${path}/P3 - Whale Culture 虎鲸文化/` },
                { name: 'P3 - Unlocking the mystery of dreams 梦的解析', path: `${path}/P3 - Unlocking the mystery of dreams 梦的解析/` }
            );
        }
        
        return knownExams;
    }

    /**
     * 处理单个考试目录
     */
    async processExamDirectory(examInfo, category, frequency) {
        console.log(`[ExamScanner] 处理考试: ${examInfo.name}`);
        
        try {
            // 检查是否已在索引中
            const existingExam = this.findExamInIndex(examInfo.name, category);
            
            if (existingExam) {
                console.log(`[ExamScanner] 考试已存在于索引中: ${examInfo.name}`);
                this.scanResults.existingExams++;
                
                // 验证现有考试的文件
                await this.validateExistingExam(existingExam);
            } else {
                console.log(`[ExamScanner] 发现新考试: ${examInfo.name}`);
                this.scanResults.newExams++;
                
                // 创建新考试条目
                const newExam = await this.createExamEntry(examInfo, category, frequency);
                this.discoveredExams.push(newExam);
            }
            
            this.scanResults.totalFound++;
            
        } catch (error) {
            console.error(`[ExamScanner] 处理考试 ${examInfo.name} 时发生错误:`, error);
            this.scanResults.brokenLinks++;
        }
    }

    /**
     * 在索引中查找考试
     */
    findExamInIndex(examName, category) {
        return this.currentIndex.find(exam => {
            // 尝试多种匹配方式
            const normalizedExamName = this.normalizeExamName(examName);
            const normalizedIndexTitle = this.normalizeExamName(exam.title);
            
            return exam.category === category && (
                normalizedIndexTitle.includes(normalizedExamName) ||
                normalizedExamName.includes(normalizedIndexTitle) ||
                exam.title === examName
            );
        });
    }

    /**
     * 标准化考试名称用于匹配
     */
    normalizeExamName(name) {
        return name.toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/[【】\[\]]/g, '')
            .trim();
    }

    /**
     * 验证现有考试
     */
    async validateExistingExam(exam) {
        console.log(`[ExamScanner] 验证现有考试: ${exam.title}`);
        
        try {
            // 检查HTML文件
            if (exam.hasHtml && exam.filename) {
                const htmlPath = exam.path + exam.filename;
                const htmlExists = await this.checkFileExists(htmlPath);
                if (!htmlExists) {
                    console.warn(`[ExamScanner] HTML文件不存在: ${htmlPath}`);
                    this.scanResults.brokenLinks++;
                }
            }
            
            // 检查PDF文件
            if (exam.hasPdf && exam.pdfFilename) {
                const pdfPath = exam.path + exam.pdfFilename;
                const pdfExists = await this.checkFileExists(pdfPath);
                if (!pdfExists) {
                    console.warn(`[ExamScanner] PDF文件不存在: ${pdfPath}`);
                    this.scanResults.brokenLinks++;
                }
            }
            
        } catch (error) {
            console.error(`[ExamScanner] 验证考试 ${exam.title} 时发生错误:`, error);
            this.scanResults.brokenLinks++;
        }
    }

    /**
     * 创建新考试条目
     */
    async createExamEntry(examInfo, category, frequency) {
        console.log(`[ExamScanner] 创建新考试条目: ${examInfo.name}`);
        
        const examId = this.generateExamId(examInfo.name, category, frequency);
        
        // 检测文件类型
        const files = await this.detectExamFiles(examInfo.path);
        
        const examEntry = {
            id: examId,
            title: examInfo.name,
            category: category,
            frequency: frequency,
            path: examInfo.path,
            filename: files.html || '',
            hasHtml: !!files.html,
            hasPdf: !!files.pdf,
            pdfFilename: files.pdf || '',
            isNewlyDiscovered: true,
            discoveryDate: new Date().toISOString(),
            lastValidated: new Date().toISOString(),
            validationStatus: 'pending',
            communicationStatus: 'untested'
        };
        
        console.log(`[ExamScanner] 新考试条目创建完成:`, examEntry);
        return examEntry;
    }

    /**
     * 检测考试目录中的文件
     */
    async detectExamFiles(examPath) {
        console.log(`[ExamScanner] 检测考试文件: ${examPath}`);
        
        const files = {
            html: null,
            pdf: null
        };
        
        // 在实际环境中，这里需要使用文件系统API来检测文件
        // 现在基于已知的文件命名模式进行推测
        
        try {
            // 尝试常见的HTML文件名模式
            const htmlPatterns = [
                'index.html',
                examPath.split('/').pop() + '.html',
                examPath.split('/').pop().replace(/\s+/g, '_') + '.html'
            ];
            
            for (const pattern of htmlPatterns) {
                const htmlPath = examPath + pattern;
                if (await this.checkFileExists(htmlPath)) {
                    files.html = pattern;
                    break;
                }
            }
            
            // 尝试常见的PDF文件名模式
            const pdfPatterns = [
                examPath.split('/').pop() + '.pdf',
                examPath.split('/').pop().replace(/\s+/g, '_') + '.pdf'
            ];
            
            for (const pattern of pdfPatterns) {
                const pdfPath = examPath + pattern;
                if (await this.checkFileExists(pdfPath)) {
                    files.pdf = pattern;
                    break;
                }
            }
            
        } catch (error) {
            console.error(`[ExamScanner] 检测文件时发生错误:`, error);
        }
        
        return files;
    }

    /**
     * 检查文件是否存在
     */
    async checkFileExists(filePath) {
        try {
            // 在浏览器环境中，我们无法直接检查文件系统
            // 这里使用fetch来尝试访问文件
            const response = await fetch(filePath, { method: 'HEAD' });
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    /**
     * 生成考试ID
     */
    generateExamId(examName, category, frequency) {
        const categoryPrefix = category.toLowerCase();
        const frequencyPrefix = frequency === 'high' ? 'high' : 'low';
        const nameHash = this.simpleHash(examName);
        
        return `${categoryPrefix}-${frequencyPrefix}-${nameHash}`;
    }

    /**
     * 简单哈希函数
     */
    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 转换为32位整数
        }
        return Math.abs(hash).toString(36).substr(0, 8);
    }

    /**
     * 从目录名获取分类
     */
    getCategoryFromDirectory(directory) {
        if (directory.includes('P1')) return 'P1';
        if (directory.includes('P2')) return 'P2';
        if (directory.includes('P3')) return 'P3';
        return 'Unknown';
    }

    /**
     * 重置扫描结果
     */
    resetScanResults() {
        this.scanResults = {
            totalFound: 0,
            newExams: 0,
            existingExams: 0,
            brokenLinks: 0,
            updatedExams: 0
        };
        this.discoveredExams = [];
    }

    /**
     * 生成扫描报告
     */
    generateScanReport() {
        const report = {
            scanId: `scan_${Date.now()}`,
            scanTime: new Date().toISOString(),
            scannedDirectories: this.scanDirectories,
            discoveredExams: this.discoveredExams,
            statistics: this.scanResults,
            summary: `扫描完成：发现 ${this.scanResults.totalFound} 个考试，其中 ${this.scanResults.newExams} 个新考试，${this.scanResults.existingExams} 个已存在，${this.scanResults.brokenLinks} 个链接问题`
        };
        
        return report;
    }

    /**
     * 发现新考试
     */
    async discoverNewExams() {
        console.log('[ExamScanner] 开始发现新考试...');
        
        const scanReport = await this.scanAllDirectories();
        
        return {
            newExams: this.discoveredExams,
            report: scanReport
        };
    }

    /**
     * 验证考试文件列表
     */
    async validateExamFiles(examList) {
        console.log(`[ExamScanner] 开始验证 ${examList.length} 个考试文件...`);
        
        const validationResults = [];
        
        for (const exam of examList) {
            const result = await this.validateSingleExam(exam);
            validationResults.push(result);
        }
        
        return validationResults;
    }

    /**
     * 验证单个考试
     */
    async validateSingleExam(exam) {
        console.log(`[ExamScanner] 验证考试: ${exam.title}`);
        
        const result = {
            examId: exam.id,
            examTitle: exam.title,
            status: 'valid',
            issues: [],
            accessibility: {
                htmlFile: 'not_checked',
                pdfFile: 'not_checked'
            }
        };
        
        try {
            // 验证HTML文件
            if (exam.hasHtml && exam.filename) {
                const htmlPath = exam.path + exam.filename;
                const htmlExists = await this.checkFileExists(htmlPath);
                result.accessibility.htmlFile = htmlExists ? 'accessible' : 'not_found';
                
                if (!htmlExists) {
                    result.status = 'invalid';
                    result.issues.push({
                        type: 'file_not_found',
                        severity: 'error',
                        message: `HTML文件不存在: ${htmlPath}`,
                        fixable: true,
                        suggestedFix: '检查文件路径和文件名是否正确'
                    });
                }
            }
            
            // 验证PDF文件
            if (exam.hasPdf && exam.pdfFilename) {
                const pdfPath = exam.path + exam.pdfFilename;
                const pdfExists = await this.checkFileExists(pdfPath);
                result.accessibility.pdfFile = pdfExists ? 'accessible' : 'not_found';
                
                if (!pdfExists) {
                    if (result.status === 'valid') result.status = 'warning';
                    result.issues.push({
                        type: 'file_not_found',
                        severity: 'warning',
                        message: `PDF文件不存在: ${pdfPath}`,
                        fixable: true,
                        suggestedFix: '检查PDF文件路径和文件名是否正确'
                    });
                }
            }
            
        } catch (error) {
            result.status = 'invalid';
            result.issues.push({
                type: 'validation_error',
                severity: 'error',
                message: `验证过程中发生错误: ${error.message}`,
                fixable: false,
                suggestedFix: '请检查考试配置和文件权限'
            });
        }
        
        return result;
    }

    /**
     * 更新考试索引
     */
    updateExamIndex(newExams) {
        console.log(`[ExamScanner] 更新考试索引，添加 ${newExams.length} 个新考试`);
        
        try {
            // 获取当前索引
            const currentIndex = window.completeExamIndex || [];
            
            // 添加新考试
            const updatedIndex = [...currentIndex, ...newExams];
            
            // 更新全局索引
            window.completeExamIndex = updatedIndex;
            
            // 触发索引更新事件
            const event = new CustomEvent('examIndexUpdated', {
                detail: {
                    newExams: newExams,
                    totalExams: updatedIndex.length
                }
            });
            document.dispatchEvent(event);
            
            console.log(`[ExamScanner] 索引更新完成，当前总数: ${updatedIndex.length}`);
            
            return {
                success: true,
                totalExams: updatedIndex.length,
                newExamsAdded: newExams.length
            };
            
        } catch (error) {
            console.error('[ExamScanner] 更新索引时发生错误:', error);
            throw error;
        }
    }
}

// 导出类
window.ExamScanner = ExamScanner;