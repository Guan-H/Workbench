export interface Sentence { text: string; translation: string }
export interface Article { title: string; text: string; translation: string | null; sentences?: Sentence[] | null }
export interface Word { word: string; phonetic: string | null; meaning: string; example: string | null }
export interface Submission { requestId: string; date: string; articles: Article[]; words: Word[] }
export interface Batch { id: string; receivedAt: string; content: Submission }
export interface History { id: string; requestId: string; date: string; receivedAt: string }
export interface Daily { date: string; latest: Batch | null; history: History[]; total: number; page: number }
export interface HookStatus { revision: string; configured: boolean; enabled: boolean }
export interface Credential { status: HookStatus; token: string | null }
export interface HookLog { id: string; requestId: string | null; status: string; code: string; receivedAt: string }
export interface Logs { items: HookLog[]; total: number; page: number }
export const example = JSON.stringify({ requestId: 'daily-english-001', articles: [{title:'A small step',text:'A small step every day can make a difference.',translation:'每天迈出一小步，也能带来改变。',sentences:[{text:'A small step every day can make a difference.',translation:'每天迈出一小步，也能带来改变。'}]}], words: [{word:'achieve',phonetic:'/əˈtʃiːv/',meaning:'实现；达到',example:'You can achieve your goal.'},{word:'resilience',phonetic:'/rɪˈzɪliəns/',meaning:'韧性；恢复力',example:'Practice builds resilience.'}] },null,2)
export function displayTime(value: string) { return new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Asia/Shanghai'}).format(new Date(value)) }
