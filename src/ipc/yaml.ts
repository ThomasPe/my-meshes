import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { ipcMain } from 'electron';
import log from 'electron-log/main';
import { getDatabase } from '../database';

export interface ProjectMetadata {
  metadata?: {
    title?: string;
    creator?: string;
    license?: string;
    source_url?: string;
    tags?: string[];
  };
  printing?: {
    recommended_material?: string;
    supports_required?: boolean;
  };
  files?: Array<{
    path: string;
    description?: string;
  }>;
}

export function readProjectYaml(projectPath: string): ProjectMetadata | null {
  const yamlPath = path.join(projectPath, 'project.yaml');
  if (!fs.existsSync(yamlPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(yamlPath, 'utf-8');
    return yaml.load(content) as ProjectMetadata;
  } catch (error) {
    log.warn('Failed to parse project.yaml at:', yamlPath, error);
    return null;
  }
}

export function writeProjectYaml(projectPath: string, data: ProjectMetadata): boolean {
  const yamlPath = path.join(projectPath, 'project.yaml');

  try {
    const content = yaml.dump(data, { indent: 2, lineWidth: 120, noRefs: true });
    fs.writeFileSync(yamlPath, content, 'utf-8');
    log.info('Wrote project.yaml at:', yamlPath);
    return true;
  } catch (error) {
    log.error('Failed to write project.yaml at:', yamlPath, error);
    return false;
  }
}

export function registerYamlHandlers(): void {
  ipcMain.handle('app:get-project-metadata', (_event, projectPath: string) => {
    return readProjectYaml(projectPath);
  });

  ipcMain.handle(
    'app:update-project-metadata',
    (
      _event,
      projectId: number,
      projectPath: string,
      updates: Partial<ProjectMetadata['metadata']>,
    ) => {
      const existing = readProjectYaml(projectPath) ?? {};
      const merged: ProjectMetadata = {
        ...existing,
        metadata: {
          ...existing.metadata,
          ...updates,
        },
      };

      const success = writeProjectYaml(projectPath, merged);

      if (success && updates?.tags) {
        const db = getDatabase();
        db.prepare(
          "UPDATE projects SET has_yaml = 1, updated_at = datetime('now') WHERE id = ?",
        ).run(projectId);

        const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
        const getTagId = db.prepare('SELECT id FROM tags WHERE name = ?');
        const insertProjectTag = db.prepare(
          'INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?, ?)',
        );

        db.prepare('DELETE FROM project_tags WHERE project_id = ?').run(projectId);
        for (const tag of updates.tags) {
          insertTag.run(tag);
          const tagRow = getTagId.get(tag) as { id: number };
          insertProjectTag.run(projectId, tagRow.id);
        }
      } else if (success) {
        const db = getDatabase();
        db.prepare(
          "UPDATE projects SET has_yaml = 1, updated_at = datetime('now') WHERE id = ?",
        ).run(projectId);
      }

      return success;
    },
  );
}
