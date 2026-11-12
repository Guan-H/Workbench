<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Input as AInput } from 'ant-design-vue';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { api, ApiError, write } from '../../shared/api/client';
import AppMessage, { type Notice } from '../../shared/AppMessage.vue';
import AppDialog from '../../shared/AppDialog.vue';
import AppPagination from '../../shared/AppPagination.vue';
import ConfirmDialog from '../../shared/ConfirmDialog.vue';
import ContentLoading from '../../shared/ContentLoading.vue';
import MindmapCanvas from './MindmapCanvas.vue';
import { blankMap, mapId, parseMap, type MapDocument, type MapPending, type MapSave, type Mindmap, type MindmapPage } from './types';
const props = defineProps<{
    username: string;
}>();
const catalog = ref<MindmapPage>(), current = ref<Mindmap>(), document = shallowRef<MapDocument>(), title = ref(''), saved = ref(''), pending = ref<MapPending>();
const page = ref(1), query = ref(''), trash = ref(false), loading = ref(false), opening = ref(false), saving = ref(false), conflict = ref(false), error = ref(''), notice = ref<Notice>(), draftError = ref('');
const input = ref<HTMLInputElement>(), create = ref<{
    title: string;
    document: MapDocument;
}>(), confirmation = ref<'server' | 'delete'>(), changing = ref(false);
const serialized = computed(() => JSON.stringify({ title: title.value.trim(), document: document.value }));
const dirty = computed(() => !!current.value && serialized.value !== saved.value);
const key = `workbench-mindmap-draft:${encodeURIComponent(props.username)}`;
const lifecycle = new AbortController();
let savePromise: Promise<boolean> | undefined, disposed = false, unreadableDraft = false, timer: ReturnType<typeof setTimeout> | undefined, noticeTimer: ReturnType<typeof setTimeout> | undefined, searchTimer: ReturnType<typeof setTimeout> | undefined, listSerial = 0;
function notify(text: string) { notice.value = { kind: 'success', text }; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => notice.value = undefined, 2000); }
function fail(cause: unknown) { error.value = cause instanceof Error ? cause.message : '操作失败，请重试。'; }
function persistDraft() {
    if (unreadableDraft)
        return false;
    try {
        if (current.value && document.value && (dirty.value || pending.value))
            localStorage.setItem(key, JSON.stringify({ id: current.value.id, version: current.value.version, title: title.value, document: document.value, saved: saved.value, pending: pending.value }));
        else
            localStorage.removeItem(key);
        draftError.value = '';
        return true;
    }
    catch {
        draftError.value = '本机草稿暂存失败，请保存服务器或导出 JSON 后再离开。';
        return false;
    }
}
async function list() {
    const serial = ++listSerial;
    loading.value = true;
    try {
        const result = await api<MindmapPage>(`/mindmaps?${new URLSearchParams({ page: String(page.value), query: query.value, deleted: String(trash.value) })}`, { signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(15000)]) });
        if (disposed || serial !== listSerial)
            return;
        catalog.value = result;
        if (page.value > 1 && !result.items.length) {
            page.value--;
            await list();
        }
    }
    catch (cause) {
        if (!disposed && serial === listSerial)
            fail(cause);
    }
    finally {
        if (!disposed && serial === listSerial)
            loading.value = false;
    }
}
function display(value: Mindmap) {
    if (!value.document)
        throw new Error('导图正文不可用。');
    const content = parseMap(value.document);
    current.value = value;
    document.value = content;
    title.value = value.title;
    saved.value = JSON.stringify({ title: value.title.trim(), document: content });
    pending.value = undefined;
    conflict.value = false;
    error.value = '';
}
async function open(id: string) {
    if (opening.value || changing.value)
        return;
    if (!await save())
        return;
    opening.value = true;
    try {
        const value = await api<Mindmap>(`/mindmaps/${id}`, { signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(15000)]) });
        if (!disposed)
            display(value);
    }
    catch (cause) {
        if (!disposed)
            fail(cause);
    }
    finally {
        if (!disposed)
            opening.value = false;
    }
}
function changed(value: MapDocument) { if (JSON.stringify(value) === JSON.stringify(document.value))
    return; document.value = value; persistDraft(); clearTimeout(timer); timer = setTimeout(() => void save(), 1000); }
watch(title, () => { if (!current.value)
    return; persistDraft(); clearTimeout(timer); timer = setTimeout(() => void save(), 1000); });
