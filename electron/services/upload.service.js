const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Upload Service
 * 图片上传处理服务
 */
class UploadService {
    constructor() {
        // 图片存储目录
        this.imagesDir = path.join(app.getPath('userData'), 'images');
        this._ensureImagesDir();
    }

    /**
     * 确保images目录存在
     * @private
     */
    _ensureImagesDir() {
        if (!fs.existsSync(this.imagesDir)) {
            fs.mkdirSync(this.imagesDir, { recursive: true });
            logger.info(`Created images directory: ${this.imagesDir}`);
        }
    }

    /**
     * 上传图片
     * @param {Object} fileData - { name, data (Buffer), type }
     * @returns {Object} - { image_path, size }
     */
    async uploadImage(fileData) {
        try {
            // 验证文件
            this._validateImage(fileData);

            // 生成唯一文件名
            const ext = path.extname(fileData.name) || '.png';
            const filename = this._generateFilename(ext);
            const filePath = path.join(this.imagesDir, filename);

            // 保存文件
            fs.writeFileSync(filePath, fileData.data);

            const stats = fs.statSync(filePath);
            logger.info(`Uploaded image: ${filename} (${stats.size} bytes)`);

            return {
                image_path: filename,  // 只返回文件名，不含完整路径
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
            const filePath = path.join(this.imagesDir, filename);

            if (!fs.existsSync(filePath)) {
                logger.warn(`Image not found: ${filename}`);
                return false;
            }

            // 安全检查：确保路径在 images 目录内
            if (!filePath.startsWith(this.imagesDir)) {
                throw new Error('Invalid file path');
            }

            fs.unlinkSync(filePath);
            logger.info(`Deleted image: ${filename}`);
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
        return path.join(this.imagesDir, filename);
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
}

module.exports = UploadService;
