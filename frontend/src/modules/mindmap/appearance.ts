import type MindElixir from 'mind-elixir'
import type { NodeObj, Topic } from 'mind-elixir'
import { nodeColors, type LineStyle, type MapDocument, type MapNode, type MapPosition, type NodeColor } from './types'

interface NodeAppearance { color?: NodeColor; position?: MapPosition; lineStyle?: LineStyle }
interface NodeRect { x: number; y: number; width: number; height: number }
interface NodePlacement { topic: Topic; rect: NodeRect; left: number; top: number; positioned: boolean; branchColor?: NodeColor }
interface PositionPreview { id: string; position: MapPosition }
type ConnectionSide = 'left' | 'right' | 'up' | 'down';
const svgNamespace = 'http://www.w3.org/2000/svg'
const branchPalette: readonly NodeColor[] = ['blue', 'green', 'orange', 'purple', 'red', 'gray'];

export function appearance(node: NodeObj): NodeAppearance {
    return (node.metadata as NodeAppearance | undefined) ?? {};
}

export function toMindNode(node: MapNode, lineStyle?: LineStyle): NodeObj {
    const { color, position, children, ...core } = node;
    return { ...core, children: children.map(child => toMindNode(child)), metadata: { color, position, lineStyle } };
}

export function fromMindDocument(tree: NodeObj, direction: MapDocument['direction']): MapDocument {
    function fromNode(node: NodeObj): MapNode {
        const { color, position } = appearance(node);
        return { id: node.id, topic: node.topic, children: (node.children ?? []).map(fromNode),
            expanded: node.expanded, direction: node.direction, color, position };
    }
    return { format: 'workbench-mindmap', schemaVersion: 1, direction, nodeData: fromNode(tree), lineStyle: appearance(tree).lineStyle };
}

function visibleTopics(mind: MindElixir) {
    return mind.nodes.querySelectorAll<Topic>('me-tpc[data-nodeid]');
}

function branchColors(root: NodeObj) {
    const colors = new Map<string, NodeColor>();
    function inherit(node: NodeObj, color: NodeColor) {
        colors.set(node.id, color);
        node.children?.forEach(child => inherit(child, color));
    }
    root.children?.forEach((branch, index) => inherit(branch, branchPalette[index % branchPalette.length]!));
    return colors;
}

function autoCenter(topic: Topic, scale: number) {
    const box = topic.getBoundingClientRect(), mover = topic.parentElement;
    return { x: box.left + box.width / 2 - (parseFloat(mover.style.left) || 0) * scale,
        y: box.top + box.height / 2 - (parseFloat(mover.style.top) || 0) * scale };
}

export function canvasPosition(mind: MindElixir, topic: Topic): MapPosition {
    const origin = autoCenter(mind.findEle(mind.nodeData.id), mind.scaleVal);
    const rect = topic.getBoundingClientRect();
    return { x: (rect.left + rect.width / 2 - origin.x) / mind.scaleVal,
        y: (rect.top + rect.height / 2 - origin.y) / mind.scaleVal };
}

function layoutSide(topic: Topic): ConnectionSide {
    const branch = topic.closest('me-main');
    if (branch?.classList.contains('down')) return 'down';
    return branch?.classList.contains('lhs') ? 'left' : 'right';
}

function linePath(parent: NodeRect, child: NodeRect, style: LineStyle, layout?: ConnectionSide) {
    const from = { x: parent.x + parent.width / 2, y: parent.y + parent.height / 2 };
    const to = { x: child.x + child.width / 2, y: child.y + child.height / 2 };
    const dx = to.x - from.x, dy = to.y - from.y;
    // Automatic branches use their layout axis; a wide or tall subtree can make the center-to-center angle misleading.
    const gapX = Math.abs(dx) - (parent.width + child.width) / 2;
    const gapY = Math.abs(dy) - (parent.height + child.height) / 2;
    const side = layout ?? (gapY > gapX ? (dy < 0 ? 'up' : 'down') : (dx < 0 ? 'left' : 'right'));
    const vertical = side === 'up' || side === 'down';
    if (vertical) {
        const sign = side === 'up' ? -1 : 1;
        from.y += sign * parent.height / 2;
        to.y -= sign * child.height / 2;
    } else {
        const sign = side === 'left' ? -1 : 1;
        from.x += sign * parent.width / 2;
        to.x -= sign * child.width / 2;
    }
    const start = `M ${from.x} ${from.y}`;
    if (style === 'straight') return `${start} L ${to.x} ${to.y}`;
    const middleX = (from.x + to.x) / 2, middleY = (from.y + to.y) / 2;
    if (style === 'elbow') return vertical ? `${start} V ${middleY} H ${to.x} V ${to.y}` : `${start} H ${middleX} V ${to.y} H ${to.x}`;
    return vertical ? `${start} C ${from.x} ${middleY} ${to.x} ${middleY} ${to.x} ${to.y}`
        : `${start} C ${middleX} ${from.y} ${middleX} ${to.y} ${to.x} ${to.y}`;
}

