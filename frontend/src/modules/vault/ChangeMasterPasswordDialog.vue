<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Checkbox as ACheckbox, Form as AForm, FormItem as AFormItem, Input as AInput } from 'ant-design-vue'
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { X } from 'lucide-vue-next'
import AppDialog from '../../shared/AppDialog.vue'

defineProps<{ busy: boolean }>()
const emit = defineEmits<{ close: []; submit: [passwords: { currentPassword: string; newPassword: string }] }>()
const current = ref('')
const replacement = ref('')
const confirmation = ref('')
const acknowledged = ref(false)
const error = ref('')
const dialog = ref<HTMLElement>()
const previousFocus = document.activeElement as HTMLElement | null
function clear() { current.value = ''; replacement.value = ''; confirmation.value = '' }
function submit() {
  if (!current.value || [...replacement.value].length < 12 || new TextEncoder().encode(replacement.value).length > 1024
      || replacement.value !== confirmation.value || replacement.value === current.value || !acknowledged.value) {
    error.value = '请填写当前主密码；新主密码至少 12 个字符、UTF-8 不超过 1024 字节，两次输入一致且与当前主密码不同，并确认修改说明。'
    return
  }
  const passwords = { currentPassword: current.value, newPassword: replacement.value }
  clear(); error.value = ''; emit('submit', passwords)
}
onMounted(async () => { await nextTick(); dialog.value?.querySelector<HTMLInputElement>('input')?.focus() })
onBeforeUnmount(() => {
  clear()
  void nextTick(() => {
    if (previousFocus?.isConnected) previousFocus.focus()
    else document.getElementById('vault-unlock')?.focus()
  })
})
</script>

<template>
  <AppDialog label="修改保险库主密码">
    <section ref="dialog" class="modal vault-password-dialog" @keydown.stop @keydown.ctrl.s.prevent @keydown.meta.s.prevent @keydown.esc.prevent="!busy && emit('close')">
      <header><h2>修改保险库主密码</h2><AButton type="text" class="icon-button" aria-label="关闭修改主密码" title="关闭" :disabled="busy" @click="emit('close')"><X :size="18" /></AButton></header>
      <AForm :model="{ current, replacement, confirmation, acknowledged }" layout="vertical" @finish="!busy && submit()">
        <AAlert type="info" show-icon message="仅修改保险库主密码，账户登录口令保持不变。成功后需要重新解锁。" class="vault-inline-alert" />
        <AFormItem label="当前主密码" html-for="vault-current-master"><AInput id="vault-current-master" v-model:value="current" type="password" autocomplete="off" :disabled="busy" /></AFormItem>
        <AFormItem label="新主密码" html-for="vault-new-master" extra="至少 12 个字符，UTF-8 不超过 1024 字节。"><AInput id="vault-new-master" v-model:value="replacement" type="password" autocomplete="new-password" :disabled="busy" /></AFormItem>
        <AFormItem label="再次输入新主密码" html-for="vault-repeat-master"><AInput id="vault-repeat-master" v-model:value="confirmation" type="password" autocomplete="new-password" :disabled="busy" /></AFormItem>
        <p class="field-help">历史密文和此前的备份仍需妥善保管。</p>
        <ACheckbox v-model:checked="acknowledged" :disabled="busy">我已妥善保管新主密码，并确认修改。</ACheckbox>
        <p v-if="error" class="error-message" role="alert">{{ error }}</p>
        <footer><AButton :disabled="busy" @click="emit('close')">取消</AButton><AButton type="primary" html-type="submit" :loading="busy">确认修改主密码</AButton></footer>
      </AForm>
    </section>
  </AppDialog>
</template>
