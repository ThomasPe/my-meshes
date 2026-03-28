import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import log from 'electron-log/main';
import { getDatabase, closeDatabase } from './database';
import { registerLibraryHandlers } from './ipc/library';
import { registerScannerHandlers } from './ipc/scanner';
import { registerYamlHandlers } from './ipc/yaml';

log.initialize();
log.info('Application starting...');

const isTestMode = process.env.MY_MESHES_TEST_MODE === '1' || process.argv.includes('--test-mode');

if (isTestMode) {
  const testDataDir =
    process.env.MY_MESHES_TEST_DATA_DIR || path.join(app.getPath('temp'), 'my-meshes-test');
  app.setPath('userData', testDataDir);
  log.info('Test mode enabled, using data dir:', testDataDir);
}

if (started) {
  app.quit();
}

const createWindow = (): BrowserWindow => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  if (!app.isPackaged && !isTestMode) {
    mainWindow.webContents.openDevTools();
  }

  return mainWindow;
};

function setupCSP(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://localhost:*;",
        ],
      },
    });
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle('app:window-minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle('app:window-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
    }
  });

  ipcMain.handle('app:window-close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle('app:window-is-maximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });

  ipcMain.handle('app:get-app-info', () => {
    return {
      version: app.getVersion(),
      name: app.getName(),
      isTestMode,
    };
  });

  ipcMain.handle('app:db-health', () => {
    try {
      const db = getDatabase();
      const result = db.prepare('SELECT 1 as ok').get() as { ok: number };
      return { ok: result.ok === 1 };
    } catch (error) {
      log.error('Database health check failed:', error);
      return { ok: false };
    }
  });
}

app.on('ready', () => {
  setupCSP();
  registerIpcHandlers();
  registerLibraryHandlers();
  registerScannerHandlers();
  registerYamlHandlers();
  getDatabase();
  createWindow();
  log.info('Application ready');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  closeDatabase();
});
