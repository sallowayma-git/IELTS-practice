const OpenAIService = require('./openai')
const AzureOpenAIService = require('./azure')
const MockLLMService = require('./mock')

/**
 * LLM服务工厂
 */
class LLMServiceFactory {
  static services = new Map()
  static defaultProvider = 'mock'

  /**
   * 注册服务提供商
   * @param {string} provider 提供商名称
   * @param {Function} serviceClass 服务类
   */
  static registerProvider(provider, serviceClass) {
    this.services.set(provider.toLowerCase(), serviceClass)
  }

  /**
   * 创建LLM服务实例
   * @param {string} provider 提供商名称
   * @param {Object} config 配置信息
   * @returns {BaseLLMService} 服务实例
   */
  static createService(provider, config) {
    const providerKey = provider.toLowerCase()
    const ServiceClass = this.services.get(providerKey)

    if (!ServiceClass) {
      throw new Error(`不支持的AI服务提供商: ${provider}`)
    }

    try {
      return new ServiceClass(config)
    } catch (error) {
      console.error(`创建${provider}服务失败:`, error)
      throw new Error(`AI服务初始化失败: ${error.message}`)
    }
  }

  /**
   * 获取支持的服务提供商列表
   * @returns {string[]} 提供商列表
   */
  static getSupportedProviders() {
    return Array.from(this.services.keys())
  }

  /**
   * 测试服务提供商
   * @param {string} provider 提供商名称
   * @param {Object} config 配置信息
   * @returns {Promise<boolean>} 测试结果
   */
  static async testProvider(provider, config) {
    try {
      const service = this.createService(provider, config)
      return await service.testConnection()
    } catch (error) {
      console.error(`测试${provider}服务失败:`, error)
      return false
    }
  }

  /**
   * 设置默认提供商
   * @param {string} provider 提供商名称
   */
  static setDefaultProvider(provider) {
    if (this.services.has(provider.toLowerCase())) {
      this.defaultProvider = provider.toLowerCase()
    } else {
      throw new Error(`不支持的提供商: ${provider}`)
    }
  }

  /**
   * 获取默认提供商
   * @returns {string} 默认提供商
   */
  static getDefaultProvider() {
    return this.defaultProvider
  }
}

// 注册默认的服务提供商
LLMServiceFactory.registerProvider('openai', OpenAIService)
LLMServiceFactory.registerProvider('azure', AzureOpenAIService)
LLMServiceFactory.registerProvider('azure-openai', AzureOpenAIService)
LLMServiceFactory.registerProvider('mock', MockLLMService)

module.exports = LLMServiceFactory