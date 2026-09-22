import React, { useState } from 'react';
import {
  History,
  X,
  MessageSquare,
  Plus,
  Trash2,
  Calendar,
  FolderGit2,
  Search,
  Zap,
} from 'lucide-react';
import { SessionItem, ProjectItem } from '../types.js';
import { formatTokenCount, calculateSessionTokens } from '../utils/tokenUtils.js';

interface HistorySidebarProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: SessionItem[];
  activeSessionId: string | null;
  onSelectSession: (session: SessionItem) => void;
  onNewSession: (projectId?: string | null) => void;
  onDeleteSession: (id: string) => void;
  projects: ProjectItem[];
}

export const HistorySidebar: React.FC<HistorySidebarProps> = ({
  onClose,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  projects,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const nonArchivedSessions = sessions.filter(
    (s) =>
      s.isArchived !== true &&
      (!searchTerm.trim() ||
        (s.title || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.messages?.some((m) => m.content.toLowerCase().includes(searchTerm.toLowerCase())))
  );

  const freeSessions = nonArchivedSessions.filter(
    (s) => !s.projectId || !projects.some((p) => p.id === s.projectId)
  );

  return (
    <div className="h-full w-full flex flex-col bg-[#0c0c0e]/98 text-zinc-100 select-text overflow-hidden">
      {/* Header */}
      <div className="h-10 px-2.5 border-b border-blue-500/20 flex items-center justify-between shrink-0 bg-zinc-950/90 gap-1.5 overflow-hidden">
        <div className="flex items-center gap-1.5 min-w-0">
          <History className="w-4 h-4 text-blue-400 shrink-0" />
          <span className="text-[11px] font-mono font-bold uppercase tracking-tight text-blue-400 truncate">
            HISTÓRICO DE CONVERSAS
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => onNewSession(null)}
            title="Novo Chat Livre"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-semibold transition cursor-pointer shrink-0"
          >
            <Plus className="w-3 h-3" />
            <span className="hidden sm:inline">Novo</span>
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition cursor-pointer shrink-0"
            title="Fechar Painel"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Search Input */}
      <div className="p-2 border-b border-zinc-800/80 bg-zinc-950/60 shrink-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar no histórico..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-8 pr-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-blue-500/50 transition"
          />
        </div>
      </div>

      {/* List Content */}
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {/* Projects Section */}
        {projects.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[9.5px] uppercase font-mono font-bold text-blue-400/80 tracking-wider px-1 flex items-center gap-1">
              <FolderGit2 className="w-3 h-3" />
              <span>Projetos</span>
            </div>

            {projects.map((proj) => {
              const projSessions = nonArchivedSessions.filter((s) => s.projectId === proj.id);
              if (projSessions.length === 0) return null;

              return (
                <div
                  key={proj.id}
                  className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 overflow-hidden"
                >
                  <div className="px-2 py-1 bg-zinc-900/80 border-b border-zinc-800/60 flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-200 truncate">{proj.name}</span>
                    <span className="text-[9px] font-mono px-1 rounded bg-zinc-800 text-zinc-400">
                      {projSessions.length}
                    </span>
                  </div>

                  <div className="p-1 space-y-1">
                    {projSessions.map((sess) => {
                      const isActive = sess.id === activeSessionId;
                      const tokenStats = calculateSessionTokens(sess.messages || []);

                      return (
                        <div
                          key={sess.id}
                          onClick={() => onSelectSession(sess)}
                          className={`group p-1.5 rounded-md border transition cursor-pointer flex items-center justify-between gap-1.5 ${
                            isActive
                              ? 'bg-blue-950/40 border-blue-500/40 text-white'
                              : 'bg-zinc-900/40 border-transparent hover:bg-zinc-800/60 text-zinc-300'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium truncate leading-tight">
                              {sess.title || 'Conversa'}
                            </div>
                            <div className="flex items-center gap-2 text-[9.5px] text-zinc-500 font-mono mt-0.5">
                              <span>{sess.messages?.length || 0} msgs</span>
                              <span>•</span>
                              <span className="text-amber-400 font-semibold flex items-center gap-0.5">
                                <Zap className="w-2 h-2" />
                                {formatTokenCount(tokenStats.totalTokens)}
                              </span>
                            </div>
                          </div>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`Excluir o chat "${sess.title}"?`)) {
                                onDeleteSession(sess.id);
                              }
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-rose-400 rounded transition cursor-pointer"
                            title="Excluir conversa"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Free Chats Section */}
        <div className="space-y-1.5">
          <div className="text-[9.5px] uppercase font-mono font-bold text-emerald-400/80 tracking-wider px-1 flex items-center gap-1">
            <MessageSquare className="w-3 h-3" />
            <span>Conversas Livres ({freeSessions.length})</span>
          </div>

          {freeSessions.length === 0 ? (
            <div className="py-6 text-center text-zinc-500 text-xs">
              Nenhuma conversa livre ativa.
            </div>
          ) : (
            freeSessions.map((sess) => {
              const isActive = sess.id === activeSessionId;
              const tokenStats = calculateSessionTokens(sess.messages || []);

              return (
                <div
                  key={sess.id}
                  onClick={() => onSelectSession(sess)}
                  className={`group p-2 rounded-lg border transition cursor-pointer flex items-center justify-between gap-1.5 ${
                    isActive
                      ? 'bg-blue-950/40 border-blue-500/40 text-white'
                      : 'bg-zinc-900/60 border-zinc-800/80 hover:bg-zinc-800/60 text-zinc-300'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold truncate leading-tight">
                      {sess.title || 'Nova Conversa'}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono mt-0.5">
                      <span className="flex items-center gap-1">
                        <MessageSquare className="w-2.5 h-2.5" />
                        {sess.messages?.length || 0} msgs
                      </span>
                      <span>•</span>
                      <span className="text-amber-400 font-semibold flex items-center gap-0.5">
                        <Zap className="w-2.5 h-2.5" />
                        {formatTokenCount(tokenStats.totalTokens)}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Excluir o chat "${sess.title}"?`)) {
                        onDeleteSession(sess.id);
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-rose-400 rounded transition cursor-pointer"
                    title="Excluir conversa"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
