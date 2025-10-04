import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
import router from './router'

console.log('开始初始化应用...')

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(ElementPlus)

console.log('准备挂载应用...')
app.mount('#app')
console.log('应用挂载成功！')