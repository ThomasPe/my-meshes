import { createInstance } from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

const i18n = createInstance();

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en'],
    interpolation: {
      escapeValue: false,
    },
    resources: {
      en: {
        translation: {
          common: {
            ready: 'ready',
            notReady: 'not ready',
            standardMode: 'standard',
          },
          app: {
            title: 'My Meshes',
            subtitle: 'Local-first 3D model library manager',
            testMode: 'Test mode',
            rootCount_one: '{{count}} root',
            rootCount_other: '{{count}} roots',
            offlineCount_one: '{{count}} offline',
            offlineCount_other: '{{count}} offline',
            agentHarnessTitle: 'Agent verification stays inside the desktop app.',
            agentHarnessCopy:
              'Playwright launches Electron directly in deterministic test mode and validates the same IPC flows the UI uses.',
            reviewRoots: 'Review library roots',
          },
          nav: {
            dashboard: 'Dashboard',
            library: 'Library roots',
            settings: 'Settings',
          },
          window: {
            minimize: 'Minimize window',
            maximize: 'Maximize window',
            restore: 'Restore window',
            close: 'Close window',
          },
          dashboard: {
            kicker: 'MVP foundation',
            title: 'Operational baseline for the local library manager',
            summary:
              'The app shell, secure bridge, SQLite cache, deterministic test mode, and library-root scanning are live.',
            bootstrap: 'Bootstrap query',
            bootstrapReady: 'Connected to the main process bridge and cache layer.',
            libraryRoots: 'Configured roots',
            onlineRoots: 'Online roots',
            offlineRoots: 'Offline roots',
            routerDemo: 'Routing demo',
            routerDemoCopy:
              'React Router, TanStack Query, and i18next are all running in the renderer foundation.',
            databaseReady: 'SQLite cache ready',
            databasePath: 'Cache path',
            testModeEnabled: 'Deterministic test mode is enabled.',
            testModeDisabled: 'Standard user mode is active.',
            openLibrary: 'Open library roots',
          },
          library: {
            kicker: 'File management',
            title: 'Manage local library roots',
            summary:
              'Add, remove, and rescan library roots while preserving offline records in the SQLite cache.',
            inputLabel: 'Library root path',
            inputPlaceholder: 'D:/3d-library/Curated Models',
            addRoot: 'Add root',
            addRootBusy: 'Adding root...',
            invalidRoot:
              'Choose an existing folder path. Missing or malformed paths are rejected without changing the cache.',
            emptyTitle: 'No library roots configured yet.',
            emptyCopy:
              'Start with a folder that contains STL, OBJ, or 3MF files. Nested projects are preserved on disk; the cache is rebuilt from the file system.',
            itemCount_one: '{{count}} indexed file',
            itemCount_other: '{{count}} indexed files',
            lastSyncNever: 'Not synced yet',
            lastSyncPrefix: 'Last sync',
            statusOnline: 'Online',
            statusOffline: 'Offline',
            statusSyncing: 'Syncing',
            statusError: 'Attention required',
            sampleFiles: 'Indexed samples',
            rescan: 'Rescan',
            remove: 'Remove',
            offlineHint:
              'Offline roots keep their cached items so disconnected drives are not treated as deletions.',
          },
          settings: {
            kicker: 'Diagnostics',
            title: 'Verification and runtime details',
            summary:
              'This MVP foundation keeps Node access isolated in preload, logs to the app data directory, and routes all renderer requests through contextBridge IPC.',
            secureBridge: 'Secure context bridge',
            secureBridgeCopy:
              'Renderer access is limited to explicit app: IPC handlers. Node integration remains disabled.',
            databasePath: 'Database cache path',
            testMode: 'Runtime mode',
            testModeEnabled: 'MY_MESHES_TEST_MODE=1',
          },
        },
      },
    },
  });

export default i18n;