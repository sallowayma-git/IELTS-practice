/**
 * 跨窗口通信错误恢复机制
 * 负责检测和修复跨窗口通信问题
 */
class CommunicationRecovery {
    constructor() {
        this.activeConnections = new Map();
        this.failedConnections = new Set();
        this.recoveryAttempts = new Map();
        this.maxRecoveryAttempts = 3;
        this.heartbeatInterval = 5000; // 5秒心跳检测
        this.recoveryStrategies = new Map();
        
        // 注册默认恢复策略
        this.registerDefaultStrategies();
        
        // 启动心跳检测
        this.startHeartbeat();
        
        console.log('[CommunicationRecovery] 通信恢复机制已初始化');
    }

    /**
     * 注册默认恢复策略
     */
    registerDefaultStrategies() {
        this.recoveryStrategies.set('connection_lost', this.recoverConnectionLost.bind(this));
        this.recoveryStrategies.set('message_timeout', this.recoverMessageTimeout.bind(this));
        this.recoveryStrategies.set('window_closed', this.recoverWindowClosed.bind(this));
        this.recoveryStrategies.set('permission_denied', this.recoverPermissionDenied.bind(this));
    }

    /**
     * 注册窗口连接
     */
    registerConnection(windowId, windowRef, metadata = {}) {
        const connection = {
            id: windowId,
            window: windowRef,
            metadata: metadata,
            lastHeartbeat: Date.now(),
            status: 'active',
            messageQueue: [],
            recoveryCount: 0
        };

        this.activeConnections.set(windowId, connection);
        console.log(`[CommunicationRecovery] 已注册连接: ${windowId}`);
        
        // 发送初始心跳
        this.sendHeartbeat(windowId);
    }

    /**
     * 注销窗口连接
     */
    unregisterConnection(windowId) {
        if (this.activeConnections.has(windowId)) {
            this.activeConnections.delete(windowId);
            this.failedConnections.delete(windowId);
            this.recoveryAttempts.delete(windowId);
            console.log(`[CommunicationRecovery] 已注销连接: ${windowId}`);
        }
    }

    /**
     * 发送消息（带错误恢复）
     */
    sendMessage(windowId, message, options = {}) {
        const connection = this.activeConnections.get(windowId);
        if (!connection) {
            console.warn(`[CommunicationRecovery] 连接不存在: ${windowId}`);
            return false;
        }

        try {
            // 检查窗口是否仍然有效
            if (connection.window.closed) {
                this.handleConnectionError(windowId, 'window_closed');
                return false;
            }

            // 添加消息ID和时间戳
            const enhancedMessage = {
                ...message,
                messageId: this.generateMessageId(),
                timestamp: Date.now(),
                sender: 'main_window'
            };

            // 发送消息
            connection.window.postMessage(enhancedMessage, '*');
            
            // 更新最后活动时间
            connection.lastHeartbeat = Date.now();
            connection.status = 'active';
            
            console.log(`[CommunicationRecovery] 消息已发送到 ${windowId}:`, message.type);
            return true;

        } catch (error) {
            console.error(`[CommunicationRecovery] 发送消息失败 ${windowId}:`, error);
            
            // 将消息加入队列等待重试
            if (options.retry !== false) {
                connection.messageQueue.push({ message, options, timestamp: Date.now() });
            }
            
            // 触发错误恢复
            this.handleConnectionError(windowId, 'message_send_failed', error);
            return false;
        }
    }

    /**
     * 处理连接错误
     */
    handleConnectionError(windowId, errorType, error = null) {
        console.warn(`[CommunicationRecovery] 连接错误 ${windowId}: ${errorType}`);
        
        const connection = this.activeConnections.get(windowId);
        if (!connection) return;

        // 标记连接为失败
        connection.status = 'failed';
        this.failedConnections.add(windowId);

        // 记录错误详情
        const errorDetails = {
            windowId: windowId,
            errorType: errorType,
            error: error,
            timestamp: Date.now(),
            recoveryCount: connection.recoveryCount
        };

        // 尝试恢复
        this.attemptRecovery(windowId, errorType, errorDetails);
    }

