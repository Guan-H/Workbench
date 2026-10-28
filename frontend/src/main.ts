import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import 'highlight.js/styles/github.css'
import './styles/theme.css'

createApp(App).use(createPinia()).mount('#app')
