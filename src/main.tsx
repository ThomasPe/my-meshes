import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/i18n';
import '@/styles/globals.css';
import { App } from '@/App';
import { applyTheme, loadTheme } from '@/lib/store';

applyTheme(loadTheme());
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (loadTheme() === 'system') applyTheme('system'); });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
