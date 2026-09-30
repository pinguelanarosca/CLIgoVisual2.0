import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Trash2,
  Copy,
  Check,
  Search,
  Pause,
  Play,
  ArrowDown,
  Terminal,
  ChevronDown,
  ChevronRight,
  Download,
  Save,
} from 'lucide-react';
import { SystemLogEntry, SystemLogLevel, SystemLogCategory } from '../types.js';
import { fetchJsonSafely } from '../utils/apiUtils.js';
import { LogSaveModal } from './LogSaveModal.js';

interface RealtimeLogsViewProps {
  onEmitClientLog?: (message: string, level?: SystemLogLevel, category?: SystemLogCategory) => void;
}

const LEVELS: { id: SystemLogLevel | 'ALL'; label: string }[] = [
  { id: 'ALL', label: 'Todos os Níveis' },
  { id: 'info', label: 'INF - Informação' },
  { id: 'success', label: 'OK - Sucesso' },
  { id: 'warn', label: 'WRN - Aviso' },
  { id: 'error', label: 'ERR - Erro' },
  { id: 'debug', label: 'DBG - Debug' },
];

export const RealtimeLogsView: React.FC<RealtimeLogsViewProps> = () => {
  const [logs, setLogs] = useState<SystemLogEntry[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLevel, setSelectedLevel] = useState<SystemLogLevel | 'ALL'>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Buffer para throttling de atualizações
  const logBufferRef = useRef<SystemLogEntry[]>([]);

  // 1. Initial load of logs
  const fetchInitialLogs = async () => {
    try {
      const data = await fetchJsonSafely<{ logs: SystemLogEntry[] }>('/api/logs?limit=500', undefined, { logs: [] });
      if (data && Array.isArray(data.logs)) {
        setLogs(data.logs);
      }
    } catch (err) {
      console.error('Falha ao carregar histórico inicial de logs:', err);
    }
  };

  // 2. Interval batch flusher
  useEffect(() => {
    const flushInterval = setInterval(() => {
      if (isPaused || logBufferRef.current.length === 0) return;

      const toAdd = [...logBufferRef.current];
      logBufferRef.current = [];

      setLogs((prev) => {
        const existingIds = new Set(prev.map((i) => i.id));
        const fresh = toAdd.filter((item) => !existingIds.has(item.id));
        if (fresh.length === 0) return prev;
        const updated = [...prev, ...fresh];
        if (updated.length > 1500) {
          return updated.slice(-1500);
        }
        return updated;
      });
    }, 800);

    return () => clearInterval(flushInterval);
  }, [isPaused]);

  // 3. Setup SSE Stream
  useEffect(() => {
    fetchInitialLogs();

    const connectSse = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const es = new EventSource('/api/logs/stream');
      eventSourceRef.current = es;

      es.onmessage = (e) => {
        if (!e.data || e.data.trim() === ': ping') return;
        try {
          const newEntry: SystemLogEntry = JSON.parse(e.data);
          if (newEntry && newEntry.id) {
            logBufferRef.current.push(newEntry);
          }
        } catch {
          // Ignore
        }
      };

      es.onerror = () => {
        es.close();
        setTimeout(connectSse, 3000);
      };
    };

    connectSse();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  // Click outside listener to auto-close expanded log detail
  const activeLogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!expandedLogId) return;

    const handlePointerDown = (event: PointerEvent | MouseEvent) => {
      if (activeLogRef.current && !activeLogRef.current.contains(event.target as Node)) {
        setExpandedLogId(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [expandedLogId]);
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    // Somente altera para bottom se o usuário rolar manualmente até o final e não houver log expandido
    if (isAtBottom && !expandedLogId) {
      setAutoScroll(true);
    } else if (!isAtBottom) {
      setAutoScroll(false);
    }
  };

  useEffect(() => {
    if (autoScroll && logsEndRef.current && !expandedLogId) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll, expandedLogId]);

  // Filtering
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (selectedLevel !== 'ALL' && log.level !== selectedLevel) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchMsg = log.message.toLowerCase().includes(q);
        const matchSrc = log.source?.toLowerCase().includes(q);
        const matchCat = log.category.toLowerCase().includes(q);
        return matchMsg || matchSrc || matchCat;
      }
      return true;
    });
  }, [logs, selectedLevel, searchQuery]);

  const handleClear = () => {
    setLogs([]);
    logBufferRef.current = [];
  };

  const handleCopyLine = (log: SystemLogEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    const text = `[${log.formattedDateTime || log.timestamp}] [${log.level.toUpperCase()}] [${log.category}] ${log.message}`;
    navigator.clipboard.writeText(text);
    setCopiedId(log.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleToggleExpand = (logId: string) => {
    if (expandedLogId === logId) {
      setExpandedLogId(null);
    } else {
      setExpandedLogId(logId);
      // Ao clicar para inspecionar o log, desativa a rolagem automática para o usuário ler em paz
      setAutoScroll(false);
    }
  };

  const getLevelBadge = (level: SystemLogLevel) => {
    switch (level) {
      case 'error':
        return 'text-rose-400 bg-rose-950/80 border-rose-800/80';
      case 'warn':
        return 'text-amber-400 bg-amber-950/80 border-amber-800/80';
      case 'success':
        return 'text-emerald-400 bg-emerald-950/80 border-emerald-800/80';
      case 'debug':
        return 'text-purple-400 bg-purple-950/80 border-purple-800/80';
      default:
        return 'text-blue-400 bg-blue-950/80 border-blue-800/80';
    }
  };

  return (
    <div className="h-full w-full flex flex-col space-y-1.5 overflow-hidden text-[11px] font-sans select-text p-1">
      {/* Barra de Controles Ultra Compacta na Parte Superior (Ajustada para layout vertical/retrato sem saltos) */}
      <div className="shrink-0 flex flex-wrap sm:flex-nowrap items-center gap-1 bg-zinc-950 p-1 rounded-md border border-zinc-800">
        <div className="relative flex-1 min-w-[110px]">
          <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filtrar logs..."
            className="w-full pl-6 pr-2 py-0.5 text-[10px] rounded bg-zinc-900 border border-zinc-800 text-zinc-200 outline-none focus:border-blue-500 font-mono"
          />
        </div>

        <select
          value={selectedLevel}
          onChange={(e: any) => setSelectedLevel(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-[10px] font-mono rounded px-1 py-0.5 outline-none cursor-pointer shrink-0 max-w-[100px] truncate"
        >
          {LEVELS.map((l) => (
            <option key={l.id} value={l.id} className="bg-zinc-900">
              {l.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => {
            const newPaused = !isPaused;
            setIsPaused(newPaused);
            if (!newPaused) setAutoScroll(true);
          }}
          title={isPaused ? 'Retomar atualizações' : 'Pausar fluxo'}
          className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition cursor-pointer flex items-center gap-1 shrink-0 ${
            isPaused
              ? 'bg-amber-950 text-amber-300 border border-amber-800'
              : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800 border border-zinc-800'
          }`}
        >
          {isPaused ? <Play className="w-2.5 h-2.5 text-amber-400 shrink-0" /> : <Pause className="w-2.5 h-2.5 text-blue-400 shrink-0" />}
          <span className="hidden xs:inline">{isPaused ? 'Pausado' : 'Ao Vivo'}</span>
        </button>

        <button
          type="button"
          onClick={() => setIsSaveModalOpen(true)}
          title="Opções para Salvar / Exportar Logs (TXT, JSON, CSV, MD, Servidor)"
          className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/60 text-emerald-300 transition cursor-pointer flex items-center gap-1 shrink-0"
        >
          <Save className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
          <span className="hidden xs:inline">Salvar</span>
        </button>

        <button
          type="button"
          onClick={handleClear}
          title="Limpar logs registrados"
          className="p-1 rounded text-zinc-400 hover:text-rose-400 hover:bg-zinc-900 transition cursor-pointer shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Terminal Compact Stream View com Expansão de Riqueza de Detalhes ao Clicar */}
      <div className="flex-1 min-h-0 relative flex flex-col rounded-md border border-zinc-800 bg-zinc-950 text-zinc-200 font-mono text-[10px] overflow-hidden">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-1 space-y-0.5 select-text divide-y divide-zinc-900/60"
        >
          {filteredLogs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-500 py-6 text-[10px]">
              <Terminal className="w-5 h-5 text-zinc-700 opacity-60 mb-1" />
              <span>Nenhum log registrado.</span>
            </div>
          ) : (
            filteredLogs.map((log) => {
              const isExpanded = expandedLogId === log.id;
              const formattedTime =
                typeof log.timestamp === 'string' && log.timestamp.length >= 19
                  ? log.timestamp.slice(11, 19)
                  : log.formattedDateTime?.split(' ')[1] || '00:00:00';

              return (
                <div
                  key={log.id}
                  ref={isExpanded ? activeLogRef : null}
                  className="group rounded-xs transition overflow-hidden"
                >
                  {/* Linha Compacta Principal — Clicar expande; passar o mouse mostra horário/data no tooltip */}
                  <div
                    onClick={() => handleToggleExpand(log.id)}
                    title={`Horário: ${formattedTime} | Data/Hora: ${log.formattedDateTime || log.timestamp}`}
                    className={`py-0.5 px-1 hover:bg-zinc-900/80 cursor-pointer flex items-center justify-between gap-1.5 text-[10px] leading-snug transition ${
                      isExpanded ? 'bg-zinc-900/90 font-semibold border-l-2 border-blue-500 pl-1.5' : ''
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
                      {isExpanded ? (
                        <ChevronDown className="w-2.5 h-2.5 text-blue-400 shrink-0" />
                      ) : (
                        <ChevronRight className="w-2.5 h-2.5 text-zinc-600 group-hover:text-zinc-400 shrink-0" />
                      )}

                      <span
                        className={`px-1 py-0.1 rounded text-[7.5px] font-mono font-bold uppercase shrink-0 text-center ${getLevelBadge(
                          log.level
                        )}`}
                      >
                        {log.level === 'success'
                          ? 'OK'
                          : log.level === 'error'
                          ? 'ERR'
                          : log.level === 'warn'
                          ? 'WRN'
                          : log.level === 'info'
                          ? 'INF'
                          : 'DBG'}
                      </span>

                      <span className="text-zinc-300 font-mono text-[10px] truncate min-w-0 flex-1" title={log.message}>
                        {log.message}
                      </span>
                    </div>

                    <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                      <button
                        type="button"
                        onClick={(e) => handleCopyLine(log, e)}
                        className="p-0.5 text-zinc-500 hover:text-zinc-200 cursor-pointer"
                        title="Copiar linha"
                      >
                        {copiedId === log.id ? (
                          <Check className="w-2.5 h-2.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-2.5 h-2.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Painel de Riqueza de Detalhes Expandido */}
                  {isExpanded && (
                    <div className="p-2.5 my-1 mx-1 rounded bg-zinc-900 border border-zinc-800 space-y-2 text-[10px] font-mono text-zinc-300 animate-in fade-in duration-150">
                      <div className="flex items-center justify-between border-b border-zinc-800 pb-1 text-zinc-400 text-[9px]">
                        <div className="flex items-center gap-2">
                          <span className="text-zinc-200 font-bold">ID: {log.id}</span>
                          <span>|</span>
                          <span>Timestamp: {log.formattedDateTime || log.timestamp}</span>
                        </div>
                        <span className="uppercase font-bold text-blue-400">{log.category}</span>
                      </div>

                      {log.source && (
                        <div className="text-zinc-400">
                          <span className="text-zinc-500 font-semibold">Módulo/Origem:</span>{' '}
                          <code className="text-amber-300">{log.source}</code>
                        </div>
                      )}

                      <div className="space-y-1">
                        <span className="text-zinc-500 font-semibold">Mensagem Completa:</span>
                        <div className="p-2 rounded bg-zinc-950 border border-zinc-800 text-zinc-100 whitespace-pre-wrap break-words leading-relaxed">
                          {log.message}
                        </div>
                      </div>

                      {log.details && (
                        <div className="space-y-1">
                          <span className="text-zinc-500 font-semibold">Payload / Detalhes Estruturados (JSON):</span>
                          <pre className="p-2 rounded bg-zinc-950 border border-zinc-800 text-emerald-400/90 text-[9.5px] overflow-x-auto whitespace-pre-wrap max-h-48">
                            {typeof log.details === 'string'
                              ? log.details
                              : JSON.stringify(log.details, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
          <div ref={logsEndRef} />
        </div>

        {!autoScroll && (
          <button
            type="button"
            onClick={() => {
              setExpandedLogId(null);
              setAutoScroll(true);
              if (logsEndRef.current) {
                logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
              }
            }}
            className="absolute bottom-2 right-2 px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold shadow-md flex items-center gap-1 cursor-pointer transition"
          >
            <ArrowDown className="w-3 h-3" />
            <span>Acompanhar Ao Vivo</span>
          </button>
        )}
      </div>

      <LogSaveModal
        isOpen={isSaveModalOpen}
        onClose={() => setIsSaveModalOpen(false)}
        allLogs={logs}
        filteredLogs={filteredLogs}
        currentFilterLevel={selectedLevel}
        currentSearchQuery={searchQuery}
      />
    </div>
  );
};
