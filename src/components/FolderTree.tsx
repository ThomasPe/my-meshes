import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, ChevronDown, Folder, FolderOpen } from 'lucide-react';

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  projectCount: number;
}

interface FolderTreeProps {
  roots: Array<{ id: number; path: string; label: string | null; is_online: number }>;
  projects: Array<{ path: string; name: string }>;
  selectedPath?: string;
  onSelect: (path: string | undefined) => void;
}

function buildTree(
  rootPath: string,
  rootLabel: string,
  projects: Array<{ path: string; name: string }>,
): TreeNode {
  const root: TreeNode = {
    name: rootLabel,
    path: rootPath,
    children: [],
    projectCount: 0,
  };

  const normalizedRootPath = rootPath.replace(/\\/g, '/');
  const childMap = new Map<string, TreeNode>();

  for (const project of projects) {
    const normalizedProjectPath = project.path.replace(/\\/g, '/');
    if (!normalizedProjectPath.startsWith(normalizedRootPath)) continue;

    const relativePath = normalizedProjectPath.slice(normalizedRootPath.length + 1);
    const parts = relativePath.split('/');

    let current = root;
    let currentPath = rootPath;

    for (let i = 0; i < parts.length; i++) {
      currentPath = currentPath + '/' + parts[i];
      const isLeaf = i === parts.length - 1;

      let child = childMap.get(currentPath);
      if (!child) {
        child = {
          name: parts[i],
          path: currentPath.replace(/\//g, '\\'),
          children: [],
          projectCount: 0,
        };
        childMap.set(currentPath, child);
        current.children.push(child);
      }

      if (isLeaf) {
        child.projectCount += 1;
      }
      current = child;
    }

    root.projectCount += 1;
  }

  return root;
}

function TreeItem({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedPath?: string;
  onSelect: (path: string | undefined) => void;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedPath === node.path;

  return (
    <div>
      <button
        className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-sm hover:bg-accent ${
          isSelected ? 'bg-accent font-medium' : ''
        }`}
        style={{ paddingLeft: depth * 16 + 4 }}
        onClick={() => {
          if (hasChildren) setExpanded(!expanded);
          onSelect(isSelected ? undefined : node.path);
        }}
        data-testid={`tree-node-${node.name}`}
      >
        {hasChildren ? (
          expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {expanded && hasChildren ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{node.name}</span>
        {node.projectCount > 0 && (
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {node.projectCount}
          </span>
        )}
      </button>
      {expanded && hasChildren && (
        <div>
          {node.children
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            ))}
        </div>
      )}
    </div>
  );
}

export default function FolderTree({
  roots,
  projects,
  selectedPath,
  onSelect,
}: FolderTreeProps): React.JSX.Element {
  const { t } = useTranslation();

  const trees = useMemo(
    () =>
      roots
        .filter((r) => r.is_online)
        .map((root) => buildTree(root.path, root.label ?? root.path, projects)),
    [roots, projects],
  );

  if (trees.length === 0) {
    return (
      <div className="p-2 text-sm text-muted-foreground" data-testid="folder-tree-empty">
        {t('library.empty')}
      </div>
    );
  }

  return (
    <div className="overflow-auto p-1" data-testid="folder-tree">
      {trees.map((tree) => (
        <TreeItem
          key={tree.path}
          node={tree}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
