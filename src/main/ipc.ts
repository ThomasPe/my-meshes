import { BrowserWindow, ipcMain } from 'electron';
import type { AppBootstrap, WindowAction, WindowState } from '@/shared/api';
import type { LibraryService } from './library-service';

interface RegisterIpcHandlersOptions {
  getBootstrap: () => AppBootstrap;
  libraryService: LibraryService;
}

const getWindowState = (window: BrowserWindow): WindowState => ({
  isMaximized: window.isMaximized(),
  isMinimized: window.isMinimized(),
});

const getWindowFromEvent = (event: Electron.IpcMainInvokeEvent): BrowserWindow => {
  const window = BrowserWindow.fromWebContents(event.sender);

  if (!window) {
    throw new Error('Window context is unavailable.');
  }

  return window;
};

export const registerIpcHandlers = ({
  getBootstrap,
  libraryService,
}: RegisterIpcHandlersOptions): void => {
  ipcMain.handle('app:get-bootstrap', () => getBootstrap());

  ipcMain.handle('app:get-window-state', (event) =>
    getWindowState(getWindowFromEvent(event)),
  );

  ipcMain.handle(
    'app:window-action',
    (event, action: WindowAction): WindowState => {
      const window = getWindowFromEvent(event);

      if (action === 'minimize') {
        window.minimize();
      }

      if (action === 'toggle-maximize') {
        if (window.isMaximized()) {
          window.unmaximize();
        } else {
          window.maximize();
        }
      }

      if (action === 'close') {
        window.close();
      }

      return getWindowState(window);
    },
  );

  ipcMain.handle('app:library-roots:list', () => libraryService.listLibraryRoots());
  ipcMain.handle('app:library-roots:add', (_event, rootPath: string) =>
    libraryService.addLibraryRoot(rootPath),
  );
  ipcMain.handle('app:library-roots:remove', (_event, rootId: number) =>
    libraryService.removeLibraryRoot(rootId),
  );
  ipcMain.handle('app:library-roots:rescan', (_event, rootId: number) =>
    libraryService.rescanLibraryRoot(rootId),
  );

  libraryService.subscribe((snapshot) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('app:library-roots-changed', snapshot);
      }
    }
  });
};