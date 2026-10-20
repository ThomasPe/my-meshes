/**
 * In-app feedback (APP-12): the dialog collects a report and opens a prefilled GitHub issue
 * form in the browser. Nothing is sent by the app itself: no token to leak, the reporter sees
 * and owns the issue, and replies reach them through GitHub. Issue-form fields are prefilled
 * through query parameters named after the field ids in `.github/ISSUE_TEMPLATE/*.yml`.
 */
import { create } from 'zustand';
import type { AppInfo } from '@/lib/types';

export const REPO = 'ThomasPe/my-meshes';
export type FeedbackKind = 'bug' | 'idea' | 'other';

export interface FeedbackPreset {
  kind?: FeedbackKind;
  title?: string;
  details?: string;
}

interface FeedbackState {
  open: boolean;
  preset: FeedbackPreset;
  openFeedback: (preset?: FeedbackPreset) => void;
  close: () => void;
}

export const useFeedback = create<FeedbackState>((set) => ({
  open: false,
  preset: {},
  openFeedback: (preset = {}) => set({ open: true, preset }),
  close: () => set({ open: false }),
}));

/** Convenience for places without hooks (error toasts). */
export const openFeedback = (preset?: FeedbackPreset) => useFeedback.getState().openFeedback(preset);

/** The lines that go into the issue's "Environment" field. */
export function environmentBlock(info: AppInfo | undefined, extra: { projects?: number; lastError?: string | null; locale?: string } = {}): string {
  if (!info) return '';
  const build = [info.channel ? `${info.channel} channel` : null, info.store ? 'Store' : null, info.testMode ? 'test mode' : null].filter(Boolean).join(', ');
  const lines = [
    `Meshkeep ${info.version}${build ? ` (${build})` : ''}`,
    `${info.osVersion} ${info.arch}`,
    `WebView ${info.webview}`,
  ];
  if (extra.locale) lines.push(`Language ${extra.locale}`);
  if (extra.projects !== undefined) lines.push(`Library: ${extra.projects} projects`);
  if (extra.lastError) lines.push(`Last error: ${extra.lastError}`);
  return lines.join('\n');
}

// Browsers and GitHub accept URLs of a few thousand characters; everything longer goes to
// the clipboard (the log excerpt) instead of the address bar.
const MAX_FIELD = 3000;
const clip = (s: string) => (s.length > MAX_FIELD ? `${s.slice(0, MAX_FIELD)}\n…` : s);

/** Builds the "new issue" link; the template decides which fields exist. */
export function buildIssueUrl(input: { kind: FeedbackKind; title: string; details: string; environment: string; logHint?: boolean }): string {
  const p = new URLSearchParams();
  const title = input.title.trim().slice(0, 200);
  const details = clip(input.details.trim());
  if (input.kind === 'bug') {
    p.set('template', 'bug_report.yml');
    p.set('labels', 'bug,from-app');
    p.set('title', title ? `[Bug] ${title}` : '[Bug] ');
    if (details) p.set('description', details);
    if (input.environment) p.set('environment', input.environment);
    if (input.logHint) p.set('log', '(paste the log excerpt from your clipboard here)');
  } else if (input.kind === 'idea') {
    p.set('template', 'feature_request.yml');
    p.set('labels', 'enhancement,from-app');
    p.set('title', title ? `[Idea] ${title}` : '[Idea] ');
    if (details) p.set('description', details);
    if (input.environment) p.set('environment', input.environment);
  } else {
    p.set('labels', 'from-app');
    p.set('title', title);
    const body = [details, input.environment ? `\n---\n\`\`\`\n${input.environment}\n\`\`\`` : ''].filter(Boolean).join('\n');
    if (body) p.set('body', body);
  }
  return `https://github.com/${REPO}/issues/new?${p.toString()}`;
}

/** Shortens home directories the shell might have missed (other users' paths, UNC shares stay). */
export function redactPaths(text: string): string {
  return text.replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\n]+/g, '~').replace(/\/(?:home|Users)\/[^/\n]+/g, '~');
}
