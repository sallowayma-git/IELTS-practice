-- IELTS写作评判系统数据库结构
-- 创建时间: 2024-10-04
-- 版本: 1.0.0

-- 1. 用户表
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    display_name TEXT,
    avatar_url TEXT,
    preferences TEXT, -- JSON格式的用户偏好设置
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT 1
);

-- 2. 写作题目表
CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('Task 1', 'Task 2')),
    content TEXT NOT NULL,
    min_words INTEGER DEFAULT 250,
    time_limit INTEGER DEFAULT 2400, -- 秒
    difficulty TEXT DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
    category TEXT,
    tags TEXT, -- JSON格式的标签数组
    source TEXT, -- 题目来源
    is_active BOOLEAN DEFAULT 1,
    usage_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. 写作记录表
CREATE TABLE IF NOT EXISTS writing_records (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    topic_id TEXT NOT NULL,
    topic_title TEXT NOT NULL,
    topic_type TEXT NOT NULL,
    content TEXT NOT NULL,
    word_count INTEGER NOT NULL,
    time_spent INTEGER NOT NULL, -- 秒
    draft_count INTEGER DEFAULT 1, -- 修改次数
    auto_saved BOOLEAN DEFAULT 0,
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'assessed')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    submitted_at DATETIME,
    FOREIGN KEY (topic_id) REFERENCES topics (id),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
);

-- 4. AI评估结果表
CREATE TABLE IF NOT EXISTS assessment_results (
    id TEXT PRIMARY KEY,
    writing_id TEXT NOT NULL,
    overall_score REAL NOT NULL CHECK (overall_score >= 0 AND overall_score <= 9),
    level TEXT NOT NULL, -- '需要改进', '基础水平', '合格水平', '优秀水平'
    description TEXT,

    -- 四个评分维度
    task_response_score REAL CHECK (task_response_score >= 0 AND task_response_score <= 9),
    task_response_feedback TEXT,
    coherence_score REAL CHECK (coherence_score >= 0 AND coherence_score <= 9),
    coherence_feedback TEXT,
    vocabulary_score REAL CHECK (vocabulary_score >= 0 AND vocabulary_score <= 9),
    vocabulary_feedback TEXT,
    grammar_score REAL CHECK (grammar_score >= 0 AND grammar_score <= 9),
    grammar_feedback TEXT,

    -- 详细反馈和建议
    detailed_feedback TEXT, -- JSON格式的详细反馈
    suggestions TEXT, -- JSON格式的建议
    strengths TEXT, -- JSON格式的优点
    improvements TEXT, -- JSON格式的改进点

    -- AI评估元数据
    ai_model TEXT NOT NULL,
    ai_provider TEXT NOT NULL,
    evaluation_time INTEGER, -- 毫秒
    token_usage TEXT, -- JSON格式的token使用情况
    confidence_score REAL CHECK (confidence_score >= 0 AND confidence_score <= 1),

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (writing_id) REFERENCES writing_records (id) ON DELETE CASCADE
);

-- 4.1. 评估标注表 (Phase 2 新增)
CREATE TABLE IF NOT EXISTS evaluation_annotations (
    id TEXT PRIMARY KEY,
    assessment_result_id TEXT NOT NULL,
    writing_id TEXT NOT NULL,

    -- 错误定位信息
    start_index INTEGER NOT NULL,
    end_index INTEGER NOT NULL,
    error_text TEXT NOT NULL,
    suggested_text TEXT,

    -- 错误分类
    category TEXT NOT NULL CHECK (category IN ('grammar', 'vocabulary', 'structure', 'punctuation', 'style')),
    severity TEXT NOT NULL CHECK (severity IN ('error', 'warning', 'suggestion')),
    error_type TEXT NOT NULL, -- 具体错误类型，如 'subject_verb_agreement', 'spelling', 'article_usage'

    -- 反馈信息
    message TEXT NOT NULL, -- 错误描述
    explanation TEXT, -- 详细解释
    example TEXT, -- 正确示例

    -- 元数据
    ai_model TEXT,
    ai_provider TEXT,
    confidence_score REAL CHECK (confidence_score >= 0 AND confidence_score <= 1),

    -- 状态
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'ignored', 'resolved')),
    user_action TEXT CHECK (user_action IN ('pending', 'accepted', 'rejected', 'ignored')),
    user_notes TEXT,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (assessment_result_id) REFERENCES assessment_results (id) ON DELETE CASCADE,
    FOREIGN KEY (writing_id) REFERENCES writing_records (id) ON DELETE CASCADE
);

-- 5. 用户设置表
CREATE TABLE IF NOT EXISTS user_settings (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    category TEXT NOT NULL, -- 'general', 'ai', 'writing'
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, category, key),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- 6. 练习统计表
CREATE TABLE IF NOT EXISTS practice_statistics (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    date DATE NOT NULL,
    total_practices INTEGER DEFAULT 0,
    total_time_spent INTEGER DEFAULT 0, -- 秒
    total_words INTEGER DEFAULT 0,
    average_score REAL,
    highest_score REAL,
    lowest_score REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, date),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- 7. 错误日志表
CREATE TABLE IF NOT EXISTS error_logs (
    id TEXT PRIMARY KEY,
    level TEXT NOT NULL CHECK (level IN ('error', 'warning', 'info')),
    message TEXT NOT NULL,
    stack_trace TEXT,
    user_id TEXT,
    request_id TEXT,
    additional_data TEXT, -- JSON格式的额外数据
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
);

-- 8. 系统配置表
CREATE TABLE IF NOT EXISTS system_configs (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_writing_records_user_id ON writing_records(user_id);
CREATE INDEX IF NOT EXISTS idx_writing_records_topic_id ON writing_records(topic_id);
CREATE INDEX IF NOT EXISTS idx_writing_records_created_at ON writing_records(created_at);
CREATE INDEX IF NOT EXISTS idx_assessment_results_writing_id ON assessment_results(writing_id);
CREATE INDEX IF NOT EXISTS idx_assessment_results_overall_score ON assessment_results(overall_score);
CREATE INDEX IF NOT EXISTS idx_topics_type ON topics(type);
CREATE INDEX IF NOT EXISTS idx_topics_difficulty ON topics(difficulty);
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_practice_statistics_date ON practice_statistics(date);
CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON error_logs(created_at);

-- 插入默认系统配置
INSERT OR IGNORE INTO system_configs (key, value, description) VALUES
('app_version', '1.0.0', '应用版本'),
('max_upload_size', '10485760', '最大上传文件大小(字节)'),
('assessment_timeout', '300000', 'AI评估超时时间(毫秒)'),
('default_language', 'zh-CN', '默认语言'),
('supported_ai_providers', '["openai", "azure", "local"]', '支持的AI提供商'),
('enable_statistics', 'true', '是否启用统计功能'),
('auto_backup_interval', '86400000', '自动备份间隔(毫秒)'),
('max_draft_age', '604800000', '草稿保存时间(毫秒)');