    /**
     * 尝试恢复连接
     */
    async attemptRecovery(windowId, errorType, errorDetails) {
        const connection = this.activeConnections.get(windowId);
        if (!connection) return;

        // 检查恢复次数限制
        if (connection.recoveryCount >= this.maxRecoveryAttempts) {
            console.error(`[CommunicationRecovery] 恢复次数超限 ${windowId}`);
            this.markConnectionAsPermanentlyFailed(windowId);
            return;
        }

        connection.recoveryCount++;
        console.log(`[CommunicationRecovery] 尝试恢复连接 ${windowId} (第${connection.recoveryCount}次)`);

        // 获取恢复策略
        const strategy = this.recoveryStrategies.get(errorType);
        if (strategy) {
            try {
                const success = await strategy(windowId, errorDetails);
                if (success) {
                    console.log(`[CommunicationRecovery] 连接恢复成功: ${windowId}`);
                    this.markConnectionAsRecovered(windowId);
                } else {
                    console.warn(`[CommunicationRecovery] 连接恢复失败: ${windowId}`);
                    // 延迟后重试
                    setTimeout(() => {
                        this.attemptRecovery(windowId, errorType, errorDetails);
                    }, 2000 * connection.recoveryCount);
                }
            } catch (recoveryError) {
                console.error(`[CommunicationRecovery] 恢复策略执行失败:`, recoveryError);
            }
        } else {
            console.warn(`[CommunicationRecovery] 未找到恢复策略: ${errorType}`);
        }
    }

    /**
     * 恢复策略：连接丢失
     */
    async recoverConnectionLost(windowId, errorDetails) {
        console.log(`[CommunicationRecovery] 恢复连接丢失: ${windowId}`);
        
        const connection = this.activeConnections.get(windowId);
        if (!connection) return false;

        try {
            // 尝试重新建立通信
            if (connection.window && !connection.window.closed) {
                // 发送重连消息
                const reconnectMessage = {
                    type: 'RECONNECT_REQUEST',
                    data: {
                        windowId: windowId,
                        timestamp: Date.now()
                    }
                };

                connection.window.postMessage(reconnectMessage, '*');
                
                // 等待响应
                return new Promise((resolve) => {
                    const timeout = setTimeout(() => {
                        resolve(false);
                    }, 3000);

                    const messageHandler = (event) => {
                        if (event.data && event.data.type === 'RECONNECT_RESPONSE' && 
                            event.data.data.windowId === windowId) {
                            clearTimeout(timeout);
                            window.removeEventListener('message', messageHandler);
                            resolve(true);
                        }
                    };

                    window.addEventListener('message', messageHandler);
                });
            }
            
            return false;
        } catch (error) {
            console.error(`[CommunicationRecovery] 连接丢失恢复失败:`, error);
            return false;
        }
    }

    /**
     * 恢复策略：消息超时
     */
    async recoverMessageTimeout(windowId, errorDetails) {
        console.log(`[CommunicationRecovery] 恢复消息超时: ${windowId}`);
        
        const connection = this.activeConnections.get(windowId);
        if (!connection) return false;

        try {
            // 重新发送队列中的消息
            const queuedMessages = [...connection.messageQueue];
            connection.messageQueue = [];

            for (const queuedMessage of queuedMessages) {
                // 检查消息是否过期（超过30秒）
                if (Date.now() - queuedMessage.timestamp > 30000) {
                    console.warn(`[CommunicationRecovery] 消息已过期，跳过: ${queuedMessage.message.type}`);
                    continue;
                }

                // 重新发送消息
                const success = this.sendMessage(windowId, queuedMessage.message, {
                    ...queuedMessage.options,
                    retry: false // 避免无限重试
                });

                if (!success) {
                    // 如果仍然失败，重新加入队列
                    connection.messageQueue.push(queuedMessage);
                }
            }

            return connection.messageQueue.length === 0;
        } catch (error) {
            console.error(`[CommunicationRecovery] 消息超时恢复失败:`, error);
            return false;
        }
    }

    /**
     * 恢复策略：窗口关闭
     */
    async recoverWindowClosed(windowId, errorDetails) {
        console.log(`[CommunicationRecovery] 恢复窗口关闭: ${windowId}`);
        
        const connection = this.activeConnections.get(windowId);
        if (!connection) return false;

        // 窗口关闭通常无法恢复，但可以尝试重新打开
        try {
            if (connection.metadata && connection.metadata.url) {
                console.log(`[CommunicationRecovery] 尝试重新打开窗口: ${connection.metadata.url}`);
                
                const newWindow = window.open(
                    connection.metadata.url,
                    windowId,
                    connection.metadata.features || 'width=1200,height=800'
                );

                if (newWindow) {
                    // 更新连接引用
                    connection.window = newWindow;
                    connection.status = 'reconnecting';
                    
                    // 等待新窗口加载完成
                    return new Promise((resolve) => {
                        const checkReady = () => {
                            try {
                                if (newWindow.document.readyState === 'complete') {
                                    resolve(true);
                                } else {
                                    setTimeout(checkReady, 500);
                                }
                            } catch (error) {
                                // 跨域访问限制，假设已加载完成
                                setTimeout(() => resolve(true), 2000);
                            }
                        };
                        
                        setTimeout(checkReady, 1000);
                    });
                }
            }
            
            return false;
        } catch (error) {
            console.error(`[CommunicationRecovery] 窗口关闭恢复失败:`, error);
            return false;
        }
    }

