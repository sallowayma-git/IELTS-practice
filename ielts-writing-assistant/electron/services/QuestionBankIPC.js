/**
 * 题库服务IPC处理器
 * 提供安全的IPC接口供渲染进程调用
 */

class QuestionBankIPC {
  constructor(questionBankService) {
    this.questionBankService = questionBankService
  }

  /**
   * 注册所有IPC处理器
   */
  registerHandlers() {
    const { ipcMain } = require('electron')

    // 服务管理
    ipcMain.handle('questionbank:initialize', async () => {
      return await this.questionBankService.initialize()
    })

    ipcMain.handle('questionbank:get-status', () => {
      return this.questionBankService.getStatus()
    })

    // 题库导入
    ipcMain.handle('questionbank:select-directory', async () => {
      const { dialog } = require('electron')

      const result = await dialog.showOpenDialog({
        title: '选择题库目录',
        properties: ['openDirectory'],
        buttonLabel: '选择此目录'
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true }
      }

      return {
        canceled: false,
        selectedPath: result.filePaths[0]
      }
    })

    ipcMain.handle('questionbank:import', async (event, selectedPath) => {
      try {
        const importResult = await this.questionBankService.importQuestionBank(selectedPath)
        return { success: true, result: importResult }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 题目查询
    ipcMain.handle('questionbank:get-questions', async (event, options = {}) => {
      return await this.questionBankService.getQuestions(options)
    })

    ipcMain.handle('questionbank:get-question-by-id', async (event, questionId) => {
      return await this.questionBankService.getQuestionById(questionId)
    })

    ipcMain.handle('questionbank:get-statistics', () => {
      return this.questionBankService.getStatistics()
    })

    // 题库管理
    ipcMain.handle('questionbank:refresh-index', async () => {
      try {
        await this.questionBankService.loadIndex()
        return { success: true }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('questionbank:validate-integrity', async () => {
      try {
        await this.questionBankService.validateIndex()
        return { valid: true }
      } catch (error) {
        return { valid: false, error: error.message }
      }
    })

    ipcMain.handle('questionbank:create-backup', async () => {
      try {
        await this.questionBankService.createIndexBackup()
        return { success: true }
      } catch (error) {
        return { success: false, error: error.message }
      }
    })

    // 事件监听器注册
    ipcMain.handle('questionbank:add-event-listener', (event, eventName) => {
      const listener = (data) => {
        event.sender.send(`questionbank:event-${eventName}`, data)
      }

      this.questionBankService.on(eventName, listener)

      // 返回监听器ID用于后续移除
      return `listener-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    })

    ipcMain.handle('questionbank:remove-event-listener', (event, listenerId) => {
      // 简化处理：移除所有监听器
      this.questionBankService.eventListeners.clear()
      return true
    })
  }
}

module.exports = QuestionBankIPC