/** Saved coordinates use the original root center as a stable origin across camera and layout changes. */
export function renderMapAppearance(mind: MindElixir, preview?: PositionPreview) {
    const scale = mind.scaleVal, root = mind.findEle(mind.nodeData.id), origin = autoCenter(root, scale);
    const nodes = mind.nodes.getBoundingClientRect();
    const style = appearance(mind.nodeData).lineStyle ?? 'curve';
    const colors = branchColors(mind.nodeData);
    const placements = new Map<string, NodePlacement>();
    let positioned = false;
    for (const topic of visibleTopics(mind)) {
        const id = topic.nodeObj.id;
        const position = preview?.id === id ? preview.position : appearance(topic.nodeObj).position;
        const center = autoCenter(topic, scale);
        const box = topic.getBoundingClientRect();
        const left = position ? (origin.x - center.x) / scale + position.x : 0;
        const top = position ? (origin.y - center.y) / scale + position.y : 0;
        positioned ||= !!position;
        placements.set(id, { topic, left, top, positioned: !!position, branchColor: colors.get(id), rect: { x: (center.x - nodes.left - box.width / 2) / scale + left,
            y: (center.y - nodes.top - box.height / 2) / scale + top, width: box.width / scale, height: box.height / scale } });
    }
    for (const { topic, left, top, branchColor } of placements.values()) {
        topic.parentElement.style.left = left ? `${left}px` : '';
        topic.parentElement.style.top = top ? `${top}px` : '';
        const manual = appearance(topic.nodeObj).color, color = manual ?? branchColor;
        const palette = color && nodeColors[color];
        const main = topic.nodeObj.parent && !topic.nodeObj.parent.parent;
        topic.style.backgroundColor = palette ? (main && !manual ? palette.main : palette.background) : '';
        topic.style.color = palette ? palette.text : '';
        topic.style.borderColor = palette ? palette.accent : '';
    }
    mind.nodes.classList.toggle('workbench-map-positioned', positioned);
    const paths = document.createDocumentFragment();
    for (const { topic, rect, branchColor, positioned } of placements.values()) {
        const parent = topic.nodeObj.parent;
        const start = parent && placements.get(parent.id);
        if (!start || !branchColor) continue;
        const path = document.createElementNS(svgNamespace, 'path');
        const side = start.positioned || positioned ? undefined : layoutSide(topic);
        path.setAttribute('d', linePath(start.rect, rect, style, side));
        path.setAttribute('stroke', nodeColors[branchColor].accent);
        path.setAttribute('stroke-width', parent.parent ? '1.6' : '2.5');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('fill', 'none');
        paths.append(path);
    }
    mind.lines.replaceChildren(paths);
}

function visibleBounds(mind: MindElixir) {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const topic of visibleTopics(mind)) {
        const rect = topic.getBoundingClientRect();
        left = Math.min(left, rect.left); top = Math.min(top, rect.top);
        right = Math.max(right, rect.right); bottom = Math.max(bottom, rect.bottom);
    }
    return { left, top, right, bottom };
}

function panBy(mind: MindElixir, dx: number, dy: number) {
    if (Math.abs(dx) < .01 && Math.abs(dy) < .01) return false;
    const { m41, m42 } = new DOMMatrixReadOnly(getComputedStyle(mind.map).transform);
    mind.map.style.transform = `translate3d(${m41 + dx}px, ${m42 + dy}px, 0) scale(${mind.scaleVal})`;
    mind.bus.fire('move', { dx, dy });
    return true;
}

function centerBounds(mind: MindElixir, bounds: ReturnType<typeof visibleBounds>) {
    const viewport = mind.container.getBoundingClientRect();
    panBy(mind, (viewport.left + viewport.right - bounds.left - bounds.right) / 2,
        (viewport.top + viewport.bottom - bounds.top - bounds.bottom) / 2);
}

export function fitMap(mind: MindElixir) {
    if (!mind.nodes.classList.contains('workbench-map-positioned')) { mind.scaleFit(); return; }
    const bounds = visibleBounds(mind), viewport = mind.container.getBoundingClientRect();
    const fit = Math.min(1, (viewport.width - 32) * mind.scaleVal / Math.max(1, bounds.right - bounds.left),
        (viewport.height - 32) * mind.scaleVal / Math.max(1, bounds.bottom - bounds.top));
    mind.scale(Math.max(mind.scaleMin, fit));
    centerBounds(mind, visibleBounds(mind));
}

export function centerMap(mind: MindElixir) {
    if (!mind.nodes.classList.contains('workbench-map-positioned')) { mind.toCenter(); return; }
    centerBounds(mind, mind.findEle(mind.nodeData.id).getBoundingClientRect());
}

export function allowPositionedPanning(mind: MindElixir) {
    const move = mind.move;
    mind.move = (dx, dy, animate) => {
        if (!mind.nodes.classList.contains('workbench-map-positioned')) return move.call(mind, dx, dy, animate);
        const bounds = visibleBounds(mind), viewport = mind.container.getBoundingClientRect();
        const centerX = (viewport.left + viewport.right) / 2, centerY = (viewport.top + viewport.bottom) / 2;
        const limit = (delta: number, before: number, after: number) => delta > 0
            ? Math.min(delta, Math.max(0, before)) : Math.max(delta, Math.min(0, after));
        return panBy(mind, limit(dx, centerX - bounds.left, centerX - bounds.right),
            limit(dy, centerY - bounds.top, centerY - bounds.bottom));
    };
}
