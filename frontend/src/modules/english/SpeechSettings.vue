<script setup lang="ts">
import { Alert as AAlert, Button as AButton, Popover as APopover, Select as ASelect } from 'ant-design-vue'
import { Settings2 } from 'lucide-vue-next'
import { ref, useId } from 'vue'
import { gapChoices, repeatChoices, setSpeechPreference, speechPreferences, type SpeechPreferences } from './speech-preferences'

const opened = ref(false), storageFailed = ref(false), id = useId()
const counts = repeatChoices.map(value => ({ value, label: `${value} 遍` }))
const gaps = gapChoices.map(value => ({ value, label: `${value} 秒` }))
function update(key: keyof SpeechPreferences, value: unknown) { storageFailed.value = !setSpeechPreference(key, Number(value)) }
</script>

<template>
  <APopover v-model:open="opened" trigger="click" placement="bottomRight">
    <template #content>
      <section class="speech-settings" aria-label="朗读设置">
        <h3>重复与跟读</h3>
        <div class="speech-setting-row"><label :for="id+'-words'">单词重复次数</label><ASelect :id="id+'-words'" :value="speechPreferences.wordRepeats" :options="counts" @update:value="update('wordRepeats',$event)" /></div>
        <div class="speech-setting-row"><label :for="id+'-sentences'">单句重复次数</label><ASelect :id="id+'-sentences'" :value="speechPreferences.sentenceRepeats" :options="counts" @update:value="update('sentenceRepeats',$event)" /></div>
        <div class="speech-setting-row"><label :for="id+'-gap'">跟读间隔</label><ASelect :id="id+'-gap'" :value="speechPreferences.gapSeconds" :options="gaps" @update:value="update('gapSeconds',$event)" /></div>
        <p>设置用于下次播放，仅保存在当前浏览器。整篇文章仍朗读一次，播放次数不计为掌握。</p>
        <AAlert v-if="storageFailed" type="warning" message="当前页面已生效，但浏览器未能保存设置。刷新后可能恢复默认。" />
        <AButton class="speech-settings-close" @click="opened=false">完成</AButton>
      </section>
    </template>
    <AButton type="text" class="speech-settings-trigger" :aria-expanded="opened"><Settings2 :size="15" aria-hidden="true" />朗读设置</AButton>
  </APopover>
</template>

<style scoped>
.speech-settings{width:244px;max-width:calc(100vw - 64px)}.speech-settings h3{font-size:15px;margin:0 0 12px}.speech-setting-row{display:flex;justify-content:space-between;align-items:center;gap:16px;margin:10px 0}.speech-settings .ant-select{width:100px}.speech-settings p{font-size:12px;line-height:1.7;color:var(--color-text-muted);margin:12px 0}.speech-settings-close{width:100%;min-height:40px}.speech-settings-trigger{color:var(--color-text-muted);font-size:12px;min-height:32px}@media(max-width:600px){.speech-settings-trigger,.speech-settings-close{min-height:44px}.speech-settings :deep(.ant-select-selector){min-height:40px}}
</style>
