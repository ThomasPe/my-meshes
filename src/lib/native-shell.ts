/**
 * Inside the Tauri window the WebView2 defaults make no sense for a desktop app: the
 * browser context menu (Back, Reload, Print...) and its shortcuts (F5, Ctrl+P, Ctrl+F...).
 * Text fields keep the native menu for cut/copy/paste. Test and dev builds keep everything
 * so DevTools stay reachable.
 */
const EDITABLE = 'input, textarea, [contenteditable=""], [contenteditable="true"]';

export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as { closest?: (sel: string) => unknown } | null;
  return typeof el?.closest === 'function' && el.closest(EDITABLE) != null;
}

export function shouldBlockContextMenu(target: EventTarget | null): boolean {
  return !isEditableTarget(target);
}

/** Browser chrome shortcuts the app does not implement itself. */
export function shouldBlockKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>, allowDevtools = false): boolean {
  const k = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (allowDevtools && (k === 'f12' || (mod && e.shiftKey && k === 'i'))) return false;
  if (k === 'f5' || k === 'f3' || k === 'f7' || k === 'f12') return true;
  if (mod && !e.altKey && ['r', 'p', 'f', 'g', 'u', 'j', 'h', 'd', 's', 'o', 'n', 't', 'w', 'l', 'e'].includes(k)) return true;
  if (mod && e.shiftKey && ['i', 'j', 'c', 'r'].includes(k)) return true;
  return false;
}

export function installNativeShellGuards(opts: { allowDevtools?: boolean } = {}): () => void {
  const onContext = (e: MouseEvent) => { if (shouldBlockContextMenu(e.target)) e.preventDefault(); };
  const onKey = (e: KeyboardEvent) => { if (shouldBlockKey(e, opts.allowDevtools)) e.preventDefault(); };
  document.addEventListener('contextmenu', onContext);
  document.addEventListener('keydown', onKey);
  return () => { document.removeEventListener('contextmenu', onContext); document.removeEventListener('keydown', onKey); };
}
