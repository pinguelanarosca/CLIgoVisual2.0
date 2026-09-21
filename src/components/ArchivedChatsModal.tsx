import React, { useState } from 'react';
import {
  X,
  Archive,
  RotateCcw,
  Trash2,
  MessageSquare,
  Clock,
  Zap,
} from 'lucide-react';
import { SessionItem } from '../types';
import { formatTokenCount, calculateSessionTokens } from '../utils/tokenUtils';

interface ArchivedChatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: SessionItem[];
  onSelectSession: (sess: SessionItem) => void;
  onUnarchiveSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
}

export const ArchivedChatsModal: React.FC<ArchivedChatsModalProps> = ({
  isOpen,
  onClose,
  sessions,
  onSelectSession,
  onUnarchiveSession,
  onDeleteSession,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  if (!isOpen) return null;

  const archivedSessions = sessions.filter(
    (s) => s.isArchived === true &&
    (!searchTerm.trim() ||
      s.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.messages?.some((m) => m.content.toLowerCase().includes(searchTerm.toLowerCase())))
  );

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/50">
          <div className="flex items-center gap-2">
            <Archive className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <div>
              <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                Chats Arquivados
              </h3>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Encontre, recupere ou exclua permanentemente conversas arquivadas.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-zinc-200 dark:border-zinc-800">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Pesquisar nos chats arquivados..."
            className="w-full bg-zinc-50 dark:bg-zinc-800/60 text-xs text-zinc-900 dark:text-zinc-100 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 outline-none focus:border-blue-500 transition"
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {archivedSessions.length === 0 ? (
            <div className="text-center py-12 text-zinc-400 dark:text-zinc-500">
              <Archive className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-xs">Nenhum chat arquivado encontrado.</p>
            </div>
          ) : (
            archivedSessions.map((sess) => {
              const tokenStats = calculateSessionTokens(sess.messages || []);
              const totalTokens = sess.messages?.[0]?.rawPayloadReceived?.tokenStats?.totalTokens || tokenStats.totalTokens;

              return (
                <div
                  key={sess.id}
                  className="flex items-center justify-between p-3 rounded-xl border border-zinc-200 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-900/40 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition gap-4"
                >
                  <div
                    onClick={() => {
                      onSelectSession(sess);
                      onClose();
                    }}
                    className="flex-1 min-w-0 cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                      <h4 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate hover:text-blue-500">
                        {sess.title || 'Conversa sem título'}
                      </h4>
                    </div>

                    <div className="flex items-center gap-2 mt-1.5 text-[10px] text-zinc-500 font-mono">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(sess.updatedAt).toLocaleString('pt-BR')}
                      </span>
                      <span>•</span>
                      <span>{sess.messages?.length || 0} msgs</span>
                      <span>•</span>
                      <span className="flex items-center text-amber-500 font-semibold">
                        <Zap className="w-3 h-3 mr-0.5" />
                        {formatTokenCount(totalTokens)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => onUnarchiveSession(sess.id)}
                      title="Desarquivar Chat"
                      className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('Deseja excluir permanentemente esta conversa?')) {
                          onDeleteSession(sess.id);
                        }
                      }}
                      title="Excluir Permanentemente"
                      className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
