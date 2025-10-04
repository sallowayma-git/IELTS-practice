import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
import router from './router'

console.log('开始初始化应用...')

try {
  const app = createApp(App)

  app.use(createPinia())
  app.use(router)
  app.use(ElementPlus)

  console.log('准备挂载应用...')
  app.mount('#app')
  console.log('应用挂载成功！')
} catch (error) {
  console.error('应用初始化失败:', error)
  document.getElementById('app').innerHTML = `
    <div style="padding: 20px; color: red;">
      <h1>应用启动失败</h1>
      <p>错误信息: ${error.message}</p>
      <pre>${error.stack}</pre>
    </div>
  `
}