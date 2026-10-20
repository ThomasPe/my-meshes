import { describe, expect, it } from 'vitest';
import { buildIssueUrl, environmentBlock, redactPaths } from '@/features/feedback/feedback';
import type { AppInfo } from '@/lib/types';

const info: AppInfo = { version: '0.1.0-dev.31', dataDir: 'x', testMode: false, e2eBuild: false, updater: true, store: false, channel: 'dev', os: 'windows', arch: 'x86_64', webview: '142.0.0', osVersion: 'Windows 11 (26100)' };

describe('feedback', () => {
  it('prefills the bug form by field id', () => {
    const url = new URL(buildIssueUrl({ kind: 'bug', title: 'Viewer stuck', details: 'stays on "reading"', environment: environmentBlock(info, { projects: 72, locale: 'de' }), logHint: true }));
    expect(url.origin + url.pathname).toBe('https://github.com/ThomasPe/my-meshes/issues/new');
    expect(url.searchParams.get('template')).toBe('bug_report.yml');
    expect(url.searchParams.get('title')).toBe('[Bug] Viewer stuck');
    expect(url.searchParams.get('labels')).toBe('bug,from-app');
    expect(url.searchParams.get('description')).toBe('stays on "reading"');
    expect(url.searchParams.get('environment')).toBe('Meshkeep 0.1.0-dev.31 (dev channel)\nWindows 11 (26100) x86_64\nWebView 142.0.0\nLanguage de\nLibrary: 72 projects');
    expect(url.searchParams.get('log')).toContain('clipboard');
  });
  it('ideas use the feature form, other feedback a plain body', () => {
    const idea = new URL(buildIssueUrl({ kind: 'idea', title: 'Tabs', details: 'd', environment: '' }));
    expect(idea.searchParams.get('template')).toBe('feature_request.yml');
    expect(idea.searchParams.get('title')).toBe('[Idea] Tabs');
    expect(idea.searchParams.has('environment')).toBe(false);
    const other = new URL(buildIssueUrl({ kind: 'other', title: 'Thanks', details: 'nice app', environment: 'Meshkeep 1' }));
    expect(other.searchParams.has('template')).toBe(false);
    expect(other.searchParams.get('body')).toBe('nice app\n\n---\n```\nMeshkeep 1\n```');
  });
  it('keeps the link short enough for a browser', () => {
    const url = buildIssueUrl({ kind: 'bug', title: 't', details: 'x'.repeat(20000), environment: '' });
    expect(url.length).toBeLessThan(4000);
    expect(decodeURIComponent(url)).toContain('…');
  });
  it('shortens user folders in log excerpts', () => {
    expect(redactPaths('C:\\Users\\thomas\\3D\\a.stl and /home/thomas/x and C:/Users/x')).toBe('~\\3D\\a.stl and ~/x and ~');
    expect(redactPaths('\\\\nas\\models\\a.stl')).toBe('\\\\nas\\models\\a.stl');
  });
});
