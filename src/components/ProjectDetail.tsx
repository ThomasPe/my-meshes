import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { File, Tag, User, Scale, FileText } from 'lucide-react';

interface ProjectDetailProps {
  project: {
    id: number;
    path: string;
    name: string;
    has_yaml: number;
  };
}

function formatSize(bytes: number | null): string {
  if (bytes === null || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export default function ProjectDetail({ project }: ProjectDetailProps): React.JSX.Element {
  const { t } = useTranslation();

  const { data: files = [] } = useQuery<
    Array<{
      id: number;
      name: string;
      extension: string;
      size_bytes: number | null;
    }>
  >({
    queryKey: ['project-files', project.id],
    queryFn: () => window.electronApi.getProjectFiles(project.id),
  });

  const { data: metadata } = useQuery({
    queryKey: ['project-metadata', project.path],
    queryFn: () => window.electronApi.getProjectMetadata(project.path),
    enabled: project.has_yaml === 1,
  });

  const totalSize = files.reduce((sum, f) => sum + (f.size_bytes ?? 0), 0);

  return (
    <div className="flex flex-col gap-3 overflow-auto p-3" data-testid="project-detail">
      <h3 className="text-lg font-semibold">{project.name}</h3>

      {metadata?.metadata && (
        <div className="space-y-2">
          {metadata.metadata.title && (
            <div className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span>{metadata.metadata.title}</span>
            </div>
          )}
          {metadata.metadata.creator && (
            <div className="flex items-center gap-2 text-sm">
              <User className="h-4 w-4 text-muted-foreground" />
              <span>{metadata.metadata.creator}</span>
            </div>
          )}
          {metadata.metadata.license && (
            <div className="flex items-center gap-2 text-sm">
              <Scale className="h-4 w-4 text-muted-foreground" />
              <span>{metadata.metadata.license}</span>
            </div>
          )}
          {metadata.metadata.tags && metadata.metadata.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <Tag className="h-4 w-4 text-muted-foreground" />
              {metadata.metadata.tags.map((tag: string) => (
                <span key={tag} className="rounded-full bg-secondary px-2 py-0.5 text-xs">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-1">
        <h4 className="text-sm font-medium">{t('detail.files')}</h4>
        <p className="text-xs text-muted-foreground">
          {files.length} {t('detail.filesCount')} · {formatSize(totalSize)}
        </p>
        <div className="space-y-0.5">
          {files.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-accent"
            >
              <File className="h-3 w-3 text-muted-foreground" />
              <span className="flex-1 truncate">{file.name}</span>
              <span className="text-muted-foreground">{formatSize(file.size_bytes)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        <p className="truncate">{project.path}</p>
      </div>
    </div>
  );
}
