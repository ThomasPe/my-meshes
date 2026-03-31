import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from '@/renderer/app/App';
import { AppProviders } from '@/renderer/app/providers';
import '@/renderer/lib/i18n';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Unable to find the renderer root element.');
}

createRoot(rootElement).render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>,
);