async function save(): Promise<boolean> {
    if (unreadableDraft)
        return false;
    if (savePromise)
        return savePromise;
    if (!current.value || !document.value || (!dirty.value && !pending.value))
        return true;
    if (conflict.value || disposed)
        return false;
    const task = (async () => {
        saving.value = true;
        error.value = '';
        try {
            while (!disposed && current.value && document.value && (dirty.value || pending.value)) {
                if (!title.value.trim() || title.value.trim().length > 120)
                    throw new Error('请输入 1–120 字的导图名称。');
                const attempt = pending.value ?? { id: current.value.id, operation: mapId(), body: { baseVersion: current.value.version, title: title.value.trim(), document: parseMap(document.value) } };
                pending.value = attempt;
                persistDraft();
                const result = await write<MapSave>(`/mindmaps/${attempt.id}`, 'PUT', attempt.body, attempt.operation, AbortSignal.timeout(15000));
                if (disposed)
                    return false;
                current.value = { ...current.value, version: result.version, updatedAt: result.updatedAt };
                saved.value = JSON.stringify({ title: attempt.body.title, document: attempt.body.document });
                pending.value = undefined;
                persistDraft();
            }
            void list();
            return true;
        }
        catch (cause) {
            if (!disposed) {
                if (cause instanceof ApiError && cause.status === 409)
                    conflict.value = true;
                fail(cause);
                persistDraft();
            }
            return false;
        }
        finally {
            saving.value = false;
        }
    })();
    savePromise = task;
    try {
        return await task;
    }
    finally {
        if (savePromise === task)
            savePromise = undefined;
    }
}
async function manualSave() { if (!current.value)
    return; clearTimeout(timer); if (await save())
    notify('导图已保存到服务器。'); }
async function newMap() { if (!await save())
    return; trash.value = false; page.value = 1; query.value = ''; create.value = { title: '新建导图', document: blankMap('中心主题') }; }
