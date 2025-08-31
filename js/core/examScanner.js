/**
 * 题库扫描器
 * 负责扫描和索引所有考试文件
 */
class ExamScanner {
    constructor() {
        this.examIndex = [];
        this.scanProgress = 0;
        this.isScanning = false;
        this.categories = ['P1（12+8）', 'P2（14+2）', 'P3 （20+6）'];
        this.frequencies = ['1.高频', '2.次高频'];
    }

    /**
     * 扫描题库
     */
    async scanExamLibrary() {
        if (this.isScanning) return;
        
        try {
            this.isScanning = true;
            console.log('Starting exam library scan...');
            
            // 检查是否已有缓存的索引
            const cachedIndex = storage.get('exam_index');
            const lastScanTime = storage.get('last_scan_time');
            const now = Date.now();
            
            // 如果缓存存在且不超过24小时，使用缓存
            if (cachedIndex && lastScanTime && (now - lastScanTime) < 24 * 60 * 60 * 1000) {
                this.examIndex = cachedIndex;
                console.log('Using cached exam index');
                return this.examIndex;
            }
            
            // 执行扫描
            await this.performScan();
            
            // 保存索引和扫描时间
            storage.set('exam_index', this.examIndex);
            storage.set('last_scan_time', now);
            
            console.log(`Scan completed. Found ${this.examIndex.length} exams.`);
            return this.examIndex;
            
        } catch (error) {
            console.error('Exam library scan failed:', error);
            window.handleError(error, 'Exam Scanner');
            
            // 如果扫描失败，尝试使用缓存的索引
            const cachedIndex = storage.get('exam_index', []);
            this.examIndex = cachedIndex;
            return this.examIndex;
            
        } finally {
            this.isScanning = false;
        }
    }

    /**
     * 执行实际的扫描操作
     */
    async performScan() {
        this.examIndex = [];
        this.scanProgress = 0;
        
        try {
            // 扫描所有分类目录
            for (let i = 0; i < this.categories.length; i++) {
                const category = this.categories[i];
                console.log(`Scanning category: ${category}`);
                
                await this.scanCategory(category);
                this.scanProgress = Math.floor(((i + 1) / this.categories.length) * 100);
            }
            
            console.log(`Scan completed. Found ${this.examIndex.length} exams.`);
        } catch (error) {
            console.error('Error during scan:', error);
            // 如果扫描失败，使用静态索引作为后备
            this.examIndex = this.getStaticExamIndex();
        }
    }

    /**
     * 扫描单个分类目录
     */
    async scanCategory(categoryPath) {
        const categoryName = this.extractCategoryName(categoryPath);
        
        for (const freqDir of this.frequencies) {
            const fullFreqPath = `${categoryPath}/${freqDir}`;
            const frequency = freqDir.includes('高频') ? 'high' : 'low';
            
            try {
                await this.scanFrequencyDirectory(fullFreqPath, categoryName, frequency);
            } catch (error) {
                console.warn(`Failed to scan ${fullFreqPath}:`, error);
            }
        }
    }

    /**
     * 扫描频率目录
     */
    async scanFrequencyDirectory(frequencyPath, category, frequency) {
        // 由于浏览器安全限制，我们需要使用已知的目录结构
        // 这里基于实际的文件结构创建扫描逻辑
        const examDirs = await this.getExamDirectories(frequencyPath, category, frequency);
        
        for (const examDir of examDirs) {
            try {
                const examInfo = await this.scanExamDirectory(examDir, category, frequency);
                if (examInfo) {
                    this.examIndex.push(examInfo);
                }
            } catch (error) {
                console.warn(`Failed to scan exam directory ${examDir.path}:`, error);
            }
        }
    }

