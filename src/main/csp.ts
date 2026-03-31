import { session } from 'electron';

export const installContentSecurityPolicy = (isDevelopment: boolean): void => {
  const connectSources = isDevelopment
    ? "'self' ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*"
    : "'self'";
  const scriptSources = isDevelopment ? "'self' 'unsafe-inline'" : "'self'";

  const policy = [
    "default-src 'self'",
    "base-uri 'self'",
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    `connect-src ${connectSources}`,
    "object-src 'none'",
    `script-src ${scriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
  ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
};