async function createMap() {
    const value = create.value;
    if (!value || !value.title.trim())
        return;
    trash.value = false;
    page.value = 1;
    display({ id: mapId(), title: value.title.trim(), version: '0', document: value.document, deleted: false, updatedAt: new Date().toISOString() });
    saved.value = '';
    create.value = undefined;
    persistDraft();
    await save();
}
function download() {
    if (!document.value)
        return;
    const blob = new Blob([JSON.stringify(parseMap(document.value), null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = (title.value.trim() || '导图').replace(/[\\/:*?"<>|]/g, '_') + '.mindmap.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function imported(event: Event) {
    if (!(event.target instanceof HTMLInputElement))
        return;
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file)
        return;
    try {
        if (file.size > 1024 * 1024)
            throw new Error('导图 JSON 最多 1 MiB。');
        const content = parseMap(JSON.parse(await file.text()));
        if (!await save())
            return;
        create.value = { title: file.name.replace(/(?:\.mindmap)?\.json$/i, '').slice(0, 120) || '导入导图', document: content };
    }
    catch (cause) {
        fail(cause);
    }
}
async function restore(item: Mindmap) {
    if (changing.value)
        return;
    changing.value = true;
    error.value = '';
    try {
        await write(`/mindmaps/${item.id}/restore`, 'POST', { baseVersion: item.version }, mapId());
        await list();
        notify('导图已恢复。');
    }
    catch (cause) {
        fail(cause);
        await list();
    }
    finally {
        changing.value = false;
    }
}
async function confirm(accepted: boolean) {
    const action = confirmation.value;
    confirmation.value = undefined;
    if (!accepted || !current.value)
        return;
    changing.value = true;
    error.value = '';
    try {
        if (action === 'server') {
            const server = await api<Mindmap>(`/mindmaps/${current.value.id}`);
            if (server.deleted)
                throw new Error('服务器导图已删除，请先到导图回收站恢复。');
            display(server);
            persistDraft();
            notify('已采用服务器版本。');
        }
        else if (action === 'delete') {
            if (!await save())
                return;
            await write(`/mindmaps/${current.value.id}/delete`, 'POST', { baseVersion: current.value.version }, mapId());
            current.value = undefined;
            document.value = undefined;
            pending.value = undefined;
            persistDraft();
            await list();
            notify('导图已移入回收站。');
        }
    }
    catch (cause) {
        fail(cause);
    }
    finally {
        changing.value = false;
    }
}
async function toggleTrash() { if (!await save())
    return; trash.value = !trash.value; page.value = 1; await list(); }
async function restoreDraft() {
    const stored = localStorage.getItem(key);
    if (!stored)
        return;
    const value = JSON.parse(stored);
    if (typeof value.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.id) || typeof value.version !== 'string' || !/^\d+$/.test(value.version) || typeof value.title !== 'string' || typeof value.saved !== 'string')
        throw new Error('本机导图草稿无效，请保留浏览器数据。');
    const content = parseMap(value.document);
    if (value.pending) {
        if (value.pending.id !== value.id || typeof value.pending.operation !== 'string' || typeof value.pending.body?.baseVersion !== 'string' || typeof value.pending.body.title !== 'string')
            throw new Error('本机待确认请求无效。');
        value.pending.body.document = parseMap(value.pending.body.document);
    }
    current.value = { id: value.id, title: value.title, version: value.version, document: content, deleted: false, updatedAt: '' };
    document.value = content;
    title.value = value.title;
    saved.value = value.saved;
    pending.value = value.pending;
    error.value = '已恢复本机导图草稿，正在核对保存结果。';
    await save();
}
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value || pending.value) {
    persistDraft();
    event.preventDefault();
    event.returnValue = '';
} }
onMounted(async () => { await list(); try {
    await restoreDraft();
}
catch (cause) {
    unreadableDraft = true;
    fail(cause);
} window.addEventListener('beforeunload', beforeUnload); });
onBeforeUnmount(() => { persistDraft(); disposed = true; lifecycle.abort(); clearTimeout(timer); clearTimeout(searchTimer); clearTimeout(noticeTimer); window.removeEventListener('beforeunload', beforeUnload); });
watch(query, () => { clearTimeout(searchTimer); page.value = 1; searchTimer = setTimeout(() => void list(), 250); });
defineExpose({ persistDraft, save: manualSave, prepareLeave: async () => { clearTimeout(timer); return await save() || persistDraft(); } });
</script>
<template>
  <section class="mindmap-page" aria-label="思维导图页面" @keydown.ctrl.s.prevent.stop="manualSave" @keydown.meta.s.prevent.stop="manualSave">
    <AppMessage :notice="notice" @close="notice=undefined" />
    <header class="mindmap-heading"><div><h1>思维导图</h1><p>独立纯文本导图，自动保存 · 普通内容以明文存储</p></div><div><AButton :disabled="saving||opening||changing" @click="newMap">新建导图</AButton><AButton :disabled="saving||opening||changing" @click="input?.click()">导入 JSON</AButton><AButton :loading="loading" @click="list">刷新列表</AButton><AButton :disabled="saving||changing" @click="toggleTrash">{{ trash?'返回导图':'导图回收站' }}</AButton></div></header>
    <AAlert v-if="error||draftError" type="error" show-icon :message="error||draftError" />
    <input ref="input" type="file" accept=".json,application/json" hidden @change="imported">
    <div class="mindmap-body"><aside class="mindmap-list" aria-label="导图列表"><AInput v-model:value="query" placeholder="搜索导图" aria-label="搜索导图" :maxlength="200" allow-clear /><div class="mindmap-list-scroll" aria-label="导图条目"><ContentLoading v-if="loading&&!catalog" skeleton label="正在读取导图…" /><ul><li v-for="item in catalog?.items" :key="item.id"><AButton v-if="!trash" :class="{active:current?.id===item.id}" :disabled="opening||changing" :data-map-id="item.id" @click="open(item.id)">{{ item.title }}</AButton><template v-else><span>{{ item.title }}</span><AButton size="small" :disabled="changing" @click="restore(item)">恢复</AButton></template></li></ul><p v-if="catalog&&!catalog.items.length">{{ trash?'导图回收站为空':'暂无匹配的导图' }}</p></div><footer v-if="catalog"><span>共 {{ catalog.total }} 份 · 第 {{ page }} / {{ Math.max(1,Math.ceil(catalog.total/10)) }} 页 · 10 份/页</span><AppPagination v-model:page="page" :pages="Math.max(1,Math.ceil(catalog.total/10))" :total="catalog.total" :page-size="10" :disabled="loading" @update:page="list" /></footer></aside>
      <section class="mindmap-content" :aria-busy="opening"><ContentLoading :pending="opening" label="正在打开导图…" /><template v-if="current&&document&&!trash"><div class="mindmap-title"><AInput v-model:value="title" aria-label="导图名称" :maxlength="120" :disabled="changing" /><span role="status">{{ saving?'正在保存…':conflict?'版本冲突，本机草稿保留':pending?'保存结果待确认':dirty?'本机草稿待保存':'服务器已保存' }}</span><AButton :loading="saving" :disabled="changing||conflict" @click="manualSave">保存</AButton><AButton @click="download">导出 JSON</AButton><AButton danger :disabled="saving||changing||conflict" @click="confirmation='delete'">删除导图</AButton></div><div v-if="conflict" class="mindmap-conflict"><p>服务器版本已变化，当前草稿未覆盖。可导出本机 JSON 保留副本，再选择采用服务器版本。</p><AButton :disabled="changing" @click="download">导出本机草稿</AButton><AButton :disabled="changing" @click="confirmation='server'">采用服务器版本</AButton></div><MindmapCanvas :key="current.id" :document="document" :disabled="changing||conflict" @change="changed" @error="error=$event" @save="manualSave" /></template><div v-else class="mindmap-empty"><h2>{{ trash?'导图回收站':'整理你的想法' }}</h2><p>{{ trash?'恢复后可继续编辑，原节点结构完整保留。':'新建一份导图，或从列表打开已有导图。' }}</p></div></section>
    </div>
    <AppDialog v-if="create" label="新建思维导图"><section class="modal map-create"><header><h2>{{ create.title==='新建导图'?'新建导图':'导入为新导图' }}</h2></header><label>导图名称<AInput v-model:value="create.title" aria-label="新导图名称" :maxlength="120" @press-enter="createMap" /></label><footer><AButton @click="create=undefined">取消</AButton><AButton type="primary" :disabled="!create.title.trim()" @click="createMap">创建并保存</AButton></footer></section></AppDialog>
    <ConfirmDialog v-if="confirmation" :message="confirmation==='delete'?'将导图移入回收站？节点与结构可完整恢复。':'采用服务器版本将替换当前本机草稿。若要保留，请先取消并导出本机 JSON。'" :confirm-label="confirmation==='delete'?'移入回收站':'采用服务器版本'" @answer="confirm" />
  </section>
</template>
<style scoped>
.mindmap-list{display:flex;flex-direction:column;min-height:0;overflow:hidden}.mindmap-list>.ant-input-affix-wrapper{flex-shrink:0}.mindmap-list-scroll{flex:1;min-height:0;overflow:auto;padding-top:4px}.mindmap-list footer{flex-shrink:0;margin-top:auto;padding-top:14px;border-top:1px solid var(--color-border)}.mindmap-list footer>span{line-height:1.6}.mindmap-list footer :deep(.app-pagination){display:flex;flex-wrap:wrap;gap:2px;row-gap:6px;margin:0}@media(max-width:700px){.mindmap-list{height:240px;max-height:240px}}
.mindmap-page{display:flex;flex:1;flex-direction:column;min-height:0;overflow:hidden}.mindmap-heading{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;padding:20px 24px;border-bottom:1px solid var(--color-border)}.mindmap-heading h1{font-size:24px;margin:0 0 6px}.mindmap-heading p{font-size:12px;color:var(--color-text-muted);margin:0}.mindmap-heading>div:last-child{display:flex;flex-wrap:wrap;gap:8px}.mindmap-body{flex:1;display:flex;min-height:0}.mindmap-list{width:240px;flex-shrink:0;overflow:hidden;padding:16px;border-right:1px solid var(--color-border)}.mindmap-list ul{list-style:none;margin:12px 0;padding:0}.mindmap-list li{display:flex;align-items:center;justify-content:space-between;gap:8px}.mindmap-list li>button:first-child{width:100%;text-align:left;justify-content:flex-start;height:auto;min-height:40px;white-space:normal;overflow-wrap:anywhere;margin-bottom:6px}.mindmap-list button.active{background:var(--color-selection);color:var(--color-primary)}.mindmap-list footer{display:grid;gap:10px;font-size:12px;color:var(--color-text-muted)}.mindmap-content{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}.mindmap-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--color-border)}.mindmap-title :deep(.ant-input){width:200px}.mindmap-title>span{font-size:12px;color:var(--color-text-muted);margin-right:auto}.mindmap-empty{margin:auto;padding:24px;color:var(--color-text-muted);text-align:center}.mindmap-conflict{padding:12px 16px;background:var(--color-selection)}.mindmap-conflict p{font-size:13px;line-height:1.7}.mindmap-conflict button+button{margin-left:8px}.map-create>label{display:grid;gap:8px;padding:16px 24px}.map-create>footer{margin:0;padding:16px 24px}@media(max-width:700px){.mindmap-heading{padding:16px}.mindmap-body{flex-direction:column;overflow:auto}.mindmap-list{width:auto;height:240px;max-height:240px;flex-shrink:0;border-right:0;border-bottom:1px solid var(--color-border)}.mindmap-content{min-height:620px;flex-shrink:0}.mindmap-title{padding:12px}.mindmap-title :deep(.ant-input){width:100%}.mindmap-title>span{width:100%}.mindmap-list footer :deep(.ant-pagination){flex-wrap:wrap}.mindmap-heading :deep(.ant-btn){min-height:40px}}
</style>
