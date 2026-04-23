const path = require('node:path');
const { app } = require('electron');

const Migrator = require('./db/migrator');
const ConfigService = require('./services/config.service');
const PromptService = require('./services/prompt.service');
const EvaluateService = require('./services/evaluate.service');
const TopicService = require('./services/topic.service');
const EssayService = require('./services/essay.service');
const SettingsService = require('./services/settings.service');
const UploadService = require('./services/upload.service');
const ReadingCoachService = require('./services/reading-coach.service');
const logger = require('./utils/logger');

class ServiceBundle {
    constructor(mainWindow = null) {
        this.mainWindow = mainWindow;
        this.db = null;
        this.configService = null;
        this.promptService = null;
        this.evaluateService = null;
        this.topicService = null;
        this.essayService = null;
        this.settingsService = null;
        this.uploadService = null;
        this.readingCoachService = null;
    }

    async initialize() {
        if (this.db) {
            return this.getBundle();
        }

        const dbPath = path.join(app.getPath('userData'), 'ielts-writing.db');
        const migrator = new Migrator(dbPath);
        migrator.migrate();
        this.db = migrator.getDatabase();

        logger.info('Database initialized successfully');

        this.configService = new ConfigService(this.db);
        this.promptService = new PromptService(this.db);
        this.evaluateService = new EvaluateService(
            this.db,
            this.mainWindow?.webContents || null
        );
        this.topicService = new TopicService(this.db);
        this.essayService = new EssayService(this.db);
        this.settingsService = new SettingsService(this.db);
        this.uploadService = new UploadService(app);
        this.readingCoachService = new ReadingCoachService(this.configService);

        await this.promptService.initializeDefaults();
        await this.topicService.initializeDefaults();

        logger.info('Shared service bundle initialized');
        return this.getBundle();
    }

    getBundle() {
        return {
            db: this.db,
            configService: this.configService,
            promptService: this.promptService,
            evaluateService: this.evaluateService,
            topicService: this.topicService,
            essayService: this.essayService,
            settingsService: this.settingsService,
            uploadService: this.uploadService,
            readingCoachService: this.readingCoachService
        };
    }

    cleanup() {
        if (this.db) {
            this.db.close();
            this.db = null;
            logger.info('Database connection closed');
        }
    }
}

module.exports = ServiceBundle;
