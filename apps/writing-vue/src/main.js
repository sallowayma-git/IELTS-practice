import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import { featureFlags } from './config/feature-flags.js'
import './assets/writing-design.css'
import './styles/main.css'
import './styles/a11y-performance.css'

const SESSION_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/i

function isValidSessionId(sessionId) {
    return SESSION_ID_PATTERN.test(String(sessionId || '').trim())
}

// Hash history is the Tauri WebView navigation boundary.
const router = createRouter({
    history: createWebHashHistory(),
    routes: [
        {
            path: '/',
            name: 'PracticeLibrary',
            component: () => import('./views/PracticeLibraryPage.vue')
        },
        {
            path: '/writing',
            name: 'Compose',
            component: () => import('./views/ComposePage.vue')
        },
        {
            path: '/library',
            name: 'PracticeLibraryAlias',
            redirect: { name: 'PracticeLibrary' }
        },
        ...(featureFlags.learnerModelV1 ? [{
            path: '/reading/learner',
            name: 'ReadingLearnerModel',
            component: () => import('./views/LearnerModelPage.vue')
        }] : []),
        ...(featureFlags.agentWorkspaceV1 ? [{
            path: '/agent',
            name: 'AgentConsole',
            component: () => import('./views/AgentConsolePage.vue')
        }, {
            path: '/memory-center',
            name: 'MemoryCenter',
            redirect: { name: 'AgentConsole' }
        }] : []),
        {
            path: '/reading/:assetId',
            name: 'PracticeReading',
            component: () => import('./views/PracticeReadingPage.vue'),
            props: true
        },
        {
            path: '/reading-suite/:sessionId',
            name: 'PracticeReadingSuite',
            component: () => import('./views/PracticeReadingSuitePage.vue'),
            props: true
        },
        {
            path: '/reading/:assetId/review/:sessionId',
            name: 'PracticeReadingReview',
            component: () => import('./views/PracticeReadingPage.vue'),
            props: true
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
            redirect: { name: 'PracticeLibrary' }
        }
    ]
})

router.beforeEach((to) => {
    if (to.name === 'Evaluating' || to.name === 'Result') {
        const sessionId = String(to.params.sessionId || '').trim()
        if (!isValidSessionId(sessionId)) {
            return { name: 'Compose' }
        }
    }
    return true
})

const app = createApp(App)
app.use(router)
app.mount('#app')

if (typeof window !== 'undefined') {
    try {
        window.dispatchEvent(new CustomEvent('app-runtime-ready'))
    } catch (error) {
        console.warn('[PracticeShell] app-runtime-ready dispatch failed:', error)
    }
}
