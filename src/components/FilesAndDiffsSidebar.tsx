import React from 'react';
import { Files, X } from 'lucide-react';
import { FilesAndDiffsView } from './FilesAndDiffsView.js';
import { ProjectItem, AuthorizedDir } from '../types.js';

interface FilesAndDiffsSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  currentDir: string;
  projects?: ProjectItem[];
  activeProject?: ProjectItem | null;
  authorizedDirs?: AuthorizedDir[];
  onDirectoryChange?: (newDir: string) => void;
}

export const FilesAndDiffsSidebar: React.FC<FilesAndDiffsSidebarProps> = ({
  onClose,
  currentDir,
  projects,
  activeProject,
  authorizedDirs,
  onDirectoryChange,
}) => {
  return (
    <div className="h-full w-full flex flex-col bg-[#0c0c0e]/98 text-zinc-100 select-text overflow-hidden">
      {/* Header */}
      <div className="h-10 px-2.5 border-b border-amber-500/20 flex items-center justify-between shrink-0 bg-zinc-950/90 gap-1.5 overflow-hidden">
        <div className="flex items-center gap-1.5 min-w-0">
          <Files className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-[11px] font-mono font-bold uppercase tracking-tight text-amber-400 truncate">
            ARQUIVOS & DIFFS
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition cursor-pointer shrink-0"
            title="Fechar Painel"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Embedded Files & Diffs View */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <FilesAndDiffsView
          currentDir={currentDir}
          projects={projects}
          activeProject={activeProject}
          authorizedDirs={authorizedDirs}
          onDirectoryChange={onDirectoryChange}
        />
      </div>
    </div>
  );
};
