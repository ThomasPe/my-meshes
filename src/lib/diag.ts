/**
 * Frontend diagnostics that end up in the app log file (tauri-plugin-log: `<local app
 * data>/de.devsym.meshkeep/logs/meshkeep.log` on Windows) next to the engine's entries, so a
 * tester can send one file. In the browser they only reach the console.
 */
import { isTauri } from '@/lib/backend';

type Level = 'info' | 'warn' | 'error';
let sink: Promise<{ info: (m: string) => Promise<void>; warn: (m: string) => Promise<void>; error: (m: string) => Promise<void> } | null> | null = null;

function getSink() {
  if (!sink) sink = isTauri ? import('@tauri-apps/plugin-log').then((m) => ({ info: m.info, warn: m.warn, error: m.error })).catch(() => null) : Promise.resolve(null);
  return sink;
}

export function diag(level: Level, scope: string, message: string) {
  const line = `[${scope}] ${message}`;
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.info)(line);
  getSink().then((s) => s?.[level](line)).catch(() => {});
}

/** Uncaught errors and rejected promises are the usual reason for a screen that "does nothing". */
export function installErrorReporting() {
  const onError = (e: ErrorEvent) => {
    const stack = (e.error as { stack?: string } | undefined)?.stack?.split('\n').slice(0, 8).join(' | ');
    diag('error', 'window', `${e.message} @ ${e.filename}:${e.lineno}:${e.colno}${stack ? ` :: ${stack}` : ''}`);
  };
  const onReject = (e: PromiseRejectionEvent) => { const r = e.reason as { message?: string; stack?: string } | undefined; diag('error', 'promise', r?.stack ?? r?.message ?? String(e.reason)); };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onReject);
  return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onReject); };
}
