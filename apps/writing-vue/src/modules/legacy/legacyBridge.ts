import { loadLegacyScript, loadLegacyStyle } from './legacyScriptLoader'

const legacyWindow = window as Window & Record<string, any>
export const PRACTICE_TIMER_BRIDGE_KEY = '__IELTS_PRACTICE_TIMER__'
export const PRACTICE_TIMER_EVENT = 'practiceTimerStateChange'

type PracticeTimerSnapshot = Record<string, any>
type PracticeTimerBridgeOptions = {
  getSnapshot: () => PracticeTimerSnapshot,
  pause?: () => void,
  resume?: () => void,
  setRunning?: (nextRunning: boolean) => void
}
type PracticeTimerBridge = {
  eventName: string,
  getSnapshot: () => PracticeTimerSnapshot,
  pause: () => void,
  resume: () => void,
  setRunning: (nextRunning: boolean) => void,
  __owner: symbol
}

const LEGACY_MORE_TOOL_SCRIPTS = [
  'js/utils/vocabDataIO.js',
  'js/core/vocabScheduler.js',
  'js/core/vocabStore.js',
  'js/app/vocabListSwitcher.js',
  'js/components/vocabDashboardCards.js',
  'js/components/vocabSessionView.js',
  'js/services/achievementManager.js',
  'js/presentation/moreView.js'
]

const SHUI_LOADER_OPTIONS = {
  markerAttribute: 'data-shui-bg-script',
  errorPrefix: '加载背景脚本失败：'
}

const THREE_VENDOR_SCRIPT = 'assets/vendor/three.min.js'
const THREE_BACKGROUND_SCRIPT = 'js/presentation/threeBackground.js'

let legacyMoreToolsPromise: Promise<void> | null = null
let legacyOnboardingPromise: Promise<void> | null = null
let legacyUpdateManagerPromise: Promise<any> | null = null
let legacyShuiBackgroundPromise: Promise<void> | null = null

function resolvePracticeTimerBridge() {
  const currentBridge = legacyWindow[PRACTICE_TIMER_BRIDGE_KEY]
  if (!currentBridge || typeof currentBridge !== 'object') {
    return null
  }
  return currentBridge as PracticeTimerBridge
}

export function emitPracticeTimerStateChange(getSnapshot: () => PracticeTimerSnapshot) {
  window.dispatchEvent(new CustomEvent(PRACTICE_TIMER_EVENT, {
    detail: getSnapshot()
  }))
}

export function installPracticeTimerBridge(options: PracticeTimerBridgeOptions) {
  const owner = Symbol('practice-timer-bridge')
  const bridge: PracticeTimerBridge = {
    eventName: PRACTICE_TIMER_EVENT,
    getSnapshot: () => options.getSnapshot(),
    pause: () => options.pause?.(),
    resume: () => options.resume?.(),
    setRunning: (nextRunning: boolean) => options.setRunning?.(nextRunning),
    __owner: owner
  }
  legacyWindow[PRACTICE_TIMER_BRIDGE_KEY] = bridge
  emitPracticeTimerStateChange(bridge.getSnapshot)
  return owner
}

export function removePracticeTimerBridge(owner: symbol) {
  const currentBridge = resolvePracticeTimerBridge()
  if (!currentBridge || currentBridge.__owner !== owner) {
    return
  }
  delete legacyWindow[PRACTICE_TIMER_BRIDGE_KEY]
}

function ensureLegacyMoreView() {
  legacyWindow.ensureMoreView?.()
}

function ensureUpdateManagerInstance() {
  if (legacyWindow.appUpdateManager && typeof legacyWindow.appUpdateManager.handleAction === 'function') {
    return Promise.resolve(legacyWindow.appUpdateManager)
  }
  if (typeof legacyWindow.AppUpdateManager !== 'function') {
    return Promise.reject(new Error('AppUpdateManager 未加载'))
  }
  const manager = new legacyWindow.AppUpdateManager()
  legacyWindow.appUpdateManager = manager
  return manager.init().then(() => manager)
}

export function ensureLegacyMoreTools() {
  if (legacyWindow.VocabSessionView && legacyWindow.showAchievements && legacyWindow.openClockOverlay) {
    return Promise.resolve()
  }
  if (!legacyMoreToolsPromise) {
    legacyMoreToolsPromise = loadLegacyStyle('css/main.css')
      .then(() => LEGACY_MORE_TOOL_SCRIPTS.reduce(
        (chain, scriptPath) => chain.then(() => loadLegacyScript(scriptPath)),
        Promise.resolve()
      ))
      .catch((error) => {
        legacyMoreToolsPromise = null
        throw error
      })
  }
  return legacyMoreToolsPromise
}

