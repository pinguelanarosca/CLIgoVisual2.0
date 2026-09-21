import React from 'react';
import {
  History,
  X,
  MessageSquare,
  Plus,
  Trash2,
  Calendar,
  FolderGit2,
} from 'lucide-react';
import { SessionItem, ProjectItem } from '../types.js';

interface HistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: SessionItem[];
  activeSessionId: string | null;
  onSelectSession: (session: SessionItem) => void;
  onNewSession: (projectId?: string | null) => void;
  onDeleteSession: (id: string) => void;
  projects: ProjectItem[];
}

export const HistoryDrawer: React.FC<HistoryDrawerProps> = ({
  isOpen,
  onClose,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  projects,
}) => {
  if (!isOpen) return null;

  // Filter non-archived sessions
  const nonArchivedSessions = sessions.filter((s) => s.isArchived !== true);
  const freeSessions = nonArchivedSessions.filter(
    (s) => !s.projectId || !projects.some((p) => p.id === s.projectId)
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 h-full border-l border-zinc-200 dark:border-zinc-800 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/50">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-blue-500" />
            <div>
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm">
                Histórico de Conversas
              </h3>
              <p className="text-[11px] text-zinc-500">
                {nonArchivedSessions.length} conversas ativas no histórico
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onNewSession(null);
                onClose();
              }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Novo Chat Livre</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Sessions list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {nonArchivedSessions.length === 0 ? (
            <div className="text-center py-12 text-zinc-500 text-xs">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-40" />
              Nenhuma conversa encontrada.
            </div>
          ) : (
            <>
              {/* Projects Section */}
              {projects.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider font-mono">
                    <FolderGit2 className="w-4 h-4 text-blue-500" />
                    <span>Chats de Projetos</span>
                  </div>

                  <div className="space-y-3">
                    {projects.map((proj) => {
                      const projSessions = nonArchivedSessions.filter(
                        (s) => s.projectId === proj.id
                      );

                      return (
                        <div
                          key={proj.id}
                          className="bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 rounded-xl p-2.5 space-y-2"
                        >
                          <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-1.5 px-1">
                            <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                              📁 {proj.name}
                            </span>
                            <button
                              onClick={() => {
                                onNewSession(proj.id);
                                onClose();
                              }}
                              className="text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5 cursor-pointer"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Novo Chat</span>
                            </button>
                          </div>

                          {projSessions.length === 0 ? (
                            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 italic px-1">
                              Sem chats neste projeto.
                            </p>
                          ) : (
                            <div className="space-y-1.5">
                              {projSessions.map((sess) => {
                                const isActive = sess.id === activeSessionId;
                                return (
                                  <div
                                    key={sess.id}
                                    className={`p-2 rounded-lg border transition flex items-center justify-between gap-2 group ${
                                      isActive
                                        ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30'
                                        : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 hover:border-zinc-300 dark:hover:border-zinc-700'
                                    }`}
                                  >
                                    <button
                                      onClick={() => {
                                        onSelectSession(sess);
                                        onClose();
                                      }}
                                      className="flex-1 text-left min-w-0 cursor-pointer"
                                    >
                                      <div className="font-medium text-xs text-zinc-900 dark:text-zinc-100 truncate">
                                        {sess.title || 'Conversa sem título'}
                                      </div>
                                      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 mt-0.5 font-mono">
                                        <Calendar className="w-3 h-3" />
                                        <span>
                                          {new Date(sess.updatedAt).toLocaleDateString()}
                                        </span>
                                        <span>•</span>
                                        <span>{sess.messages?.length || 0} msgs</span>
                                      </div>
                                    </button>

                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (
                                          confirm(
                                            `Deseja excluir a conversa '${sess.title}'?`
                                          )
                                        ) {
                                          onDeleteSession(sess.id);
                                        }
                                      }}
                                      title="Excluir conversa"
                                      className="p-1 rounded text-zinc-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition cursor-pointer"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Free Chats Section */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider font-mono">
                  <MessageSquare className="w-4 h-4 text-emerald-500" />
                  <span>Conversas Livres</span>
                </div>

                {freeSessions.length === 0 ? (
                  <p className="text-xs text-zinc-500 italic p-2">
                    Nenhuma conversa livre.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {freeSessions.map((sess) => {
                      const isActive = sess.id === activeSessionId;
                      return (
                        <div
                          key={sess.id}
                          className={`p-2.5 rounded-xl border transition flex items-center justify-between gap-2 group ${
                            isActive
                              ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30'
                              : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 hover:border-zinc-300 dark:hover:border-zinc-700'
                          }`}
                        >
                          <button
                            onClick={() => {
                              onSelectSession(sess);
                              onClose();
                            }}
                            className="flex-1 text-left min-w-0 cursor-pointer"
                          >
                            <div className="font-medium text-xs text-zinc-900 dark:text-zinc-100 truncate">
                              {sess.title || 'Conversa sem título'}
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 mt-0.5 font-mono">
                              <Calendar className="w-3 h-3" />
                              <span>
                                {new Date(sess.updatedAt).toLocaleDateString()}
                              </span>
                              <span>•</span>
                              <span>{sess.messages?.length || 0} msgs</span>
                            </div>
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (
                                confirm(
                                  `Deseja excluir a conversa '${sess.title}'?`
                                )
                              ) {
                                onDeleteSession(sess.id);
                              }
                            }}
                            title="Excluir conversa"
                            className="p-1 rounded text-zinc-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
