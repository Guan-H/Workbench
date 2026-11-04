export interface HelperStatus {
  phase: 'PAUSED' | 'READY' | 'WATCHING' | 'ATTENTION' | 'ERROR' | 'STOPPED'
  queued: number
  heldQueued: number
  conflicts: number
  issues: number
  code: string | null
}

export const helperPhases = {
  PAUSED: '已暂停', READY: '本轮检查完成，未监听', WATCHING: '监听中',
  ATTENTION: '有待处理项，已暂停', ERROR: '操作失败，已暂停', STOPPED: '助手已退出',
} satisfies Record<HelperStatus['phase'], string>
