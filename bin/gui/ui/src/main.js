import Vue from 'vue';
import Vuetify from 'vuetify';
import 'vuetify/dist/vuetify.min.css';
import DOMPurify from 'dompurify';
import App from './App.vue';
import { createController } from './core/controller';
import { createFormatter } from './core/logs';
import { translator, languageFromArguments, htmlLanguage } from './core/i18n';
import successSound from './assets/audio/success.mp3';
import './styles.css';

Vue.use(Vuetify);
Vue.config.productionTip = false;
const vuetify = new Vuetify({ theme: { dark: true } });
const initialLanguage = languageFromArguments(window.process && window.process.argv);
document.documentElement.lang = htmlLanguage(initialLanguage);
if (window.renderer) {
    const store = createController({
        ipc: window.renderer, reactive: Vue.observable, format: createFormatter(window, DOMPurify),
        schedule: requestAnimationFrame, cancel: cancelAnimationFrame, startupSound: new Audio(successSound)
    });
    new Vue({ vuetify, render: h => h(App, { props: { store } }) }).$mount('#app');
} else {
    const t = translator(initialLanguage, window.TeraToolboxMUI);
    new Vue({ vuetify, render: h => h('div', { class: 'bridge-missing', attrs: { dir: 'auto' } }, t('bridgeMissing')) }).$mount('#app');
}
