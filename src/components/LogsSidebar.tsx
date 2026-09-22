import React from 'react';
import {
  Activity,
  X,
  Terminal,
} from 'lucide-react';
import { RealtimeLogsView } from './RealtimeLogsView.js';
import { SystemLogLevel, SystemLogCategory } from '../types.js';

interface LogsSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onEmitClientLog?: (message: string, level?: SystemLogLevel, category?: SystemLogCategory) => void;
}

export const LogsSidebar: React.FC<LogsSidebarProps> = ({
  onClose,
  onEmitClientLog,
}) => {
  return (
    <div className="h-full w-full flex flex-col bg-[#0c0c0e]/98 text-zinc-100 select-text overflow-hidden">
      {/* Header */}
      <div className="h-10 px-2.5 border-b border-emerald-500/20 flex items-center justify-between shrink-0 bg-zinc-950/90 gap-1.5 overflow-hidden">
        <div className="flex items-center gap-1.5 min-w-0">
          <Activity className="w-4 h-4 text-emerald-400 animate-pulse shrink-0" />
          <span className="text-[11px] font-mono font-bold uppercase tracking-tight text-emerald-400 truncate">
            LOGS EM TEMPO REAL
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-mono text-[9.5px] font-semibold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            <span>SSE</span>
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

      {/* Embedded Realtime Logs View */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <RealtimeLogsView onEmitClientLog={onEmitClientLog} />
      </div>
    </div>
  );
};
