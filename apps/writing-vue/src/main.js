import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import './styles/main.css'

// 路由配置 (Hash 模式，file:// 兼容)
const router = createRouter({
    history: createWebHashHistory(),
    routes: [
        {
            path: '/',
            name: 'Compose',
            component: () => import('./views/ComposePage.vue')
        },
        {
            path: '/evaluating/:sessionId',
            name: 'Evaluating',
            component: () => import('./views/EvaluatingPage.vue'),
            props: true
        },
        {
            path: '/result/:sessionId',
            name: 'Result',
            component: () => import('./views/ResultPage.vue'),
            props: true
        },
        {
            path: '/topics',
            name: 'TopicManage',
            component: () => import('./views/TopicManagePage.vue')
        },
        {
            path: '/history',
            name: 'History',
            component: () => import('./views/HistoryPage.vue')
        }
    ]
})

const app = createApp(App)
app.use(router)
app.mount('#app')
