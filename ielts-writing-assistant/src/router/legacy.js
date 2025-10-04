/**
 * Legacy系统路由配置
 * 处理Legacy系统的页面路由和导航
 */

import LegacyWrapper from '@/components/LegacyWrapper.vue'

const legacyRoutes = [
  {
    path: '/legacy',
    name: 'Legacy',
    component: LegacyWrapper,
    meta: {
      title: 'IELTS听力与阅读练习',
      requiresAuth: true,
      keepAlive: true,
      isLegacy: true
    },
    children: [
      {
        path: 'listening',
        name: 'LegacyListening',
        component: LegacyWrapper,
        props: {
          autoLoadModule: 'listening',
          entryUrl: ''
        },
        meta: {
          title: '听力练习',
          module: 'listening'
        }
      },
      {
        path: 'reading',
        name: 'LegacyReading',
        component: LegacyWrapper,
        props: {
          autoLoadModule: 'reading',
          entryUrl: ''
        },
        meta: {
          title: '阅读练习',
          module: 'reading'
        }
      },
      {
        path: 'vocabulary',
        name: 'LegacyVocabulary',
        component: LegacyWrapper,
        props: {
          autoLoadModule: 'vocabulary',
          entryUrl: ''
        },
        meta: {
          title: '词汇练习',
          module: 'vocabulary'
        }
      },
      {
        path: 'index',
        name: 'LegacyIndex',
        component: LegacyWrapper,
        props: {
          entryUrl: ''
        },
        meta: {
          title: 'Legacy系统首页'
        }
      }
    ]
  },
  {
    path: '/legacy/:module',
    name: 'LegacyModule',
    component: LegacyWrapper,
    props: (route) => ({
      autoLoadModule: route.params.module,
      entryUrl: ''
    }),
    meta: {
      title: 'Legacy模块',
      requiresAuth: true,
      isLegacy: true
    }
  }
]

// 导出路由配置
export default legacyRoutes