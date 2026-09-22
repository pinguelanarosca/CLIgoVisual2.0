import React, { useState } from 'react';
import {
  Archive,
  RotateCcw,
  Trash2,
  MessageSquare,
  Search,
  X,
  Zap,
  Calendar,
} from 'lucide-react';
import { SessionItem } from '../types.js';
import { formatTokenCount, calculateSessionTokens } from '../utils/tokenUtils.js';

interface ArchivedChatsSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: SessionItem[];
  onSelectSession: (sess: SessionItem) => void;
  onUnarchiveSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
}

export const ArchivedChatsSidebar: React.FC<ArchivedChatsSidebarProps> = ({
  onClose,
  sessions,
  onSelectSession,
  onUnarchiveSession,
  onDeleteSession,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const archivedSessions = sessions.filter(
    (s) =>
      s.isArchived === true &&
      (!searchTerm.trim() ||
        (s.title || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.messages?.some((m) => m.content.toLowerCase().includes(searchTerm.toLowerCase())))
  );

  return (
    <div className="h-full w-full flex flex-col bg-[#0c0c0e]/98 text-zinc-100 select-text overflow-hidden">
      {/* Header */}
      <div className="h-10 px-2.5 border-b border-amber-500/20 flex items-center justify-between shrink-0 bg-zinc-950/90 gap-1.5 overflow-hidden">
        <div className="flex items-center gap-1.5 min-w-0">
          <Archive className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-[11px] font-mono font-bold uppercase tracking-tight text-amber-400 truncate">
            CHATS ARQUIVADOS
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 font-mono text-[9.5px] font-semibold">
            {archivedSessions.length} arq.
          </span>
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
            placeholder="Pesquisar nos arquivos..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-8 pr-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-amber-500/50 transition"
          />
        </div>
      </div>

      {/* List Content */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {archivedSessions.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-center text-zinc-500 gap-2">
            <Archive className="w-8 h-8 opacity-30 text-amber-400" />
            <p className="text-xs">Nenhum chat arquivado encontrado.</p>
          </div>
        ) : (
          archivedSessions.map((sess) => {
            const tokenStats = calculateSessionTokens(sess.messages || []);
            const totalTokens =
              sess.messages?.[0]?.rawPayloadReceived?.tokenStats?.totalTokens || tokenStats.totalTokens;

            return (
              <div
                key={sess.id}
                className="group p-2 rounded-lg border border-zinc-800/80 bg-zinc-900/60 hover:bg-zinc-800/50 hover:border-zinc-700/80 transition flex flex-col gap-1.5"
              >
                <div className="flex items-start justify-between gap-1.5">
                  <div
                    onClick={() => onSelectSession(sess)}
                    className="flex-1 min-w-0 cursor-pointer"
                  >
                    <h4 className="text-xs font-semibold text-zinc-200 group-hover:text-amber-300 transition truncate">
                      {sess.title || 'Conversa Arquivada'}
                    </h4>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-zinc-500 font-mono">
                      <span className="flex items-center gap-1">
                        <MessageSquare className="w-2.5 h-2.5" />
                        {sess.messages?.length || 0} msgs
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-0.5 text-amber-400 font-semibold">
                        <Zap className="w-2.5 h-2.5" />
                        {formatTokenCount(totalTokens)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => onUnarchiveSession(sess.id)}
                      title="Desarquivar e mover para conversas ativas"
                      className="p-1 rounded bg-amber-950/40 border border-amber-800/50 hover:bg-amber-900/60 text-amber-300 transition cursor-pointer text-[10px] flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span className="hidden sm:inline">Restaurar</span>
                    </button>

                    <button
                      onClick={() => {
                        if (confirm(`Excluir permanentemente o chat "${sess.title}"?`)) {
                          onDeleteSession(sess.id);
                        }
                      }}
                      title="Excluir permanentemente"
                      className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 transition cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {sess.messages && sess.messages.length > 0 && (
                  <p className="text-[11px] text-zinc-400 line-clamp-1 italic bg-zinc-950/50 px-2 py-0.5 rounded border border-zinc-900">
                    "{sess.messages[sess.messages.length - 1]?.content.slice(0, 80)}..."
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
