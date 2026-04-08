import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import './styles/main.css'
import './assets/writing-design.css'

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidSessionId(sessionId) {
    return SESSION_ID_PATTERN.test(String(sessionId || '').trim())
}

function hasSessionCache(sessionId) {
    if (typeof window === 'undefined') return false
    return window.sessionStorage.getItem(`evaluation_${sessionId}`) !== null
}

function hasValidEssayIdQuery(route) {
    const rawEssayId = Array.isArray(route.query.essayId)
        ? route.query.essayId[0]
        : route.query.essayId
    const essayId = Number(rawEssayId)
    return Number.isInteger(essayId) && essayId > 0
}

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
        },
        {
            path: '/settings',
            name: 'Settings',
            component: () => import('./views/SettingsPage.vue')
        },
        {
            path: '/:pathMatch(.*)*',
            redirect: { name: 'Compose' }
        }
    ]
})

router.beforeEach((to, from, next) => {
    if (to.name === 'Evaluating') {
        const sessionId = String(to.params.sessionId || '').trim()
        if (!isValidSessionId(sessionId)) {
            return next({ name: 'Compose' })
        }

        if (from.name === 'Compose') {
            return next()
        }

        if (hasSessionCache(sessionId)) {
            return next({
                name: 'Result',
                params: { sessionId }
            })
        }

        return next({ name: 'Compose' })
    }

    if (to.name === 'Result') {
        const sessionId = String(to.params.sessionId || '').trim()
        if (!isValidSessionId(sessionId)) {
            return next({ name: 'Compose' })
        }

        if (from.name === 'Evaluating' || hasValidEssayIdQuery(to) || hasSessionCache(sessionId)) {
            return next()
        }

        return next({ name: 'Compose' })
    }

    return next()
})

const app = createApp(App)
app.use(router)
app.mount('#app')
