export interface MapNode {
    id: string;
    topic: string;
    children: MapNode[];
    expanded?: boolean;
    direction?: 0 | 1;
}
export interface MapDocument {
    format: 'workbench-mindmap';
    schemaVersion: 1;
    direction: 0 | 1 | 2 | 3;
    nodeData: MapNode;
}
export interface Mindmap {
    id: string;
    title: string;
    version: string;
    document: MapDocument | null;
    deleted: boolean;
    updatedAt: string;
}
export interface MindmapPage {
    items: Mindmap[];
    total: number;
    page: number;
}
export interface MapWrite {
    baseVersion: string;
    title: string;
    document: MapDocument;
}
export interface MapSave {
    id: string;
    version: string;
    deleted: boolean;
    updatedAt: string;
}
export interface MapPending {
    id: string;
    operation: string;
    body: MapWrite;
}

export type MapAction = 'child' | 'sibling' | 'before' | 'parent' | 'edit' | 'delete' | 'fold' | 'expand-all' | 'collapse-all' | 'root-child' | 'fit' | 'center' | 'reset';
export interface MapMenuItem {
    key: MapAction;
    label: string;
    shortcut?: string;
    disabled?: boolean;
    danger?: boolean;
}
export function mapId() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = ((bytes[6] ?? 0) & 15) | 64;
    bytes[8] = ((bytes[8] ?? 0) & 63) | 128;
    const value = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('导图 JSON 结构无效。'); return value as Record<string, unknown>; }
function keys(value: Record<string, unknown>, allowed: string[]) { if (Object.keys(value).some(key => !allowed.includes(key)))
    throw new Error('导图包含首版不支持的字段，只接受纯文本节点。'); }
export function parseMap(value: unknown): MapDocument {
    const root = object(value);
    keys(root, ['format', 'schemaVersion', 'direction', 'nodeData']);
    if (root.format !== 'workbench-mindmap' || root.schemaVersion !== 1 || (root.direction !== 0 && root.direction !== 1 && root.direction !== 2 && root.direction !== 3))
        throw new Error('请选择 Workbench 导出的导图 JSON。');
    if (new TextEncoder().encode(JSON.stringify(value)).length > 1024 * 1024)
        throw new Error('导图 JSON 最多 1 MiB。');
    const ids = new Set<string>();
    const node = (input: unknown, depth: number): MapNode => {
        const item = object(input);
        keys(item, ['id', 'topic', 'children', 'expanded', 'direction']);
        if (depth > 40 || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(item.id) || ids.has(item.id) || typeof item.topic !== 'string' || !item.topic.trim() || item.topic.length > 1000 || !Array.isArray(item.children))
            throw new Error('节点无效：ID 须唯一、文本 1–1000 字，最多 1000 个节点/40 层。');
        ids.add(item.id);
        if (ids.size > 1000)
            throw new Error('导图最多 1000 个节点。');
        if (item.expanded !== undefined && typeof item.expanded !== 'boolean')
            throw new Error('节点折叠状态无效。');
        if (item.direction !== undefined && item.direction !== 0 && item.direction !== 1)
            throw new Error('节点方向无效。');
        return { id: item.id, topic: item.topic, children: item.children.map(child => node(child, depth + 1)), ...(typeof item.expanded === 'boolean' ? { expanded: item.expanded } : {}), ...(item.direction === 0 || item.direction === 1 ? { direction: item.direction } : {}) };
    };
    return { format: 'workbench-mindmap', schemaVersion: 1, direction: root.direction, nodeData: node(root.nodeData, 1) };
}
export function blankMap(title: string): MapDocument { return { format: 'workbench-mindmap', schemaVersion: 1, direction: 2, nodeData: { id: mapId(), topic: title, children: [] } }; }
