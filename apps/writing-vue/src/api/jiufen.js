import { invoke } from '@tauri-apps/api/core'

export const isJiufenAsset = id => String(id || '').startsWith('jiufen-native-')

export const jiufen = {
  connected: () => invoke('jiufen_is_connected'),
  restore: () => invoke('jiufen_restore'),
  send: email => invoke('jiufen_send_code', { email }),
  login: (email, code) => invoke('jiufen_login', { email, code }),
  logout: () => invoke('jiufen_disconnect'),
  library: refresh => invoke('jiufen_library', { refresh }),
  payload: assetId => invoke('jiufen_asset_payload', { assetId }),
  openUnit: (unitId, channel) => invoke('jiufen_open_unit', { unitId, channel }),
  listeningAudio: assetId => invoke('jiufen_listening_audio', { assetId }),
  submit: (channel, {assetId,attemptId,answers,markedQuestions,durationMs,questionTimeline}) =>
    invoke('jiufen_submit', {cmd: {channel,assetId,attemptId,answers:answers || {},markedQuestions:markedQuestions || [],questionTimeline:questionTimeline || [],durationMs}}),
  review: (assetId, attemptId) => invoke('jiufen_review', {assetId, attemptId}),
  studyMaterial: (assetId, channel, attemptId = null) => invoke('jiufen_study_material', {assetId, channel, attemptId}),
}
