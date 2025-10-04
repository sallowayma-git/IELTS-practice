import { createRouter, createWebHistory } from 'vue-router'
import legacyRoutes from './legacy'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'Home',
      component: () => import('@/views/HomeView.vue')
    },
    {
      path: '/test',
      name: 'Test',
      component: () => import('@/views/TestView.vue')
    },
    {
      path: '/writing',
      name: 'Writing',
      component: () => import('@/views/WritingView.vue')
    },
    {
      path: '/assessment/:id',
      name: 'Assessment',
      component: () => import('@/views/AssessmentView.vue')
    },
    {
      path: '/history',
      name: 'History',
      component: () => import('@/views/HistoryView.vue')
    },
    {
      path: '/settings',
      name: 'Settings',
      component: () => import('@/views/SettingsView.vue')
    },
    // Legacy系统路由
    ...legacyRoutes
  ]
})

export default router