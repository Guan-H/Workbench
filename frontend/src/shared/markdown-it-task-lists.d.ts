declare module 'markdown-it-task-lists' {
  import type { PluginWithOptions } from 'markdown-it'
  const taskLists: PluginWithOptions<{ enabled?: boolean; label?: boolean }>
  export default taskLists
}
