import { defineComponent, h, inject, nextTick, onBeforeUnmount, onMounted, ref, watch, type InjectionKey, type Ref } from 'vue'

export const previewImagesEnabled: InjectionKey<Readonly<Ref<boolean>>> = Symbol('previewImagesEnabled')

/** Native lazy images need explicit cancellation: detaching a node can leave its download alive. */
export default defineComponent({
  name: 'PreviewImage',
  props: { src: { type: String, required: true }, alt: { type: String, default: '' } },
  setup(props) {
    const enabled = inject(previewImagesEnabled, ref(true))
    const image = ref<HTMLImageElement>()
    const failed = ref(false)
    const loaded = ref(false)
    let visible = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let observer: IntersectionObserver | undefined
    function cancel() {
      clearTimeout(timer)
      timer = undefined
      if (!loaded.value) image.value?.removeAttribute('src')
    }
    function startTimeout() {
      if (timer !== undefined) return
      if (!enabled.value || !visible || failed.value || image.value?.complete) return
      timer = setTimeout(() => { failed.value = true; cancel() }, 20_000)
    }
    function retry(event: MouseEvent) {
      event.preventDefault()
      event.stopPropagation()
      failed.value = false
      void nextTick(startTimeout)
    }
    watch(enabled, active => {
      if (!active) cancel()
      else if (!failed.value) void nextTick(startTimeout)
    }, { flush: 'sync' })
    onMounted(() => {
      observer = new IntersectionObserver(entries => {
        visible = entries.some(entry => entry.isIntersecting)
        // Once visible, keep the deadline even if the user scrolls away.
        if (visible) startTimeout()
      }, { rootMargin: '300px' })
      if (image.value) observer.observe(image.value)
    })
    onBeforeUnmount(() => { observer?.disconnect(); cancel() })
    return () => h('span', { class: 'preview-image' }, [
      h('img', {
        ref: image, src: (enabled.value || loaded.value) && !failed.value ? props.src : undefined, alt: props.alt,
        loading: 'lazy', decoding: 'async', fetchpriority: 'low', hidden: failed.value,
        onLoad: () => { loaded.value = true; clearTimeout(timer); timer = undefined },
        onError: () => { if (enabled.value) { failed.value = true; cancel() } },
      }),
      failed.value ? h('span', { class: 'preview-image-error', role: 'status' }, [
        `图片加载失败或超时${props.alt ? '：' + props.alt : ''}。`,
        h('button', { type: 'button', onClick: retry }, '重新加载'),
      ]) : null,
    ])
  },
})
