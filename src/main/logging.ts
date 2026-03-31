import log from 'electron-log/main';
import { appPaths } from './app-paths';

export const setupLogging = (): void => {
  log.initialize();
  log.transports.file.resolvePathFn = () => appPaths.logs + '/main.log';
  log.transports.file.level = 'info';
  log.transports.console.level = false;
};

export const logger = log.scope('main');