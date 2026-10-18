import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/i18n';
import '@/styles/globals.css';
import { App } from '@/App';
import { applyTheme, loadTheme } from '@/lib/store';

applyTheme(loadTheme());

// WebdriverIO's execute/mock bridge. Only e2e builds enable `withGlobalTauri` (src-tauri/tauri.e2e.conf.json),
// so this chunk never loads in release builds.
if ('__TAURI__' in window) void import('@wdio/tauri-plugin');
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (loadTheme() === 'system') applyTheme('system'); });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