    /**
     * 恢复策略：权限拒绝
     */
    async recoverPermissionDenied(windowId, errorDetails) {
        console.log(`[CommunicationRecovery] 恢复权限拒绝: ${windowId}`);
        
        // 权限问题通常需要用户干预
        if (window.showMessage) {
            window.showMessage(
                '浏览器阻止了弹窗，请允许弹窗后重试',
                'warning'
            );
        }
        
        return false;
    }

    /**
     * 标记连接为已恢复
     */
    markConnectionAsRecovered(windowId) {
        const connection = this.activeConnections.get(windowId);
        if (connection) {
            connection.status = 'active';
            connection.recoveryCount = 0;
            connection.lastHeartbeat = Date.now();
            this.failedConnections.delete(windowId);
            
            console.log(`[CommunicationRecovery] 连接已恢复: ${windowId}`);
            
            // 处理队列中的消息
            this.processMessageQueue(windowId);
        }
    }

    /**
     * 标记连接为永久失败
     */
    markConnectionAsPermanentlyFailed(windowId) {
        const connection = this.activeConnections.get(windowId);
        if (connection) {
            connection.status = 'permanently_failed';
            console.error(`[CommunicationRecovery] 连接永久失败: ${windowId}`);
            
            if (window.showMessage) {
                window.showMessage(
                    `与练习页面的连接已断开: ${windowId}`,
                    'error'
                );
            }
        }
    }

    /**
     * 处理消息队列
     */
    processMessageQueue(windowId) {
        const connection = this.activeConnections.get(windowId);
        if (!connection || connection.messageQueue.length === 0) return;

        console.log(`[CommunicationRecovery] 处理消息队列 ${windowId}: ${connection.messageQueue.length} 条消息`);
        
        const messages = [...connection.messageQueue];
        connection.messageQueue = [];

        messages.forEach(queuedMessage => {
            this.sendMessage(windowId, queuedMessage.message, {
                ...queuedMessage.options,
                retry: false
            });
        });
    }

    /**
     * 启动心跳检测
     */
    startHeartbeat() {
        setInterval(() => {
            this.performHeartbeatCheck();
        }, this.heartbeatInterval);
        
        console.log(`[CommunicationRecovery] 心跳检测已启动 (${this.heartbeatInterval}ms)`);
    }

    /**
     * 执行心跳检测
     */
    performHeartbeatCheck() {
        const now = Date.now();
        const timeout = this.heartbeatInterval * 2; // 2倍心跳间隔为超时

        this.activeConnections.forEach((connection, windowId) => {
            if (connection.status === 'active' && 
                now - connection.lastHeartbeat > timeout) {
                
                console.warn(`[CommunicationRecovery] 心跳超时: ${windowId}`);
                this.handleConnectionError(windowId, 'connection_lost');
            } else if (connection.status === 'active') {
                // 发送心跳
                this.sendHeartbeat(windowId);
            }
        });
    }

    /**
     * 发送心跳
     */
    sendHeartbeat(windowId) {
        const heartbeatMessage = {
            type: 'HEARTBEAT',
            data: {
                timestamp: Date.now()
            }
        };

        this.sendMessage(windowId, heartbeatMessage, { retry: false });
    }

    /**
     * 处理心跳响应
     */
    handleHeartbeatResponse(windowId) {
        const connection = this.activeConnections.get(windowId);
        if (connection) {
            connection.lastHeartbeat = Date.now();
            if (connection.status === 'failed') {
                this.markConnectionAsRecovered(windowId);
            }
        }
    }

    /**
     * 生成消息ID
     */
    generateMessageId() {
        return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 获取连接状态
     */
    getConnectionStatus(windowId) {
        const connection = this.activeConnections.get(windowId);
        return connection ? connection.status : 'not_found';
    }

    /**
     * 获取所有连接状态
     */
    getAllConnectionStatus() {
        const status = {};
        this.activeConnections.forEach((connection, windowId) => {
            status[windowId] = {
                status: connection.status,
                lastHeartbeat: connection.lastHeartbeat,
                recoveryCount: connection.recoveryCount,
                queuedMessages: connection.messageQueue.length
            };
        });
        return status;
    }

    /**
     * 清理所有连接
     */
    cleanup() {
        console.log('[CommunicationRecovery] 清理所有连接');
        this.activeConnections.clear();
        this.failedConnections.clear();
        this.recoveryAttempts.clear();
    }
}

// 导出类
window.CommunicationRecovery = CommunicationRecovery;