export function ensureLegacyOnboarding() {
  if (legacyWindow.OnboardingTour && typeof legacyWindow.OnboardingTour.start === 'function') {
    return Promise.resolve()
  }
  if (!legacyOnboardingPromise) {
    legacyOnboardingPromise = loadLegacyStyle('css/onboarding.css')
      .then(() => loadLegacyScript('js/components/onboardingTour.js'))
      .then(() => {
        legacyWindow.OnboardingTour?.init?.()
      })
      .catch((error) => {
        legacyOnboardingPromise = null
        throw error
      })
  }
  return legacyOnboardingPromise
}

export async function startLegacyOnboardingTour() {
  await ensureLegacyOnboarding()
  if (!legacyWindow.OnboardingTour || typeof legacyWindow.OnboardingTour.start !== 'function') {
    throw new Error('OnboardingTour 未加载')
  }
  legacyWindow.OnboardingTour.start(true)
}

export function ensureLegacyUpdateManager() {
  if (legacyWindow.appUpdateManager && typeof legacyWindow.appUpdateManager.handleAction === 'function') {
    return Promise.resolve(legacyWindow.appUpdateManager)
  }
  if (!legacyUpdateManagerPromise) {
    legacyUpdateManagerPromise = loadLegacyStyle('css/main.css')
      .then(() => loadLegacyScript('js/integration/updateManager.js'))
      .then(() => ensureUpdateManagerInstance())
      .catch((error) => {
        legacyUpdateManagerPromise = null
        throw error
      })
  }
  return legacyUpdateManagerPromise
}

export async function openLegacyUpdateManager() {
  const manager = await ensureLegacyUpdateManager()
  if (typeof manager.handleAction === 'function') {
    await manager.handleAction('open-modal')
    return
  }
  manager.showModal?.()
  await manager.ensureAutoCheck?.()
}

export async function openLegacyClockOverlay() {
  await ensureLegacyMoreTools()
  ensureLegacyMoreView()
  if (typeof legacyWindow.openClockOverlay !== 'function') {
    throw new Error('MoreView 时钟模块未加载')
  }
  legacyWindow.openClockOverlay()
}

export async function mountLegacyVocabSessionView(selector: string) {
  await ensureLegacyMoreTools()
  ensureLegacyMoreView()
  if (!legacyWindow.VocabSessionView || typeof legacyWindow.VocabSessionView.mount !== 'function') {
    throw new Error('VocabSessionView 未加载')
  }
  await legacyWindow.VocabSessionView.mount(selector)
}

export async function showLegacyAchievements() {
  await ensureLegacyMoreTools()
  if (typeof legacyWindow.showAchievements !== 'function') {
    throw new Error('AchievementManager 未加载')
  }
  await legacyWindow.showAchievements()
}

export function hideLegacyAchievements() {
  if (typeof legacyWindow.hideAchievements !== 'function') {
    return false
  }
  legacyWindow.hideAchievements()
  return true
}

export function switchLegacyBackgroundTheme(
  themeName: string,
  options: { skipIfMatches?: Function } = {}
) {
  if (typeof legacyWindow.switchBgTheme !== 'function') {
    return false
  }
  if (options.skipIfMatches && legacyWindow.switchBgTheme === options.skipIfMatches) {
    return false
  }
  legacyWindow.switchBgTheme(themeName)
  return true
}

export function installLegacyBackgroundThemeSwitcher(handler: Function) {
  if (typeof legacyWindow.switchBgTheme !== 'function') {
    legacyWindow.switchBgTheme = handler
  }
}

export function removeLegacyBackgroundThemeSwitcher(handler: Function) {
  if (legacyWindow.switchBgTheme === handler) {
    delete legacyWindow.switchBgTheme
  }
}

export function ensureLegacyShuiBackgroundScripts() {
  if (!legacyShuiBackgroundPromise) {
    legacyShuiBackgroundPromise = Promise.resolve()
      .then(() => (legacyWindow.THREE ? undefined : loadLegacyScript(THREE_VENDOR_SCRIPT, SHUI_LOADER_OPTIONS)))
      .then(() => loadLegacyScript(THREE_BACKGROUND_SCRIPT, SHUI_LOADER_OPTIONS))
      .catch((error) => {
        legacyShuiBackgroundPromise = null
        throw error
      })
  }
  return legacyShuiBackgroundPromise
}

export function destroyLegacyShuiBackground() {
  if (legacyWindow.SHUIThreeBackground && typeof legacyWindow.SHUIThreeBackground.destroy === 'function') {
    legacyWindow.SHUIThreeBackground.destroy()
  }
  legacyWindow.SHUIThreeBackground = null
}
