const path = require('path');
const os = require('os');

// Mock electron
const mockUserDataPath = path.join(os.homedir(), 'Library/Application Support/ielts-practice');
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
    if (id === 'electron') {
        return {
            app: {
                getPath: (name) => {
                    if (name === 'userData') return mockUserDataPath;
                    return path.join(os.tmpdir(), name);
                }
            },
            nativeImage: {
                createFromBuffer: (buf) => ({
                    resize: () => ({
                        toJPEG: () => buf,
                        toPNG: () => buf
                    })
                })
            }
        };
    }
    return originalRequire.apply(this, arguments);
};

const LocalApiServer = require('./local-api-server');
const Migrator = require('./db/migrator');
const EvaluateService = require('./services/evaluate.service');
const ConfigService = require('./services/config.service');
const PromptService = require('./services/prompt.service');
const TopicService = require('./services/topic.service');
const EssayService = require('./services/essay.service');
const SettingsService = require('./services/settings.service');
const UploadService = require('./services/upload.service');

// Mock webContents
const mockWebContents = {
    send: (channel, data) => console.log(`[IPC Mock] ${channel}:`, JSON.stringify(data).substring(0, 100))
};

async function run() {
    const dbPath = path.join(mockUserDataPath, 'ielts-writing.db');

    // Ensure DB is migrated
    const migrator = new Migrator(dbPath);
    migrator.migrate();
    const db = migrator.getDatabase();

    const services = {
        configService: new ConfigService(db),
        promptService: new PromptService(db),
        evaluateService: new EvaluateService(db, mockWebContents),
        topicService: new TopicService(db),
        essayService: new EssayService(db),
        settingsService: new SettingsService(db),
        uploadService: new UploadService(mockUserDataPath)
    };

    const server = new LocalApiServer(services);
    const info = await server.start();
    console.log(`Test API server started on ${info.baseUrl}`);
}

run().catch(console.error);
