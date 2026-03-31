import { contextBridge, ipcRenderer } from 'electron';
import type {
	AppApi,
	AppBootstrap,
	LibraryRootsSnapshot,
	WindowAction,
	WindowState,
} from '@/shared/api';

const shouldLogIpc = process.env.NODE_ENV === 'development';

const invoke = async <TResult>(
	channel: string,
	...args: unknown[]
): Promise<TResult> => {
	if (shouldLogIpc) {
		console.info(`[ipc] ${channel}`, args);
	}

	return ipcRenderer.invoke(channel, ...args) as Promise<TResult>;
};

const appApi: AppApi = {
	getBootstrap: () => invoke<AppBootstrap>('app:get-bootstrap'),
	getWindowState: () => invoke<WindowState>('app:get-window-state'),
	invokeWindowAction: (action: WindowAction) =>
		invoke<WindowState>('app:window-action', action),
	listLibraryRoots: () =>
		invoke<LibraryRootsSnapshot>('app:library-roots:list'),
	addLibraryRoot: (rootPath: string) =>
		invoke<LibraryRootsSnapshot>('app:library-roots:add', rootPath),
	removeLibraryRoot: (rootId: number) =>
		invoke<LibraryRootsSnapshot>('app:library-roots:remove', rootId),
	rescanLibraryRoot: (rootId: number) =>
		invoke<LibraryRootsSnapshot>('app:library-roots:rescan', rootId),
	onLibraryRootsChanged: (listener) => {
		const subscription = (
			_event: Electron.IpcRendererEvent,
			snapshot: LibraryRootsSnapshot,
		) => {
			listener(snapshot);
		};

		ipcRenderer.on('app:library-roots-changed', subscription);

		return () => {
			ipcRenderer.removeListener('app:library-roots-changed', subscription);
		};
	},
};

contextBridge.exposeInMainWorld('appApi', appApi);
