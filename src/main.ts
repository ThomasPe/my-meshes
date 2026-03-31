import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { appPaths, configureElectronPaths, ensureAppDirectories, environment } from './main/app-paths';
import { installContentSecurityPolicy } from './main/csp';
import { createDatabase } from './main/db';
import { registerIpcHandlers } from './main/ipc';
import { LibraryService } from './main/library-service';
import { logger, setupLogging } from './main/logging';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

configureElectronPaths();
ensureAppDirectories();
setupLogging();

const database = createDatabase(appPaths.database);
const libraryService = new LibraryService(database);

let mainWindow: BrowserWindow | null = null;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    frame: false,
    backgroundColor: '#f7efe3',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  const shouldOpenDevTools =
    Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL) &&
    !environment.isTestMode &&
    process.env.MY_MESHES_DISABLE_DEVTOOLS !== '1';

  if (shouldOpenDevTools) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
};

app.whenReady().then(async () => {
  installContentSecurityPolicy(Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL));
  await libraryService.initialize();

  registerIpcHandlers({
    getBootstrap: () => ({
      appName: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      isTestMode: environment.isTestMode,
      database: {
        isReady: true,
        path: appPaths.database,
      },
    }),
    libraryService,
  });

  createWindow();
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

app.on('will-quit', () => {
  logger.info('Application shutting down');
  database.close();
});