    /**
     * 获取考试目录列表
     */
    async getExamDirectories(frequencyPath, category, frequency) {
        // 基于已知结构返回目录列表
        const examDirs = [];
        
        if (category === 'P1' && frequency === 'high') {
            examDirs.push(
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/1.A Brief History of Tea 茶叶简史`, name: 'A Brief History of Tea 茶叶简史' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/2.Fishbourne Roman Palace 菲什本罗马宫殿(躺)`, name: 'Fishbourne Roman Palace 菲什本罗马宫殿' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/3.Listening to the Ocean 聆听海洋`, name: 'Listening to the Ocean 聆听海洋' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/4.Rubber 橡胶`, name: 'Rubber 橡胶' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/5.Sydney Opera House 悉尼歌剧院`, name: 'Sydney Opera House 悉尼歌剧院' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/6.The Blockbuster Phenomenon 大片现象(躺)`, name: 'The Blockbuster Phenomenon 大片现象' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/7.The Development of The Silk Industry 丝绸工业的发展`, name: 'The Development of The Silk Industry 丝绸工业的发展' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/8.The History of Tea 茶叶的历史`, name: 'The History of Tea 茶叶的历史' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/9.The Pearls 珍珠`, name: 'The Pearls 珍珠' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/10.The Tuatara of New Zealand 新西兰的喙头蜥`, name: 'The Tuatara of New Zealand 新西兰的喙头蜥' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/11.William Gilbert and Magnetism 威廉・吉尔伯特与磁学`, name: 'William Gilbert and Magnetism 威廉・吉尔伯特与磁学' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/12.Wood a valuable resource in New Zealand's economy 木材：新西兰经济中的宝贵资源(躺)`, name: 'Wood a valuable resource in New Zealand\'s economy 木材：新西兰经济中的宝贵资源' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/P1 - The Development of Plastics塑料发展`, name: 'The Development of Plastics 塑料发展' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/P1- Katherine Mansfield 新西兰作家`, name: 'Katherine Mansfield 新西兰作家' }
            );
        } else if (category === 'P1' && frequency === 'low') {
            examDirs.push(
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/1.A survivor's story 幸存者的故事（躺）`, name: 'A survivor\'s story 幸存者的故事' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/2.Ambergris 龙涎香`, name: 'Ambergris 龙涎香' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/3.The Impact of the Potato 土豆的影响`, name: 'The Impact of the Potato 土豆的影响' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/4.The Importance of Business Cards 名片的重要性`, name: 'The Importance of Business Cards 名片的重要性' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/5.The Origin of Paper 纸的起源`, name: 'The Origin of Paper 纸的起源' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/6.The Rise and Fall of Detective Stories 侦探小说的兴衰`, name: 'The Rise and Fall of Detective Stories 侦探小说的兴衰' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/7.Thomas Young The last man who knew everything 托马斯・杨 —— 最后一位全才`, name: 'Thomas Young The last man who knew everything 托马斯・杨 —— 最后一位全才' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/8.Book review：Triumph of the City 书评：城市的胜利(躺)`, name: 'Book review：Triumph of the City 书评：城市的胜利' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/9.Footprints in the Mud`, name: 'Footprints in the Mud' }
            );
        } else if (category === 'P2' && frequency === 'high') {
            examDirs.push(
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/1.A new look for Talbot Park 塔尔博特公园的新面貌`, name: 'A new look for Talbot Park 塔尔博特公园的新面貌' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/2.A unique golden textile 一种独特的金色纺织品`, name: 'A unique golden textile 一种独特的金色纺织品' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/3.Bird Migration 鸟类迁徙`, name: 'Bird Migration 鸟类迁徙' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/4.Corporate Social Responsibility 企业社会责任（躺）`, name: 'Corporate Social Responsibility 企业社会责任' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/5.How are deserts formed 沙漠是如何形成的`, name: 'How are deserts formed 沙漠是如何形成的' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/6.How Well Do We Concentrate_ 我们的注意力有多集中？`, name: 'How Well Do We Concentrate? 我们的注意力有多集中？' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/7.Learning from the Romans 向罗马人学习(古老建材)(躺)`, name: 'Learning from the Romans 向罗马人学习' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/8.Playing soccer 踢足球_街头足球`, name: 'Playing soccer 踢足球' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/9.Roller coaster 过山车`, name: 'Roller coaster 过山车' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/10.Investment in shares versus investment in other assets 股票投资与其他资产投资对比`, name: 'Investment in shares versus investment in other assets 股票投资与其他资产投资对比' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/11.The conquest of malaria in Italy 意大利疟疾的征服`, name: 'The conquest of malaria in Italy 意大利疟疾的征服' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/12.The plan to bring an asteroid to Earth 将小行星引至地球的计划`, name: 'The plan to bring an asteroid to Earth 将小行星引至地球的计划' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/13.The return of monkey life 猴类生命的回归`, name: 'The return of monkey life 猴类生命的回归' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/14.The Tasmanian Tiger 塔斯马尼亚虎`, name: 'The Tasmanian Tiger 塔斯马尼亚虎' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/15.Stress Less`, name: 'Stress Less' }
            );
        } else if (category === 'P2' && frequency === 'low') {
            examDirs.push(
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/1.Intelligent behaviour in birds 鸟类的智能行为（躺）`, name: 'Intelligent behaviour in birds 鸟类的智能行为' },
                { path: `${frequencyPath}/(网页由窦立盛老师制作)/2.The fascinating world of attine ants 切叶蚁的奇妙世界(躺)`, name: 'The fascinating world of attine ants 切叶蚁的奇妙世界' }
            );
        } else if (category === 'P3' && frequency === 'high') {
            examDirs.push(
                { path: `${frequencyPath}/(网页由🕊️制作)/1.A closer examination of a study on verbal and non - verbal messages 语言与非语言信息研究审视`, name: 'A closer examination of a study on verbal and non-verbal messages 语言与非语言信息研究审视' },
                { path: `${frequencyPath}/(网页由🕊️制作)/2.Flower Power 花之力`, name: 'Flower Power 花之力' },
                { path: `${frequencyPath}/(网页由🕊️制作)/3.Grimm's Fairy Tales 格林童话(网页由SEVEN老师制作)`, name: 'Grimm\'s Fairy Tales 格林童话' },
                { path: `${frequencyPath}/(网页由🕊️制作)/4.Insect - inspired robots 受昆虫启发的机器人`, name: 'Insect-inspired robots 受昆虫启发的机器人' },
                { path: `${frequencyPath}/(网页由🕊️制作)/5.Jean Piaget (1896 - 1980) 让・皮亚杰（1896 - 1980）`, name: 'Jean Piaget (1896-1980) 让・皮亚杰' },
                { path: `${frequencyPath}/(网页由🕊️制作)/6.Music Language We All Speak 音乐语言`, name: 'Music Language We All Speak 音乐语言' },
                { path: `${frequencyPath}/(网页由🕊️制作)/7.Pacific Navigation and Voyaging 太平洋导航与航海(躺)`, name: 'Pacific Navigation and Voyaging 太平洋导航与航海' },
                { path: `${frequencyPath}/(网页由🕊️制作)/8.Robert Louis Stevenson罗伯特・路易斯・史蒂文森(苏格兰作家)`, name: 'Robert Louis Stevenson 罗伯特・路易斯・史蒂文森' },
                { path: `${frequencyPath}/(网页由🕊️制作)/9.The Analysis of Fear 恐惧分析(躺)`, name: 'The Analysis of Fear 恐惧分析' },
                { path: `${frequencyPath}/(网页由🕊️制作)/10.The Art of Deception 欺骗的艺术`, name: 'The Art of Deception 欺骗的艺术' },
                { path: `${frequencyPath}/(网页由🕊️制作)/11.The benefits of learning an instrument 学习乐器的益处`, name: 'The benefits of learning an instrument 学习乐器的益处' },
                { path: `${frequencyPath}/(网页由🕊️制作)/12.The Fruit Book 水果之书`, name: 'The Fruit Book 水果之书' },
                { path: `${frequencyPath}/(网页由🕊️制作)/13.The New Zealand writer Margaret Mahy 新西兰作家玛格丽特・梅希`, name: 'The New Zealand writer Margaret Mahy 新西兰作家玛格丽特・梅希' },
                { path: `${frequencyPath}/(网页由🕊️制作)/14.The Pirahã people of Brazil 巴西的皮拉哈人(躺)`, name: 'The Pirahã people of Brazil 巴西的皮拉哈人' },
                { path: `${frequencyPath}/(网页由🕊️制作)/15.The Robbers Cave Study 罗伯斯洞穴研究`, name: 'The Robbers Cave Study 罗伯斯洞穴研究' },
                { path: `${frequencyPath}/(网页由🕊️制作)/16.The Significant Role of Mother Tongue in Education 母语在教育中的作用(躺)`, name: 'The Significant Role of Mother Tongue in Education 母语在教育中的作用' },
                { path: `${frequencyPath}/(网页由🕊️制作)/17.The tuatara – past and future 喙头蜥 —— 过去与未来`, name: 'The tuatara – past and future 喙头蜥 —— 过去与未来' },
                { path: `${frequencyPath}/(网页由🕊️制作)/18.Voynich Manuscript 伏尼契手稿(躺)`, name: 'Voynich Manuscript 伏尼契手稿' },
                { path: `${frequencyPath}/(网页由🕊️制作)/19.What makes a musical expert_ 是什么造就了音乐专家？`, name: 'What makes a musical expert? 是什么造就了音乐专家？' },
                { path: `${frequencyPath}/(网页由🕊️制作)/20.Yawning 打哈欠`, name: 'Yawning 打哈欠' },
                { path: `${frequencyPath}/(网页由🕊️制作)/21.Neanderthal Technology`, name: 'Neanderthal Technology' },
                { path: `${frequencyPath}/(网页由🕊️制作)/P3 - Science and Filmmaking 电影科学`, name: 'Science and Filmmaking 电影科学' },
                { path: `${frequencyPath}/(网页由🕊️制作)/P3 - Humanities and the health professional(0811)人文医学`, name: 'Humanities and the health professional 人文医学' },
                { path: `${frequencyPath}/(网页由🕊️制作)/P3 - Star Performers(0808)明星员工`, name: 'Star Performers 明星员工' },
                { path: `${frequencyPath}/(网页由🕊️制作)/P3 - Unlocking the mystery of dreams 梦的解析`, name: 'Unlocking the mystery of dreams 梦的解析' },
                { path: `${frequencyPath}/(网页由🕊️制作)/P3 - Whale Culture 虎鲸文化`, name: 'Whale Culture 虎鲸文化' }
            );
        } else if (category === 'P3' && frequency === 'low') {
            examDirs.push(
                { path: `${frequencyPath}/(网页由🕊️制作)/1.Book Review The Discovery of Slowness 书评 _慢的发现_`, name: 'Book Review The Discovery of Slowness 书评 慢的发现' },
                { path: `${frequencyPath}/(网页由🕊️制作)/2.Charles Darwin and Evolutionary Psychology 查尔斯・达尔文与进化心理学`, name: 'Charles Darwin and Evolutionary Psychology 查尔斯・达尔文与进化心理学' },
                { path: `${frequencyPath}/(网页由🕊️制作)/3.Does class size matter_ 班级规模重要吗？`, name: 'Does class size matter? 班级规模重要吗？' },
                { path: `${frequencyPath}/(网页由🕊️制作)/4.Marketing and the information age 营销与信息时代(躺)`, name: 'Marketing and the information age 营销与信息时代' },
                { path: `${frequencyPath}/(网页由🕊️制作)/5.The fluoridation controversy 氟化争议（躺）`, name: 'The fluoridation controversy 氟化争议' },
                { path: `${frequencyPath}/(网页由🕊️制作)/6.Video Games' Unexpected Benefits to the Human Brain 电子游戏对人类大脑的意外益处`, name: 'Video Games\' Unexpected Benefits to the Human Brain 电子游戏对人类大脑的意外益处' },
                { path: `${frequencyPath}/(网页由🕊️制作)/7.Images and Places`, name: 'Images and Places' },
                { path: `${frequencyPath}/(网页由🕊️制作)/P3 - Images and Places(8.24)风景与印记`, name: 'Images and Places 风景与印记' }
            );
        }
        
        return examDirs;
    }

    /**
     * 扫描单个考试目录
     */
    async scanExamDirectory(examDir, category, frequency) {
        try {
            // 查找HTML文件
            const htmlFile = await this.findHtmlFile(examDir.path, examDir.name, category, frequency);
            if (!htmlFile) {
                console.warn(`No HTML file found in ${examDir.path}`);
                return null;
            }

            // 解析HTML文件获取题目信息
            const examInfo = await this.parseExamFile(htmlFile, examDir, category, frequency);
            return examInfo;
            
        } catch (error) {
            console.error(`Error scanning exam directory ${examDir.path}:`, error);
            return null;
        }
    }

    /**
     * 查找HTML文件
     */
    async findHtmlFile(examPath, examName, category, frequency) {
        // 基于命名规律构造HTML文件路径
        const freqLabel = frequency === 'high' ? '高' : '次';
        
        // 从examName中提取英文标题部分
        const englishTitle = this.extractEnglishTitle(examName);
        
        // 尝试不同的文件名格式，基于实际观察到的命名模式
        const possibleNames = [
            `${category} - ${englishTitle}【${freqLabel}】.html`,
            `${category} - ${examName}【${freqLabel}】.html`,
            `${englishTitle}.html`,
            `${examName}.html`,
            // 特殊命名格式
            `0828 ${category} - ${englishTitle}.html`, // Science and Filmmaking格式
            `${category} - ${englishTitle}【${freqLabel}】(SEVEN老师制作).html`, // Grimm's Fairy Tales格式
            `${category} - ${englishTitle}(0811).html`, // Humanities格式
            `${category} - ${englishTitle}(0808).html`, // Star Performers格式
            `${category} - ${englishTitle} 梦的解析.html`, // Dreams格式
            `${category} - ${englishTitle} 虎鲸文化.html`, // Whale Culture格式
            `${category} - ${englishTitle}（0824）.html`, // Images and Places格式
            `Images and Places.html` // 简化格式
        ];
        
        for (const fileName of possibleNames) {
            const fullPath = `${examPath}/${fileName}`;
            if (await this.fileExists(fullPath)) {
                return fullPath;
            }
        }
        
        return null;
    }

    /**
     * 从题目名称中提取英文标题
     */
    extractEnglishTitle(examName) {
        // 移除中文部分和特殊标记
        let title = examName.replace(/\s*[（(]躺[）)]\s*/, '');
        
        // 如果包含中文，提取英文部分
        const parts = title.split(/\s+/);
        const englishParts = [];
        
        for (const part of parts) {
            // 如果包含中文字符，停止添加
            if (/[\u4e00-\u9fff]/.test(part)) {
                break;
            }
            englishParts.push(part);
        }
        
        return englishParts.length > 0 ? englishParts.join(' ') : title;
    }

    /**
     * 检查文件是否存在
     */
    async fileExists(filePath) {
        try {
            const response = await fetch(filePath, { method: 'HEAD' });
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    /**
     * 解析考试HTML文件
     */
    async parseExamFile(filePath, examDir, category, frequency) {
        try {
            const response = await fetch(filePath);
            if (!response.ok) {
                throw new Error(`Failed to fetch ${filePath}: ${response.status}`);
            }
            
            const htmlContent = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlContent, 'text/html');
            
            // 提取题目信息
            const title = this.extractTitle(doc, examDir.name);
            const questionTypes = this.extractQuestionTypes(doc);
            const totalQuestions = this.extractTotalQuestions(doc);
            const tags = this.extractTags(doc, examDir.name);
            const description = this.generateDescription(examDir.name, questionTypes);
            
            // 生成唯一ID
            const id = this.generateExamId(category, frequency, examDir.name);
            
            // 生成扩展元数据
            const extendedMetadata = this.generateExtendedMetadata(doc, examDir.name, questionTypes, tags);
            
            return {
                id,
                title,
                category,
                frequency,
                path: examDir.path,
                filename: filePath.split('/').pop(),
                questionTypes,
                totalQuestions,
                estimatedTime: this.estimateTime(totalQuestions, category),
                difficulty: this.determineDifficulty(category),
                tags,
                description,
                lastUpdated: new Date().toISOString(),
                
                // 扩展元数据
                metadata: extendedMetadata,
                
                // 分类信息
                classification: {
                    primaryTopic: extendedMetadata.primaryTopic,
                    academicField: extendedMetadata.academicField,
                    sourceType: extendedMetadata.sourceType,
                    geographicalFocus: extendedMetadata.geographicalFocus,
                    timeContext: extendedMetadata.timeContext
                }
            };
            
        } catch (error) {
            console.error(`Error parsing exam file ${filePath}:`, error);
            return null;
        }
    }

    /**
     * 获取静态题目索引
     * 基于已知的文件结构创建题目索引
     */
    getStaticExamIndex() {
        return [
            // P1 高频题目
            {
                id: 'p1-high-tea-history',
                title: 'A Brief History of Tea 茶叶简史',
                category: 'P1',
                frequency: 'high',
                path: 'P1（12+8）/1.高频(网页由窦立盛老师制作)/1.A Brief History of Tea 茶叶简史/',
                filename: 'P1 - A Brief History of Tea【高】.html',
                questionTypes: ['heading-matching', 'country-matching'],
                totalQuestions: 13,
                estimatedTime: 20,
                difficulty: 'medium',
                tags: ['history', 'culture'],
                description: '关于茶叶历史发展的阅读理解题目'
            },
            {
                id: 'p1-high-fishbourne-palace',
                title: 'Fishbourne Roman Palace 菲什本罗马宫殿',
                category: 'P1',
                frequency: 'high',
                path: 'P1（12+8）/1.高频(网页由窦立盛老师制作)/2.Fishbourne Roman Palace 菲什本罗马宫殿(躺)/',
                filename: 'P1 - Fishbourne Roman Palace【高】.html',
                questionTypes: ['heading-matching', 'true-false-not-given'],
                totalQuestions: 13,
                estimatedTime: 20,
                difficulty: 'medium',
                tags: ['history', 'architecture'],
                description: '关于罗马宫殿考古发现的阅读理解'
            },
            {
                id: 'p1-high-listening-ocean',
                title: 'Listening to the Ocean 聆听海洋',
                category: 'P1',
                frequency: 'high',
                path: 'P1（12+8）/1.高频(网页由窦立盛老师制作)/3.Listening to the Ocean 聆听海洋/',
                filename: 'P1 - Listening to the Ocean【高】.html',
                questionTypes: ['heading-matching', 'summary-completion'],
                totalQuestions: 13,
                estimatedTime: 20,
                difficulty: 'medium',
                tags: ['science', 'ocean'],
                description: '关于海洋声学研究的科学文章'
            },
            
            // P2 高频题目
            {
                id: 'p2-high-talbot-park',
                title: 'A new look for Talbot Park 塔尔博特公园的新面貌',
                category: 'P2',
                frequency: 'high',
                path: 'P2（14+2）/1.高频(网页由窦立盛老师制作)/1.A new look for Talbot Park 塔尔博特公园的新面貌/',
                filename: 'P2 - A new look for Talbot Park【高】.html',
                questionTypes: ['heading-matching', 'matching-people-ideas', 'summary-completion'],
                totalQuestions: 13,
                estimatedTime: 20,
                difficulty: 'medium',
                tags: ['urban-planning', 'social-issues'],
                description: '关于城市住房项目改造的案例研究'
            },
            {
                id: 'p2-high-golden-textile',
                title: 'A unique golden textile 一种独特的金色纺织品',
                category: 'P2',
                frequency: 'high',
                path: 'P2（14+2）/1.高频(网页由窦立盛老师制作)/2.A unique golden textile 一种独特的金色纺织品/',
                filename: 'P2 - A unique golden textile【高】.html',
                questionTypes: ['heading-matching', 'multiple-choice'],
                totalQuestions: 13,
                estimatedTime: 20,
                difficulty: 'medium',
                tags: ['technology', 'materials'],
                description: '关于特殊纺织材料的科技文章'
            },
            
            // P3 高频题目
            {
                id: 'p3-high-verbal-nonverbal',
                title: 'A closer examination of a study on verbal and non-verbal messages 语言与非语言信息研究审视',
                category: 'P3',
                frequency: 'high',
                path: 'P3 （20+6）/1.高频(网页由🕊️制作)/1.A closer examination of a study on verbal and non - verbal messages 语言与非语言信息研究审视/',
                filename: 'P3 - A closer examination of a study on verbal and non-verbal messages【高】.html',
                questionTypes: ['heading-matching', 'multiple-choice', 'summary-completion'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['psychology', 'communication'],
                description: '关于语言和非语言交流的心理学研究'
            },
            {
                id: 'p3-high-flower-power',
                title: 'Flower Power 花之力',
                category: 'P3',
                frequency: 'high',
                path: 'P3 （20+6）/1.高频(网页由🕊️制作)/2.Flower Power 花之力/',
                filename: 'P3 - Flower Power【高】.html',
                questionTypes: ['heading-matching', 'yes-no-not-given'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['biology', 'ecology'],
                description: '关于植物生态作用的生物学文章'
            },
            {
                id: 'p3-high-grimms-fairy-tales',
                title: 'Grimm\'s Fairy Tales 格林童话',
                category: 'P3',
                frequency: 'high',
                path: 'P3 （20+6）/1.高频(网页由🕊️制作)/3.Grimm\'s Fairy Tales 格林童话(网页由SEVEN老师制作)/',
                filename: 'P3 - Grimm\'s Fairy Tales【高】(SEVEN老师制作).html',
                questionTypes: ['heading-matching', 'multiple-choice'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['literature', 'culture'],
                description: '关于格林童话的文学研究'
            },
            {
                id: 'p3-high-insect-robots',
                title: 'Insect-inspired robots 受昆虫启发的机器人',
                category: 'P3',
                frequency: 'high',
                path: 'P3 （20+6）/1.高频(网页由🕊️制作)/4.Insect - inspired robots 受昆虫启发的机器人/',
                filename: 'P3 - Insect-inspired robots【高】.html',
                questionTypes: ['heading-matching', 'summary-completion'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['technology', 'robotics'],
                description: '关于仿生机器人技术的科学文章'
            },
            {
                id: 'p3-high-jean-piaget',
                title: 'Jean Piaget (1896-1980) 让・皮亚杰',
                category: 'P3',
                frequency: 'high',
                path: 'P3 （20+6）/1.高频(网页由🕊️制作)/5.Jean Piaget (1896 - 1980) 让・皮亚杰（1896 - 1980）/',
                filename: 'P3 - Jean Piaget (1896–1980)【高】.html',
                questionTypes: ['heading-matching', 'true-false-not-given'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['psychology', 'education'],
                description: '关于心理学家让・皮亚杰的传记文章'
            },
            {
                id: 'p3-high-music-language',
                title: 'Music Language We All Speak 音乐语言',
                category: 'P3',
                frequency: 'high',
                path: 'P3 （20+6）/1.高频(网页由🕊️制作)/6.Music Language We All Speak 音乐语言/',
                filename: 'P3 - Music Language We All Speak【高】.html',
                questionTypes: ['heading-matching', 'multiple-choice'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['music', 'psychology'],
                description: '关于音乐作为通用语言的研究'
            },
            {
                id: 'p3-high-pacific-navigation',
                title: 'Pacific Navigation and Voyaging 太平洋导航与航海',
                category: 'P3',
                frequency: 'high',
                path: 'P3 （20+6）/1.高频(网页由🕊️制作)/7.Pacific Navigation and Voyaging 太平洋导航与航海(躺)/',
                filename: 'P3 - Pacific Navigation and Voyaging【高】.html',
                questionTypes: ['heading-matching', 'summary-completion'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['history', 'navigation'],
                description: '关于太平洋航海技术的历史文章'
            },
            {
                id: 'p3-high-robert-stevenson',
                title: 'Robert Louis Stevenson 罗伯特・路易斯・史蒂文森',
                category: 'P3',
                frequency: 'high',
                path: 'P3 （20+6）/1.高频(网页由🕊️制作)/8.Robert Louis Stevenson罗伯特・路易斯・史蒂文森(苏格兰作家)/',
                filename: 'P3 - Robert Louis Stevenson【高】.html',
                questionTypes: ['heading-matching', 'multiple-choice'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['literature', 'biography'],
                description: '关于苏格兰作家史蒂文森的传记'
            },
            {
                id: 'p3-high-analysis-fear',
                title: 'The Analysis of Fear 恐惧分析',
                category: 'P3',
                frequency: 'high',
                path: 'P3 （20+6）/1.高频(网页由🕊️制作)/9.The Analysis of Fear 恐惧分析(躺)/',
                filename: 'P3 - The Analysis of Fear【高】.html',
                questionTypes: ['heading-matching', 'yes-no-not-given'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['psychology', 'emotion'],
                description: '关于恐惧心理的科学分析'
            },
            {
                id: 'p3-high-art-deception',
                title: 'The Art of Deception 欺骗的艺术',
                category: 'P3',
                frequency: 'high',
                path: 'P3 （20+6）/1.高频(网页由🕊️制作)/10.The Art of Deception 欺骗的艺术/',
                filename: 'P3 - The Art of Deception【高】.html',
                questionTypes: ['heading-matching', 'multiple-choice'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['psychology', 'behavior'],
                description: '关于欺骗行为的心理学研究'
            },
            {
                id: 'p3-high-learning-instrument',
                title: 'The benefits of learning an instrument 学习乐器的益处',
                category: 'P3',
                frequency: 'high',
                path: 'P3 （20+6）/1.高频(网页由🕊️制作)/11.The benefits of learning an instrument 学习乐器的益处/',
                filename: 'P3 - The benefits of learning an instrument【高】.html',
                questionTypes: ['heading-matching', 'summary-completion'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['education', 'music'],
                description: '关于学习乐器对大脑发展益处的研究'
            },
            {
                id: 'p3-high-fruit-book',
                title: 'The Fruit Book 水果之书',
                category: 'P3',
                frequency: 'high',
                path: 'P3 （20+6）/1.高频(网页由🕊️制作)/12.The Fruit Book 水果之书/',
                filename: 'P3 - The Fruit Book【高】.html',
                questionTypes: ['heading-matching', 'multiple-choice'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['biology', 'agriculture'],
                description: '关于水果种类和营养的科学文章'
            },
            {
                id: 'p3-high-margaret-mahy',
                title: 'The New Zealand writer Margaret Mahy 新西兰作家玛格丽特・梅希',
                category: 'P3',
                frequency: 'high',
                path: 'P3 （20+6）/1.高频(网页由🕊️制作)/13.The New Zealand writer Margaret Mahy 新西兰作家玛格丽特・梅希/',
                filename: 'P3 - The New Zealand writer Margaret Mahy【高】.html',
                questionTypes: ['heading-matching', 'true-false-not-given'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['literature', 'biography'],
                description: '关于新西兰儿童文学作家的传记'
            },
            {
                id: 'p3-high-piraha-people',
                title: 'The Pirahã people of Brazil 巴西的皮拉哈人',
                category: 'P3',
                frequency: 'high',
                path: 'P3 （20+6）/1.高频(网页由🕊️制作)/14.The Pirahã people of Brazil 巴西的皮拉哈人(躺)/',
                filename: 'P3 - The Pirahã people of Brazil【高】.html',
                questionTypes: ['heading-matching', 'multiple-choice'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['anthropology', 'culture'],
                description: '关于巴西原住民文化的人类学研究'
            },
            {
                id: 'p3-high-robbers-cave',
                title: 'The Robbers Cave Study 罗伯斯洞穴研究',
                category: 'P3',
                frequency: 'high',
                path: 'P3 （20+6）/1.高频(网页由🕊️制作)/15.The Robbers Cave Study 罗伯斯洞穴研究/',
                filename: 'P3 - The Robbers Cave Study【高】.html',
                questionTypes: ['heading-matching', 'summary-completion'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['psychology', 'social-science'],
                description: '关于群体冲突的经典心理学实验'
            },
            {
                id: 'p3-high-mother-tongue',
                title: 'The Significant Role of Mother Tongue in Education 母语在教育中的作用',
                category: 'P3',
                frequency: 'high',
                path: 'P3 （20+6）/1.高频(网页由🕊️制作)/16.The Significant Role of Mother Tongue in Education 母语在教育中的作用(躺)/',
                filename: 'P3 - The Significant Role of Mother Tongue in Education【高】.html',
                questionTypes: ['heading-matching', 'yes-no-not-given'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['education', 'linguistics'],
                description: '关于母语教育重要性的研究'
            },
            {
                id: 'p3-high-tuatara',
                title: 'The tuatara – past and future 喙头蜥 —— 过去与未来',
                category: 'P3',
                frequency: 'high',
                path: 'P3 （20+6）/1.高频(网页由🕊️制作)/17.The tuatara – past and future 喙头蜥 —— 过去与未来/',
                filename: 'P3 - The tuatara – past and future【高】.html',
                questionTypes: ['heading-matching', 'multiple-choice'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['biology', 'conservation'],
                description: '关于新西兰喙头蜥保护的生物学文章'
            },
            {
                id: 'p3-high-voynich-manuscript',
                title: 'Voynich Manuscript 伏尼契手稿',
                category: 'P3',
                frequency: 'high',
                path: 'P3 （20+6）/1.高频(网页由🕊️制作)/18.Voynich Manuscript 伏尼契手稿(躺)/',
                filename: 'P3 - Voynich Manuscript【高】.html',
                questionTypes: ['heading-matching', 'summary-completion'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['history', 'mystery'],
                description: '关于神秘古代手稿的历史研究'
            },
            {
                id: 'p3-high-musical-expert',
                title: 'What makes a musical expert? 是什么造就了音乐专家？',
                category: 'P3',
                frequency: 'high',
                path: 'P3 （20+6）/1.高频(网页由🕊️制作)/19.What makes a musical expert_ 是什么造就了音乐专家？/',
                filename: 'P3 - What makes a musical expert_【高】.html',
                questionTypes: ['heading-matching', 'multiple-choice'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['music', 'psychology'],
                description: '关于音乐专业技能发展的研究'
            },
            {
                id: 'p3-high-yawning',
                title: 'Yawning 打哈欠',
                category: 'P3',
                frequency: 'high',
                path: 'P3 （20+6）/1.高频(网页由🕊️制作)/20.Yawning 打哈欠/',
                filename: 'P3 - Yawning【高】.html',
                questionTypes: ['heading-matching', 'true-false-not-given'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['biology', 'behavior'],
                description: '关于打哈欠现象的生物学研究'
            },
            {
                id: 'p3-high-neanderthal-technology',
                title: 'Neanderthal Technology',
                category: 'P3',
                frequency: 'high',
                path: 'P3 （20+6）/1.高频(网页由🕊️制作)/21.Neanderthal Technology/',
                filename: 'P3 - Neanderthal Technology.html',
                questionTypes: ['heading-matching', 'multiple-choice'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['archaeology', 'technology'],
                description: '关于尼安德特人技术的考古研究'
            },
            {
                id: 'p3-high-science-filmmaking',
                title: 'Science and Filmmaking 电影科学',
                category: 'P3',
                frequency: 'high',
                path: 'P3 （20+6）/1.高频(网页由🕊️制作)/P3 - Science and Filmmaking 电影科学/',
                filename: '0828 P3 - Science and Filmmaking.html',
                questionTypes: ['multiple-choice', 'yes-no-not-given', 'summary-completion'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['technology', 'film'],
                description: '关于电影制作中科学技术应用的文章'
            },
            {
                id: 'p3-high-humanities-health',
                title: 'Humanities and the health professional 人文医学',
                category: 'P3',
                frequency: 'high',
                path: 'P3 （20+6）/1.高频(网页由🕊️制作)/P3 - Humanities and the health professional(0811)人文医学/',
                filename: 'P3 - Humanities and the health professional(0811).html',
                questionTypes: ['heading-matching', 'multiple-choice'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['medicine', 'humanities'],
                description: '关于医学教育中人文学科重要性的研究'
            },
            {
                id: 'p3-high-star-performers',
                title: 'Star Performers 明星员工',
                category: 'P3',
                frequency: 'high',
                path: 'P3 （20+6）/1.高频(网页由🕊️制作)/P3 - Star Performers(0808)明星员工/',
                filename: 'P3 - Star Performers(0808).html',
                questionTypes: ['heading-matching', 'summary-completion'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['business', 'management'],
                description: '关于职场明星员工特质的管理学研究'
            },
            {
                id: 'p3-high-dreams-mystery',
                title: 'Unlocking the mystery of dreams 梦的解析',
                category: 'P3',
                frequency: 'high',
                path: 'P3 （20+6）/1.高频(网页由🕊️制作)/P3 - Unlocking the mystery of dreams 梦的解析/',
                filename: 'P3 - Unlocking the mystery of dreams 梦的解析.html',
                questionTypes: ['heading-matching', 'multiple-choice'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['psychology', 'neuroscience'],
                description: '关于梦境机制的神经科学研究'
            },
            {
                id: 'p3-high-whale-culture',
                title: 'Whale Culture 虎鲸文化',
                category: 'P3',
                frequency: 'high',
                path: 'P3 （20+6）/1.高频(网页由🕊️制作)/P3 - Whale Culture 虎鲸文化/',
                filename: 'P3 - Whale Culture 虎鲸文化.html',
                questionTypes: ['heading-matching', 'true-false-not-given'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['biology', 'marine-life'],
                description: '关于虎鲸社会行为的海洋生物学研究'
            },

            // P3 次高频题目
            {
                id: 'p3-low-discovery-slowness',
                title: 'Book Review The Discovery of Slowness 书评 慢的发现',
                category: 'P3',
                frequency: 'low',
                path: 'P3 （20+6）/2.次高频(网页由🕊️制作)/1.Book Review The Discovery of Slowness 书评 _慢的发现_/',
                filename: 'P3 - Book Review The Discovery of Slowness【次】.html',
                questionTypes: ['heading-matching', 'summary-completion', 'multiple-choice'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['literature', 'biography'],
                description: '关于《慢的发现》一书的文学评论'
            },
            {
                id: 'p3-low-darwin-psychology',
                title: 'Charles Darwin and Evolutionary Psychology 查尔斯・达尔文与进化心理学',
                category: 'P3',
                frequency: 'low',
                path: 'P3 （20+6）/2.次高频(网页由🕊️制作)/2.Charles Darwin and Evolutionary Psychology 查尔斯・达尔文与进化心理学/',
                filename: 'P3 - Charles Darwin and Evolutionary Psychology【次】.html',
                questionTypes: ['heading-matching', 'multiple-choice'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['psychology', 'evolution'],
                description: '关于达尔文对心理学影响的学术文章'
            },
            {
                id: 'p3-low-class-size',
                title: 'Does class size matter? 班级规模重要吗？',
                category: 'P3',
                frequency: 'low',
                path: 'P3 （20+6）/2.次高频(网页由🕊️制作)/3.Does class size matter_ 班级规模重要吗？/',
                filename: 'P3 - Does class size matter_【次】.html',
                questionTypes: ['heading-matching', 'yes-no-not-given'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['education', 'research'],
                description: '关于班级规模对教学效果影响的教育研究'
            },
            {
                id: 'p3-low-marketing-information',
                title: 'Marketing and the information age 营销与信息时代',
                category: 'P3',
                frequency: 'low',
                path: 'P3 （20+6）/2.次高频(网页由🕊️制作)/4.Marketing and the information age 营销与信息时代(躺)/',
                filename: 'P3 - Marketing and the information age【次】.html',
                questionTypes: ['heading-matching', 'summary-completion'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['business', 'technology'],
                description: '关于信息时代营销策略变化的商业文章'
            },
            {
                id: 'p3-low-fluoridation-controversy',
                title: 'The fluoridation controversy 氟化争议',
                category: 'P3',
                frequency: 'low',
                path: 'P3 （20+6）/2.次高频(网页由🕊️制作)/5.The fluoridation controversy 氟化争议（躺）/',
                filename: 'P3 - The fluoridation controversy【次】.html',
                questionTypes: ['heading-matching', 'multiple-choice'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['health', 'public-policy'],
                description: '关于饮用水氟化政策争议的公共卫生文章'
            },
            {
                id: 'p3-low-video-games-brain',
                title: 'Video Games\' Unexpected Benefits to the Human Brain 电子游戏对人类大脑的意外益处',
                category: 'P3',
                frequency: 'low',
                path: 'P3 （20+6）/2.次高频(网页由🕊️制作)/6.Video Games\' Unexpected Benefits to the Human Brain 电子游戏对人类大脑的意外益处/',
                filename: 'P3 - Video Games\' Unexpected Benefits to the Human Brain【次】.html',
                questionTypes: ['heading-matching', 'true-false-not-given'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['neuroscience', 'technology'],
                description: '关于电子游戏对大脑积极影响的神经科学研究'
            },
            {
                id: 'p3-low-images-places-1',
                title: 'Images and Places',
                category: 'P3',
                frequency: 'low',
                path: 'P3 （20+6）/2.次高频(网页由🕊️制作)/7.Images and Places/',
                filename: 'Images and Places.html',
                questionTypes: ['heading-matching', 'multiple-choice'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['psychology', 'memory'],
                description: '关于图像与地点记忆关系的心理学研究'
            },
            {
                id: 'p3-low-images-places-2',
                title: 'Images and Places 风景与印记',
                category: 'P3',
                frequency: 'low',
                path: 'P3 （20+6）/2.次高频(网页由🕊️制作)/P3 - Images and Places(8.24)风景与印记/',
                filename: 'P3 - Images and Places（0824）.html',
                questionTypes: ['heading-matching', 'summary-completion'],
                totalQuestions: 14,
                estimatedTime: 20,
                difficulty: 'hard',
                tags: ['psychology', 'memory'],
                description: '关于风景印象与记忆形成的心理学研究'
            }
        ];
    }

    /**
     * 提取分类名称
     */
    extractCategoryName(categoryPath) {
        const match = categoryPath.match(/P[123]/);
        return match ? match[0] : 'Unknown';
    }

    /**
     * 从HTML文档提取标题
     */
    extractTitle(doc, fallbackName) {
        // 尝试从多个位置提取标题
        const titleSelectors = [
            'title',
            'h1',
            'h2',
            'h3'
        ];
        
        for (const selector of titleSelectors) {
            const element = doc.querySelector(selector);
            if (element && element.textContent.trim()) {
                let title = element.textContent.trim();
                // 清理标题
                title = title.replace(/^P[123]\s*[-–]\s*/, '');
                title = title.replace(/\s*\(Integrated.*?\)/, '');
                title = title.replace(/【高】|【次】/, '');
                if (title.length > 5) {
                    return title;
                }
            }
        }
        
        return fallbackName;
    }

    /**
     * 从HTML文档提取题型
     */
    extractQuestionTypes(doc) {
        const questionTypes = [];
        const content = doc.body ? doc.body.textContent.toLowerCase() : '';
        const htmlContent = doc.documentElement ? doc.documentElement.innerHTML.toLowerCase() : '';
        
        // 更精确的题型检测模式
        const typePatterns = {
            'heading-matching': {
                patterns: [
                    /choose.*correct heading.*paragraph/i,
                    /match.*heading.*paragraph/i,
                    /heading.*paragraph.*choose/i,
                    /list of headings/i,
                    /correct number.*i[–-]x/i
                ],
                weight: 3
            },
            'true-false-not-given': {
                patterns: [
                    /true.*false.*not given/i,
                    /tfng/i,
                    /write.*true.*false.*not given/i
                ],
                weight: 3
            },
            'yes-no-not-given': {
                patterns: [
                    /yes.*no.*not given/i,
                    /ynng/i,
                    /write.*yes.*no.*not given/i
                ],
                weight: 3
            },
            'multiple-choice': {
                patterns: [
                    /choose.*correct.*answer/i,
                    /multiple choice/i,
                    /choose.*letter.*a[–-]d/i,
                    /choose.*letter.*a[–-]g/i
                ],
                weight: 2
            },
            'matching-information': {
                patterns: [
                    /match.*information/i,
                    /information.*match/i,
                    /which paragraph contains/i,
                    /match.*statement.*paragraph/i
                ],
                weight: 2
            },
            'matching-people-ideas': {
                patterns: [
                    /match.*people/i,
                    /people.*ideas/i,
                    /match.*person.*statement/i,
                    /list of people/i
                ],
                weight: 2
            },
            'matching-countries': {
                patterns: [
                    /match.*countr/i,
                    /list of countries/i,
                    /statement.*country/i
                ],
                weight: 2
            },
            'summary-completion': {
                patterns: [
                    /complete.*summary/i,
                    /summary.*completion/i,
                    /complete.*text.*below/i,
                    /choose.*words.*box/i
                ],
                weight: 2
            },
            'sentence-completion': {
                patterns: [
                    /complete.*sentence/i,
                    /sentence.*completion/i,
                    /complete.*each sentence/i
                ],
                weight: 2
            },
            'short-answer': {
                patterns: [
                    /short answer/i,
                    /answer.*question.*no more than/i,
                    /write.*no more than.*word/i,
                    /answer.*question.*using.*word/i
                ],
                weight: 2
            },
            'diagram-labelling': {
                patterns: [
                    /label.*diagram/i,
                    /diagram.*label/i,
                    /complete.*diagram/i,
                    /diagram.*below/i
                ],
                weight: 2
            },
            'flow-chart': {
                patterns: [
                    /flow.*chart/i,
                    /complete.*flow/i,
                    /flowchart/i
                ],
                weight: 2
            },
            'table-completion': {
                patterns: [
                    /complete.*table/i,
                    /table.*completion/i,
                    /table.*below/i
                ],
                weight: 2
            },
            'note-completion': {
                patterns: [
                    /complete.*note/i,
                    /note.*completion/i,
                    /notes.*below/i
                ],
                weight: 2
            }
        };
        
        // 检测题型并计算权重
        const typeScores = {};
        
        for (const [type, config] of Object.entries(typePatterns)) {
            let score = 0;
            for (const pattern of config.patterns) {
                const matches = (content.match(pattern) || []).length;
                score += matches * config.weight;
            }
            if (score > 0) {
                typeScores[type] = score;
            }
        }
        
        // 按分数排序并选择最可能的题型
        const sortedTypes = Object.entries(typeScores)
            .sort(([,a], [,b]) => b - a)
            .map(([type]) => type);
        
        // 添加检测到的题型
        questionTypes.push(...sortedTypes);
        
        // 通过HTML结构进一步验证
        this.validateQuestionTypesFromHTML(doc, questionTypes);
        
        // 如果没有检测到特定题型，添加默认题型
        if (questionTypes.length === 0) {
            questionTypes.push('reading-comprehension');
        }
        
        // 去重并返回
        return [...new Set(questionTypes)];
    }

    /**
     * 通过HTML结构验证题型
     */
    validateQuestionTypesFromHTML(doc, questionTypes) {
        // 检查是否有表格结构（通常用于heading matching）
        const tables = doc.querySelectorAll('table');
        if (tables.length > 0) {
            const tableContent = Array.from(tables).map(t => t.textContent.toLowerCase()).join(' ');
            if (/paragraph.*[a-h]/i.test(tableContent) && !questionTypes.includes('heading-matching')) {
                questionTypes.unshift('heading-matching');
            }
        }
        
        // 检查单选按钮组
        const radioGroups = doc.querySelectorAll('input[type="radio"]');
        if (radioGroups.length > 0) {
            const radioNames = Array.from(radioGroups).map(r => r.name);
            const uniqueGroups = [...new Set(radioNames)];
            
            // 如果有很多单选组，可能是multiple choice或matching
            if (uniqueGroups.length > 5 && !questionTypes.some(t => t.includes('multiple-choice') || t.includes('matching'))) {
                questionTypes.push('multiple-choice');
            }
        }
        
        // 检查文本输入框（通常用于填空题）
        const textInputs = doc.querySelectorAll('input[type="text"], textarea');
        if (textInputs.length > 0 && !questionTypes.some(t => t.includes('completion'))) {
            questionTypes.push('summary-completion');
        }
    }

    /**
     * 从HTML文档提取题目总数
     */
    extractTotalQuestions(doc) {
        // 查找题目编号
        const content = doc.body ? doc.body.textContent : '';
        const questionNumbers = [];
        
        // 匹配 "Questions 1-13" 或 "Question 1" 等格式
        const questionRangeMatch = content.match(/Questions?\s+(\d+)[-–](\d+)/i);
        if (questionRangeMatch) {
            const start = parseInt(questionRangeMatch[1]);
            const end = parseInt(questionRangeMatch[2]);
            return end - start + 1;
        }
        
        // 查找所有题目编号
        const numberMatches = content.match(/\b(\d+)\./g);
        if (numberMatches) {
            numberMatches.forEach(match => {
                const num = parseInt(match.replace('.', ''));
                if (num > 0 && num <= 50) {
                    questionNumbers.push(num);
                }
            });
        }
        
        // 返回最大题号
        return questionNumbers.length > 0 ? Math.max(...questionNumbers) : 13;
    }

    /**
     * 从题目名称和内容提取标签
     */
    extractTags(doc, examName) {
        const tags = [];
        const titleText = examName.toLowerCase();
        const bodyText = doc.body ? doc.body.textContent.toLowerCase() : '';
        const combinedText = titleText + ' ' + bodyText;
        
        // 主题标签 - 更详细的分类
        const topicTags = {
            // 历史类
            'history': /history|historical|ancient|past|century|era|civilization|empire|dynasty|medieval|renaissance/,
            'archaeology': /archaeology|archaeological|excavation|artifact|ruins|palace|tomb|discovery/,
            
            // 科学技术类
            'science': /science|scientific|research|study|experiment|theory|hypothesis|analysis/,
            'technology': /technology|technical|digital|computer|internet|innovation|invention|engineering/,
            'biology': /biology|biological|organism|species|evolution|genetics|ecosystem|biodiversity/,
            'physics': /physics|physical|energy|force|magnetism|electricity|quantum|mechanics/,
            'chemistry': /chemistry|chemical|molecule|compound|reaction|element|laboratory/,
            'medicine': /medicine|medical|health|disease|treatment|therapy|diagnosis|pharmaceutical/,
            'astronomy': /astronomy|astronomical|space|planet|star|galaxy|universe|cosmic/,
            
            // 社会文化类
            'culture': /culture|cultural|tradition|custom|society|social|community|heritage/,
            'anthropology': /anthropology|anthropological|tribe|indigenous|ethnic|ritual|belief/,
            'sociology': /sociology|sociological|behavior|interaction|group|institution|norm/,
            'psychology': /psychology|psychological|behavior|mind|brain|mental|cognitive|emotion/,
            'education': /education|educational|school|university|learning|student|teaching|curriculum/,
            
            // 艺术文学类
            'art': /art|artistic|painting|sculpture|gallery|museum|aesthetic|creative/,
            'music': /music|musical|instrument|composer|symphony|melody|rhythm|performance/,
            'literature': /literature|literary|author|writer|novel|poetry|story|narrative|book/,
            'theater': /theater|theatre|drama|play|performance|stage|actor|audience/,
            
            // 经济商业类
            'business': /business|company|corporate|management|organization|enterprise|industry/,
            'economics': /economics|economic|finance|financial|market|investment|trade|commerce/,
            'marketing': /marketing|advertisement|brand|consumer|customer|promotion|sales/,
            
            // 地理环境类
            'geography': /geography|geographical|location|place|country|city|region|landscape/,
            'environment': /environment|environmental|climate|weather|pollution|conservation|sustainability/,
            'nature': /nature|natural|wildlife|animal|plant|forest|ocean|mountain|desert/,
            'ecology': /ecology|ecological|ecosystem|habitat|biodiversity|species|conservation/,
            
            // 其他专业领域
            'architecture': /architecture|architectural|building|construction|design|structure|urban/,
            'transportation': /transportation|transport|vehicle|traffic|railway|aviation|shipping/,
            'agriculture': /agriculture|agricultural|farming|crop|livestock|food|nutrition/,
            'sports': /sports|sport|athletic|competition|game|exercise|fitness|training/,
            'politics': /politics|political|government|policy|democracy|election|law|legal/
        };
        
        // 难度和特征标签
        const featureTags = {
            'academic': /academic|scholarly|research|university|journal|thesis|dissertation/,
            'popular': /popular|mainstream|general|public|everyday|common/,
            'technical': /technical|specialized|professional|expert|advanced|complex/,
            'contemporary': /contemporary|modern|current|recent|today|nowadays|21st century/,
            'international': /international|global|worldwide|cross-cultural|multicultural/
        };
        
        // 地理位置标签
        const locationTags = {
            'asia': /asia|asian|china|japan|india|korea|thailand|vietnam|singapore/,
            'europe': /europe|european|britain|england|france|germany|italy|spain|holland|netherlands/,
            'america': /america|american|usa|canada|mexico|brazil|argentina/,
            'africa': /africa|african|egypt|south africa|nigeria|kenya/,
            'oceania': /oceania|australia|new zealand|pacific|island/,
            'uk': /uk|britain|british|england|english|scotland|wales|london/,
            'usa': /usa|america|american|united states|california|new york|texas/
        };
        
        // 检测主题标签
        for (const [tag, pattern] of Object.entries(topicTags)) {
            if (pattern.test(combinedText)) {
                tags.push(tag);
            }
        }
        
        // 检测特征标签
        for (const [tag, pattern] of Object.entries(featureTags)) {
            if (pattern.test(combinedText)) {
                tags.push(tag);
            }
        }
        
        // 检测地理标签
        for (const [tag, pattern] of Object.entries(locationTags)) {
            if (pattern.test(combinedText)) {
                tags.push(tag);
            }
        }
        
        // 基于题目名称的特殊标签
        this.addSpecialTags(tags, titleText);
        
        // 如果没有找到主题标签，添加通用标签
        if (tags.length === 0) {
            tags.push('reading');
        }
        
        // 去重并返回
        return [...new Set(tags)];
    }

    /**
     * 基于题目名称添加特殊标签
     */
    addSpecialTags(tags, titleText) {
        // 人物传记类
        if (/biography|life of|story of|\b\w+\s+\(\d{4}/.test(titleText)) {
            tags.push('biography');
        }
        
        // 书评类
        if (/book review|review of/.test(titleText)) {
            tags.push('book-review', 'literature');
        }
        
        // 案例研究类
        if (/case study|study of|examination of/.test(titleText)) {
            tags.push('case-study');
        }
        
        // 比较分析类
        if (/versus|vs|compared|comparison|contrast/.test(titleText)) {
            tags.push('comparative-analysis');
        }
        
        // 发展历程类
        if (/development|evolution|progress|growth|rise|fall/.test(titleText)) {
            tags.push('development');
        }
        
        // 现象分析类
        if (/phenomenon|analysis|examination|investigation/.test(titleText)) {
            tags.push('analysis');
        }
    }

    /**
     * 生成题目描述
     */
    generateDescription(examName, questionTypes) {
        const typeDescriptions = {
            'heading-matching': '段落标题匹配',
            'true-false-not-given': '判断题（是/否/未提及）',
            'yes-no-not-given': '判断题（是/否/未提及）',
            'multiple-choice': '多项选择题',
            'matching-information': '信息匹配题',
            'summary-completion': '摘要填空题',
            'sentence-completion': '句子填空题'
        };
        
        const typeList = questionTypes.map(type => 
            typeDescriptions[type] || type
        ).join('、');
        
        return `关于${examName}的阅读理解题目，包含${typeList}`;
    }

    /**
     * 生成考试ID
     */
    generateExamId(category, frequency, examName) {
        const categoryCode = category.toLowerCase();
        const freqCode = frequency === 'high' ? 'high' : 'low';
        
        // 提取英文标题的关键词
        const englishTitle = this.extractEnglishTitle(examName);
        const keywords = englishTitle
            .toLowerCase()
            .replace(/[^\w\s]/g, '')
            .split(/\s+/)
            .filter(word => word.length > 2) // 过滤短词
            .slice(0, 4) // 最多取4个关键词
            .join('-');
        
        // 如果没有足够的英文关键词，使用数字编号
        if (keywords.length < 3) {
            const hash = this.simpleHash(examName);
            return `${categoryCode}-${freqCode}-${hash}`;
        }
        
        return `${categoryCode}-${freqCode}-${keywords}`;
    }

    /**
     * 简单哈希函数生成短标识符
     */
    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 转换为32位整数
        }
        return Math.abs(hash).toString(36).substring(0, 8);
    }

    /**
     * 生成扩展元数据
     */
    generateExtendedMetadata(doc, examName, questionTypes, tags) {
        const metadata = {
            // 内容分析
            wordCount: this.estimateWordCount(doc),
            readingLevel: this.estimateReadingLevel(doc, examName),
            
            // 题目特征
            hasImages: this.hasImages(doc),
            hasTables: this.hasTables(doc),
            hasDiagrams: this.hasDiagrams(doc),
            
            // 主题分类
            primaryTopic: this.determinePrimaryTopic(tags),
            secondaryTopics: this.determineSecondaryTopics(tags),
            
            // 地理和时间背景
            geographicalFocus: this.extractGeographicalFocus(tags),
            timeContext: this.extractTimeContext(doc, examName),
            
            // 学术特征
            academicField: this.determineAcademicField(tags),
            sourceType: this.determineSourceType(doc, examName)
        };
        
        return metadata;
    }

    /**
     * 估算词汇量
     */
    estimateWordCount(doc) {
        const text = doc.body ? doc.body.textContent : '';
        const words = text.trim().split(/\s+/).filter(word => word.length > 0);
        return words.length;
    }

    /**
     * 估算阅读难度
     */
    estimateReadingLevel(doc, examName) {
        const text = doc.body ? doc.body.textContent : '';
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
        const words = text.trim().split(/\s+/).filter(word => word.length > 0);
        
        if (sentences.length === 0 || words.length === 0) return 'medium';
        
        const avgWordsPerSentence = words.length / sentences.length;
        const avgWordLength = words.reduce((sum, word) => sum + word.length, 0) / words.length;
        
        // 简单的难度评估
        if (avgWordsPerSentence > 20 || avgWordLength > 6) {
            return 'high';
        } else if (avgWordsPerSentence < 12 && avgWordLength < 5) {
            return 'low';
        }
        return 'medium';
    }

    /**
     * 检查是否包含图片
     */
    hasImages(doc) {
        return doc.querySelectorAll('img').length > 0;
    }

    /**
     * 检查是否包含表格
     */
    hasTables(doc) {
        return doc.querySelectorAll('table').length > 0;
    }

    /**
     * 检查是否包含图表
     */
    hasDiagrams(doc) {
        const text = doc.body ? doc.body.textContent.toLowerCase() : '';
        return /diagram|chart|figure|illustration/.test(text);
    }

    /**
     * 确定主要主题
     */
    determinePrimaryTopic(tags) {
        const topicPriority = [
            'history', 'science', 'technology', 'culture', 'business',
            'art', 'literature', 'psychology', 'geography', 'nature'
        ];
        
        for (const topic of topicPriority) {
            if (tags.includes(topic)) {
                return topic;
            }
        }
        
        return tags[0] || 'general';
    }

    /**
     * 确定次要主题
     */
    determineSecondaryTopics(tags) {
        const primary = this.determinePrimaryTopic(tags);
        return tags.filter(tag => tag !== primary).slice(0, 3);
    }

    /**
     * 提取地理焦点
     */
    extractGeographicalFocus(tags) {
        const geoTags = ['asia', 'europe', 'america', 'africa', 'oceania', 'uk', 'usa'];
        return tags.filter(tag => geoTags.includes(tag));
    }

    /**
     * 提取时间背景
     */
    extractTimeContext(doc, examName) {
        const text = (examName + ' ' + (doc.body ? doc.body.textContent : '')).toLowerCase();
        
        if (/ancient|prehistoric|bc|antiquity/.test(text)) return 'ancient';
        if (/medieval|middle ages|renaissance/.test(text)) return 'medieval';
        if (/19th century|1800s|victorian/.test(text)) return '19th-century';
        if (/20th century|1900s|modern/.test(text)) return '20th-century';
        if (/21st century|2000s|contemporary|current|today/.test(text)) return 'contemporary';
        
        return 'unspecified';
    }

    /**
     * 确定学术领域
     */
    determineAcademicField(tags) {
        const fieldMap = {
            'humanities': ['history', 'literature', 'art', 'culture', 'archaeology'],
            'sciences': ['biology', 'physics', 'chemistry', 'medicine', 'astronomy'],
            'social-sciences': ['psychology', 'sociology', 'anthropology', 'education', 'politics'],
            'business': ['business', 'economics', 'marketing'],
            'technology': ['technology', 'engineering']
        };
        
        for (const [field, fieldTags] of Object.entries(fieldMap)) {
            if (fieldTags.some(tag => tags.includes(tag))) {
                return field;
            }
        }
        
        return 'general';
    }

    /**
     * 确定来源类型
     */
    determineSourceType(doc, examName) {
        const text = (examName + ' ' + (doc.body ? doc.body.textContent : '')).toLowerCase();
        
        if (/book review|review of/.test(text)) return 'book-review';
        if (/biography|life of/.test(text)) return 'biography';
        if (/study|research|analysis|examination/.test(text)) return 'academic-study';
        if (/news|report|article/.test(text)) return 'news-article';
        if (/history|historical/.test(text)) return 'historical-account';
        
        return 'general-article';
    }

    /**
     * 估算完成时间
     */
    estimateTime(totalQuestions, category) {
        const baseTime = category === 'P3' ? 1.5 : 1.2; // P3题目更难，需要更多时间
        return Math.ceil(totalQuestions * baseTime);
    }

    /**
     * 确定难度等级
     */
    determineDifficulty(category) {
        const difficultyMap = {
            'P1': 'easy',
            'P2': 'medium', 
            'P3': 'hard'
        };
        return difficultyMap[category] || 'medium';
    }

    /**
     * 根据文件路径解析题目信息
     */
    parseExamFromPath(filePath) {
        const pathParts = filePath.split('/');
        const category = pathParts[0]?.match(/P[123]/)?.[0];
        const frequency = pathParts[1]?.includes('高频') ? 'high' : 'low';
        
        return {
            category,
            frequency,
            path: filePath
        };
    }

    /**
     * 验证题目文件
     */
    async validateExamFile(examPath) {
        try {
            // 在实际实现中，这里会检查文件是否存在和有效
            // 由于浏览器限制，这里返回模拟结果
            return true;
        } catch (error) {
            console.warn(`Failed to validate exam file: ${examPath}`, error);
            return false;
        }
    }

    /**
     * 获取扫描进度
     */
    getScanProgress() {
        return this.scanProgress;
    }

    /**
     * 获取题目索引
     */
    getExamIndex() {
        return [...this.examIndex];
    }

    /**
     * 根据ID查找题目
     */
    findExamById(examId) {
        return this.examIndex.find(exam => exam.id === examId);
    }

    /**
     * 根据分类筛选题目
     */
    getExamsByCategory(category) {
        return this.examIndex.filter(exam => exam.category === category);
    }

    /**
     * 根据频率筛选题目
     */
    getExamsByFrequency(frequency) {
        return this.examIndex.filter(exam => exam.frequency === frequency);
    }

    /**
     * 搜索题目 - 增强版
     */
    searchExams(query, filters = {}) {
        const lowerQuery = query.toLowerCase();
        let results = this.examIndex;
        
        // 文本搜索
        if (query.trim()) {
            results = results.filter(exam => 
                exam.title.toLowerCase().includes(lowerQuery) ||
                exam.tags.some(tag => tag.toLowerCase().includes(lowerQuery)) ||
                (exam.description && exam.description.toLowerCase().includes(lowerQuery)) ||
                exam.questionTypes.some(type => type.toLowerCase().includes(lowerQuery)) ||
                (exam.classification && exam.classification.primaryTopic.toLowerCase().includes(lowerQuery))
            );
        }
        
        // 应用筛选器
        if (filters.category) {
            results = results.filter(exam => exam.category === filters.category);
        }
        
        if (filters.frequency) {
            results = results.filter(exam => exam.frequency === filters.frequency);
        }
        
        if (filters.difficulty) {
            results = results.filter(exam => exam.difficulty === filters.difficulty);
        }
        
        if (filters.questionType) {
            results = results.filter(exam => exam.questionTypes.includes(filters.questionType));
        }
        
        if (filters.topic) {
            results = results.filter(exam => 
                exam.tags.includes(filters.topic) ||
                (exam.classification && exam.classification.primaryTopic === filters.topic)
            );
        }
        
        if (filters.academicField) {
            results = results.filter(exam => 
                exam.classification && exam.classification.academicField === filters.academicField
            );
        }
        
        if (filters.timeContext) {
            results = results.filter(exam => 
                exam.classification && exam.classification.timeContext === filters.timeContext
            );
        }
        
        return results;
    }

    /**
     * 获取所有可用的筛选选项
     */
    getFilterOptions() {
        const options = {
            categories: [...new Set(this.examIndex.map(exam => exam.category))],
            frequencies: [...new Set(this.examIndex.map(exam => exam.frequency))],
            difficulties: [...new Set(this.examIndex.map(exam => exam.difficulty))],
            questionTypes: [...new Set(this.examIndex.flatMap(exam => exam.questionTypes))],
            topics: [...new Set(this.examIndex.flatMap(exam => exam.tags))],
            academicFields: [...new Set(this.examIndex.map(exam => exam.classification?.academicField).filter(Boolean))],
            timeContexts: [...new Set(this.examIndex.map(exam => exam.classification?.timeContext).filter(Boolean))]
        };
        
        return options;
    }

    /**
     * 获取统计信息
     */
    getStatistics() {
        const stats = {
            totalExams: this.examIndex.length,
            byCategory: {},
            byFrequency: {},
            byDifficulty: {},
            byQuestionType: {},
            byTopic: {},
            byAcademicField: {}
        };
        
        // 按分类统计
        this.examIndex.forEach(exam => {
            stats.byCategory[exam.category] = (stats.byCategory[exam.category] || 0) + 1;
            stats.byFrequency[exam.frequency] = (stats.byFrequency[exam.frequency] || 0) + 1;
            stats.byDifficulty[exam.difficulty] = (stats.byDifficulty[exam.difficulty] || 0) + 1;
            
            exam.questionTypes.forEach(type => {
                stats.byQuestionType[type] = (stats.byQuestionType[type] || 0) + 1;
            });
            
            exam.tags.forEach(tag => {
                stats.byTopic[tag] = (stats.byTopic[tag] || 0) + 1;
            });
            
            if (exam.classification?.academicField) {
                const field = exam.classification.academicField;
                stats.byAcademicField[field] = (stats.byAcademicField[field] || 0) + 1;
            }
        });
        
        return stats;
    }

    /**
     * 获取推荐题目
     */
    getRecommendations(examId, limit = 5) {
        const targetExam = this.findExamById(examId);
        if (!targetExam) return [];
        
        // 基于相似性评分推荐
        const recommendations = this.examIndex
            .filter(exam => exam.id !== examId)
            .map(exam => ({
                exam,
                score: this.calculateSimilarityScore(targetExam, exam)
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(item => item.exam);
        
        return recommendations;
    }

    /**
     * 计算题目相似性评分
     */
    calculateSimilarityScore(exam1, exam2) {
        let score = 0;
        
        // 相同分类加分
        if (exam1.category === exam2.category) score += 3;
        
        // 相同频率加分
        if (exam1.frequency === exam2.frequency) score += 2;
        
        // 相同难度加分
        if (exam1.difficulty === exam2.difficulty) score += 1;
        
        // 共同题型加分
        const commonQuestionTypes = exam1.questionTypes.filter(type => 
            exam2.questionTypes.includes(type)
        );
        score += commonQuestionTypes.length * 2;
        
        // 共同标签加分
        const commonTags = exam1.tags.filter(tag => exam2.tags.includes(tag));
        score += commonTags.length;
        
        // 相同主题加分
        if (exam1.classification?.primaryTopic === exam2.classification?.primaryTopic) {
            score += 3;
        }
        
        // 相同学术领域加分
        if (exam1.classification?.academicField === exam2.classification?.academicField) {
            score += 2;
        }
        
        return score;
    }

    /**
     * 获取题目分组
     */
    getExamGroups(groupBy = 'category') {
        const groups = {};
        
        this.examIndex.forEach(exam => {
            let groupKey;
            
            switch (groupBy) {
                case 'category':
                    groupKey = exam.category;
                    break;
                case 'frequency':
                    groupKey = exam.frequency;
                    break;
                case 'difficulty':
                    groupKey = exam.difficulty;
                    break;
                case 'topic':
                    groupKey = exam.classification?.primaryTopic || 'other';
                    break;
                case 'academicField':
                    groupKey = exam.classification?.academicField || 'other';
                    break;
                default:
                    groupKey = 'all';
            }
            
            if (!groups[groupKey]) {
                groups[groupKey] = [];
            }
            groups[groupKey].push(exam);
        });
        
        return groups;
    }
}