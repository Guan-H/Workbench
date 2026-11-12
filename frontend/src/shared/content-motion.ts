import type { ObjectDirective } from 'vue';
const running = new WeakMap<HTMLElement, Animation>();
function enter(element: HTMLElement) {
    running.get(element)?.cancel();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !element.getClientRects().length)
        return;
    const animation = element.animate([
        { opacity: 0.65, transform: 'translateY(4px)' },
        { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 160, easing: 'ease-out' });
    running.set(element, animation);
}
/** Animate the existing content node, preserving editor state and focus. */
export const vContentMotion: ObjectDirective<HTMLElement, unknown> = {
    mounted: enter,
    updated(element, binding) { if (binding.value !== binding.oldValue)
        enter(element); },
    beforeUnmount(element) { running.get(element)?.cancel(); running.delete(element); },
};
