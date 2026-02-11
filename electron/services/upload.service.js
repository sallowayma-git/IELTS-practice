const fs = require('fs');
const path = require('path');
const { app, nativeImage } = require('electron');
const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Upload Service
 * 图片上传处理服务
 */
class UploadService {
    constructor(appOrUserDataPath) {
        // 图片存储目录
        // 支持两种模式:
        // 1. Electron 模式: 传入 app 对象
        // 2. 独立模式: 传入 userDataPath 字符串 (用于测试)
        const userDataPath = typeof appOrUserDataPath === 'string'
            ? appOrUserDataPath
            : appOrUserDataPath?.getPath?.('userData');

        if (!userDataPath) {
            throw new Error('UploadService requires either app object or userDataPath string');
        }

        this.imagesDir = path.join(userDataPath, 'images');
        this.originalsDir = path.join(this.imagesDir, 'originals');
        this.thumbnailsDir = path.join(this.imagesDir, 'thumbnails');
        this._ensureImagesDir();
    }

    /**
     * 确保images目录存在
     * @private
     */
    _ensureImagesDir() {
        [this.imagesDir, this.originalsDir, this.thumbnailsDir].forEach((dir) => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                logger.info(`Created images directory: ${dir}`);
            }
        });
    }

    /**
     * 上传图片
     * @param {Object} fileData - { name, data (Buffer), type }
     * @returns {Object} - { image_path, thumbnail_path, size }
     */
    async uploadImage(fileData) {
        try {
            // 验证文件
            this._validateImage(fileData);

            // 生成唯一文件名
            const ext = path.extname(fileData.name) || '.png';
            const filename = this._generateFilename(ext);
            const filePath = path.join(this.originalsDir, filename);

            // 保存文件
            fs.writeFileSync(filePath, fileData.data);
            const thumbnailName = this._generateThumbnail(fileData.data, filename, ext);

            const stats = fs.statSync(filePath);
            logger.info(`Uploaded image: ${filename} (${stats.size} bytes)`);

            return {
                image_path: path.posix.join('originals', filename),
                thumbnail_path: path.posix.join('thumbnails', thumbnailName),
                size: stats.size
            };
        } catch (error) {
            logger.error('UploadService.uploadImage failed', error);
            throw error;
        }
    }

    /**
     * 删除图片
     * @param {string} filename - 图片文件名
     */
    async deleteImage(filename) {
        try {
            const normalized = String(filename || '').replace(/^\/+/, '');
            const safePath = this._resolveSafePath(normalized);
            const candidates = new Set([safePath]);

            const parsed = path.parse(safePath);
            const relativeDir = path.relative(this.imagesDir, parsed.dir);
            const isOriginalDir = relativeDir === 'originals';
            const isThumbDir = relativeDir === 'thumbnails';
            const isRootLevelFile = relativeDir === '';

            if (isOriginalDir) {
                candidates.add(path.join(this.thumbnailsDir, `${parsed.name}_thumb${parsed.ext}`));
            } else if (isThumbDir) {
                const originalBase = parsed.name.replace(/_thumb$/, '');
                candidates.add(path.join(this.originalsDir, `${originalBase}${parsed.ext}`));
            } else if (isRootLevelFile) {
                if (parsed.name.endsWith('_thumb')) {
                    const originalBase = parsed.name.replace(/_thumb$/, '');
                    candidates.add(path.join(this.thumbnailsDir, parsed.base));
                    candidates.add(path.join(this.originalsDir, `${originalBase}${parsed.ext}`));
                } else {
                    candidates.add(path.join(this.originalsDir, parsed.base));
                    candidates.add(path.join(this.thumbnailsDir, `${parsed.name}_thumb${parsed.ext}`));
                }
            } else {
                candidates.add(path.join(this.originalsDir, parsed.base));
                candidates.add(path.join(this.thumbnailsDir, `${parsed.name}_thumb${parsed.ext}`));
            }

            let deleted = 0;
            for (const candidate of candidates) {
                if (fs.existsSync(candidate)) {
                    fs.unlinkSync(candidate);
                    deleted += 1;
                }
            }

            if (deleted === 0) {
                logger.warn(`Image not found: ${filename}`);
                return false;
            }

            logger.info(`Deleted image set: ${filename} (${deleted} file(s))`);
            return true;
        } catch (error) {
            logger.error('UploadService.deleteImage failed', error);
            throw error;
        }
    }

    /**
     * 获取图片完整路径（用于前端访问）
     * @param {string} filename - 图片文件名
     */
    getImagePath(filename) {
        if (!filename) return null;
        return this._resolveSafePath(filename);
    }

    /**
     * 清理孤立的图片文件（没有被任何题目引用）
     * @param {Array} usedFilenames - 正在使用的文件名数组
     */
    async cleanupOrphanedImages(usedFilenames = []) {
        try {
            const files = fs.readdirSync(this.imagesDir);
            let deletedCount = 0;

            for (const file of files) {
                if (!usedFilenames.includes(file)) {
                    const filePath = path.join(this.imagesDir, file);
                    fs.unlinkSync(filePath);
                    deletedCount++;
                    logger.debug(`Cleaned up orphaned image: ${file}`);
                }
            }

            logger.info(`Orphaned images cleanup completed: ${deletedCount} files deleted`);
            return deletedCount;
        } catch (error) {
            logger.error('UploadService.cleanupOrphanedImages failed', error);
            throw error;
        }
    }

    /**
     * 验证图片文件
     * @private
     */
    _validateImage(fileData) {
        // 验证文件名
        if (!fileData.name) {
            throw new Error('File name is required');
        }

        // 验证文件数据
        if (!fileData.data || !Buffer.isBuffer(fileData.data)) {
            throw new Error('Invalid file data');
        }

        // 验证文件类型
        const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
        if (fileData.type && !validTypes.includes(fileData.type)) {
            throw new Error(`Invalid file type: ${fileData.type}. Allowed types: ${validTypes.join(', ')}`);
        }

        // 验证文件扩展名
        const ext = path.extname(fileData.name).toLowerCase();
        const validExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
        if (!validExts.includes(ext)) {
            throw new Error(`Invalid file extension: ${ext}. Allowed extensions: ${validExts.join(', ')}`);
        }

        // 验证文件大小（限制5MB）
        const maxSize = 5 * 1024 * 1024; // 5MB
        if (fileData.data.length > maxSize) {
            throw new Error(`File size exceeds limit: ${(fileData.data.length / 1024 / 1024).toFixed(2)}MB > 5MB`);
        }
    }

    /**
     * 生成唯一文件名
     * @private
     */
    _generateFilename(ext) {
        const timestamp = Date.now();
        const random = crypto.randomBytes(8).toString('hex');
        return `${timestamp}_${random}${ext}`;
    }

    /**
     * 生成 150x150 缩略图
     * @private
     */
    _generateThumbnail(buffer, originalFilename, originalExt) {
        const ext = ['.jpg', '.jpeg', '.png', '.webp'].includes(originalExt.toLowerCase())
            ? originalExt.toLowerCase()
            : '.png';
        const baseName = path.parse(originalFilename).name;

        const image = nativeImage.createFromBuffer(Buffer.from(buffer));
        const thumb = image.resize({ width: 150, height: 150, quality: 'good' });

        let thumbnailName = `${baseName}_thumb.png`;
        let outputBuffer;
        if (ext === '.jpg' || ext === '.jpeg') {
            thumbnailName = `${baseName}_thumb.jpg`;
            outputBuffer = thumb.toJPEG(85);
        } else {
            // PNG/WebP 统一写 PNG，避免跨平台编码差异
            outputBuffer = thumb.toPNG();
        }

        const thumbnailPath = path.join(this.thumbnailsDir, thumbnailName);
        fs.writeFileSync(thumbnailPath, outputBuffer);
        return thumbnailName;
    }

    /**
     * 校验并解析图片路径
     * @private
     */
    _resolveSafePath(filename) {
        const normalized = String(filename).replace(/^\/+/, '');
        const resolved = path.resolve(this.imagesDir, normalized);
        if (!resolved.startsWith(this.imagesDir)) {
            throw new Error('Invalid file path');
        }
        return resolved;
    }
}

module.exports = UploadService;
