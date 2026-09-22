import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Activity,
  Trash2,
  Download,
  Copy,
  Check,
  Search,
  Filter,
  Pause,
  Play,
  ArrowDown,
  RefreshCw,
  Terminal,
  Shield,
  Layers,
  Sparkles,
  GitBranch,
  Volume2,
  Package,
  Key,
  Cpu,
  Server,
} from 'lucide-react';
import { SystemLogEntry, SystemLogLevel, SystemLogCategory } from '../types';
import { fetchJsonSafely } from '../utils/apiUtils';

interface RealtimeLogsViewProps {
  onEmitClientLog?: (message: string, level?: SystemLogLevel, category?: SystemLogCategory) => void;
}

const CATEGORIES: { id: SystemLogCategory | 'ALL'; label: string; icon: any }[] = [
  { id: 'ALL', label: 'Todos', icon: Layers },
  { id: 'CLI', label: 'Gemini CLI', icon: Terminal },
  { id: 'API', label: 'API / HTTP', icon: Server },
  { id: 'AGENT', label: 'Agentes', icon: Sparkles },
  { id: 'SKILL', label: 'Skills', icon: Cpu },
  { id: 'COMMAND', label: 'Comandos', icon: Terminal },
  { id: 'MCP', label: 'Servidores MCP', icon: Layers },
  { id: 'GIT', label: 'Git / GitHub', icon: GitBranch },
  { id: 'AUDIO', label: 'Áudio STT/TTS', icon: Volume2 },
  { id: 'PACKAGE', label: 'Empacotamento', icon: Package },
  { id: 'AUTH', label: 'Autenticação / Chaves', icon: Key },
  { id: 'SYSTEM', label: 'Sistema', icon: Shield },
];

const LEVELS: { id: SystemLogLevel | 'ALL'; label: string; color: string }[] = [
  { id: 'ALL', label: 'Todos os Níveis', color: 'text-zinc-600 dark:text-zinc-300' },
  { id: 'info', label: 'INFO', color: 'text-blue-600 dark:text-blue-400' },
  { id: 'success', label: 'SUCESSO', color: 'text-emerald-600 dark:text-emerald-400' },
  { id: 'warn', label: 'AVISO', color: 'text-amber-600 dark:text-amber-400' },
  { id: 'error', label: 'ERRO', color: 'text-rose-600 dark:text-rose-400' },
  { id: 'debug', label: 'DEBUG', color: 'text-purple-600 dark:text-purple-400' },
];

export const RealtimeLogsView: React.FC<RealtimeLogsViewProps> = () => {
  const [logs, setLogs] = useState<SystemLogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<SystemLogCategory | 'ALL'>('ALL');
  const [selectedLevel, setSelectedLevel] = useState<SystemLogLevel | 'ALL'>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [expandedDetailsId, setExpandedDetailsId] = useState<string | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // 1. Initial load of logs from API
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

  // 2. Setup Server-Sent Events (SSE) stream
  useEffect(() => {
    fetchInitialLogs();

    const connectSse = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const es = new EventSource('/api/logs/stream');
      eventSourceRef.current = es;

      es.onopen = () => {
        setIsConnected(true);
      };

      let logBuffer: SystemLogEntry[] = [];
      let rafId: number | null = null;

      const processLogBuffer = () => {
        rafId = null;
        if (logBuffer.length === 0) return;
        const toAdd = [...logBuffer];
        logBuffer = [];

        setLogs((prev) => {
          const existingIds = new Set(prev.map((i) => i.id));
          const fresh = toAdd.filter((item) => !existingIds.has(item.id));
          if (fresh.length === 0) return prev;
          const updated = [...prev, ...fresh];
          if (updated.length > 2000) {
            return updated.slice(-2000);
          }
          return updated;
        });
      };

      es.onmessage = (e) => {
        if (!e.data || e.data.trim() === ': ping') return;
        try {
          const newEntry: SystemLogEntry = JSON.parse(e.data);
          if (newEntry && newEntry.id) {
            logBuffer.push(newEntry);
            if (!rafId) {
              rafId = requestAnimationFrame(processLogBuffer);
            }
          }
        } catch {
          // Ignore non-json chunk
        }
      };

      es.onerror = () => {
        setIsConnected(false);
        es.close();
        // Reconnect after 3s
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

  // 3. Auto-scroll behavior
  useEffect(() => {
    if (autoScroll && !isPaused && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll, isPaused]);

  // 4. Handle user scroll to detect if they scrolled up
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    if (!isAtBottom && autoScroll) {
      setAutoScroll(false);
    } else if (isAtBottom && !autoScroll) {
      setAutoScroll(true);
    }
  };

  // 5. Filter logs
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (selectedCategory !== 'ALL' && log.category !== selectedCategory) {
        return false;
      }
      if (selectedLevel !== 'ALL' && log.level !== selectedLevel) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesMsg = log.message.toLowerCase().includes(q);
        const matchesDate = log.formattedDateTime.toLowerCase().includes(q);
        const matchesCat = log.category.toLowerCase().includes(q);
        const matchesSource = log.source ? log.source.toLowerCase().includes(q) : false;
        const matchesDetails = log.details ? JSON.stringify(log.details).toLowerCase().includes(q) : false;
        return matchesMsg || matchesDate || matchesCat || matchesSource || matchesDetails;
      }
      return true;
    });
  }, [logs, selectedCategory, selectedLevel, searchQuery]);

  // 6. Clear Logs
  const handleClear = async () => {
    try {
      await fetch('/api/logs', { method: 'DELETE' });
      setLogs([]);
    } catch (err) {
      console.error('Erro ao limpar logs:', err);
    }
  };

  // 7. Download Logs File
  const handleDownload = () => {
    window.location.href = '/api/logs/export';
  };

  // 8. Copy All Visible
  const handleCopyAll = () => {
    const text = filteredLogs
      .map(
        (l) =>
          `[${l.formattedDateTime}] [${l.level.toUpperCase().padEnd(7)}] [${l.category.padEnd(8)}] ${l.message}`
      )
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2500);
  };

  // 9. Copy Single Line
  const handleCopyLine = (log: SystemLogEntry) => {
    const text = `[${log.formattedDateTime}] [${log.level.toUpperCase()}] [${log.category}] ${log.message}`;
    navigator.clipboard.writeText(text);
    setCopiedId(log.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getLevelBadge = (level: SystemLogLevel) => {
    switch (level) {
      case 'error':
        return 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30';
      case 'warn':
        return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30';
      case 'success':
        return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30';
      case 'debug':
        return 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30';
      case 'info':
      default:
        return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30';
    }
  };

  const getCategoryBadge = (cat: SystemLogCategory) => {
    switch (cat) {
      case 'CLI':
        return 'bg-zinc-800 text-zinc-200 border-zinc-700';
      case 'API':
        return 'bg-cyan-950/40 text-cyan-400 border-cyan-800/40';
      case 'GIT':
        return 'bg-violet-950/40 text-violet-400 border-violet-800/40';
      case 'AGENT':
        return 'bg-indigo-950/40 text-indigo-400 border-indigo-800/40';
      case 'SKILL':
        return 'bg-teal-950/40 text-teal-400 border-teal-800/40';
      case 'AUDIO':
        return 'bg-fuchsia-950/40 text-fuchsia-400 border-fuchsia-800/40';
      case 'PACKAGE':
        return 'bg-amber-950/40 text-amber-400 border-amber-800/40';
      case 'AUTH':
        return 'bg-emerald-950/40 text-emerald-400 border-emerald-800/40';
      default:
        return 'bg-zinc-900 text-zinc-300 border-zinc-800';
    }
  };

  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(false);

  return (
    <div className="h-full w-full flex flex-col space-y-2 overflow-hidden text-xs font-sans select-text p-1.5">
      {/* Header & Action Bar */}
      <div className="shrink-0 space-y-1.5 bg-zinc-950/80 p-1.5 rounded-lg border border-zinc-800/80">
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse shrink-0" />
            <span className="font-mono text-[11px] font-bold text-zinc-200 truncate">
              Logs em Tempo Real
            </span>
            <span className={`w-2 h-2 rounded-full shrink-0 ${isConnected ? 'bg-emerald-500' : 'bg-rose-500'}`} />
          </div>

          {/* Grouped Actions Dropdown Menu */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setIsActionsOpen(!isActionsOpen)}
              className="px-2 py-1 rounded bg-zinc-900 border border-zinc-700/80 hover:bg-zinc-800 text-zinc-200 font-mono text-[10.5px] font-semibold flex items-center gap-1 transition cursor-pointer"
            >
              <span>Ações</span>
              <span className="text-[9px] text-zinc-400">▼</span>
            </button>

            {isActionsOpen && (
              <div
                className="absolute right-0 top-8 z-50 w-44 bg-zinc-900 border border-zinc-700/80 rounded-lg shadow-xl p-1 text-xs space-y-0.5"
                onClick={() => setIsActionsOpen(false)}
              >
                <button
                  onClick={() => setIsPaused(!isPaused)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-zinc-200 cursor-pointer"
                >
                  {isPaused ? <Play className="w-3.5 h-3.5 text-amber-400" /> : <Pause className="w-3.5 h-3.5 text-blue-400" />}
                  <span>{isPaused ? 'Retomar Fluxo' : 'Pausar Fluxo'}</span>
                </button>

                <button
                  onClick={handleCopyAll}
                  disabled={filteredLogs.length === 0}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-zinc-200 disabled:opacity-40 cursor-pointer"
                >
                  {copiedAll ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-zinc-400" />}
                  <span>{copiedAll ? 'Copiado!' : 'Copiar Todos'}</span>
                </button>

                <button
                  onClick={handleDownload}
                  disabled={logs.length === 0}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800 text-zinc-200 disabled:opacity-40 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-blue-400" />
                  <span>Baixar Arquivo .LOG</span>
                </button>

                <div className="border-t border-zinc-800 my-0.5" />

                <button
                  onClick={handleClear}
                  disabled={logs.length === 0}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-rose-950/60 text-rose-400 disabled:opacity-40 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                  <span>Limpar Histórico</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Search input */}
        <div className="relative">
          <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filtrar mensagem, hora, endpoint..."
            className="w-full pl-7 pr-2 py-1 text-[11px] rounded bg-zinc-900 border border-zinc-800 text-zinc-200 outline-none focus:border-emerald-500/60 transition font-mono truncate"
          />
        </div>

        {/* Expandable Accordions for Filters & Categories */}
        <div className="space-y-1 pt-0.5">
          {/* Accordion 1: Nível de Log */}
          <div className="border border-zinc-800/80 rounded bg-zinc-900/60 overflow-hidden">
            <button
              type="button"
              onClick={() => setIsFiltersOpen(!isFiltersOpen)}
              className="w-full px-2 py-1 flex items-center justify-between text-[10.5px] font-semibold text-zinc-300 hover:bg-zinc-800/60 transition cursor-pointer"
            >
              <div className="flex items-center gap-1.5">
                <Filter className="w-3 h-3 text-emerald-400" />
                <span>Nível de Log:</span>
                <span className="text-emerald-400 font-mono font-bold uppercase">{selectedLevel}</span>
              </div>
              <span className="text-[9px] text-zinc-500">{isFiltersOpen ? '▲' : '▼'}</span>
            </button>

            {isFiltersOpen && (
              <div className="p-1.5 bg-zinc-950/80 border-t border-zinc-800/80 flex flex-wrap gap-1">
                {LEVELS.map((lvl) => (
                  <button
                    key={lvl.id}
                    onClick={() => {
                      setSelectedLevel(lvl.id as any);
                      setIsFiltersOpen(false);
                    }}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition cursor-pointer ${
                      selectedLevel === lvl.id
                        ? 'bg-emerald-600 text-white font-bold'
                        : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-zinc-200'
                    }`}
                  >
                    {lvl.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Accordion 2: Categorias de Monitoramento (Empilhadas em Lista Expansível) */}
          <div className="border border-zinc-800/80 rounded bg-zinc-900/60 overflow-hidden">
            <button
              type="button"
              onClick={() => setIsCategoriesOpen(!isCategoriesOpen)}
              className="w-full px-2 py-1 flex items-center justify-between text-[10.5px] font-semibold text-zinc-300 hover:bg-zinc-800/60 transition cursor-pointer"
            >
              <div className="flex items-center gap-1.5">
                <Layers className="w-3 h-3 text-blue-400" />
                <span>Categoria Monitorada:</span>
                <span className="text-blue-400 font-mono font-bold uppercase">{selectedCategory}</span>
              </div>
              <span className="text-[9px] text-zinc-500">{isCategoriesOpen ? '▲' : '▼'}</span>
            </button>

            {isCategoriesOpen && (
              <div className="p-1 bg-zinc-950/80 border-t border-zinc-800/80 space-y-0.5 max-h-48 overflow-y-auto">
                {CATEGORIES.map((cat) => {
                  const Icon = cat.icon;
                  const isSel = selectedCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => {
                        setSelectedCategory(cat.id);
                        setIsCategoriesOpen(false);
                      }}
                      className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-[10.5px] transition cursor-pointer ${
                        isSel
                          ? 'bg-blue-600/30 text-blue-300 font-bold border border-blue-500/40'
                          : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                      }`}
                    >
                      <Icon className="w-3 h-3 shrink-0 text-blue-400" />
                      <span className="truncate">{cat.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Terminal View / Live Logs List with ULTRA-MINIMAL PADDING */}
      <div className="flex-1 min-h-0 relative flex flex-col rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-200 font-mono text-[10.5px] overflow-hidden">
        {/* Terminal Sub-header */}
        <div className="flex items-center justify-between px-2 py-1 bg-zinc-900/90 border-b border-zinc-800 text-[10px] text-zinc-400 shrink-0">
          <span className="truncate font-sans">
            Linhas: {filteredLogs.length}/{logs.length}
          </span>
          <button
            onClick={() => fetchInitialLogs()}
            title="Recarregar"
            className="text-zinc-400 hover:text-white transition cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>

        {/* Scrollable logs body */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-1 space-y-1 select-text"
        >
          {filteredLogs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-500 py-8 text-[11px]">
              <Terminal className="w-6 h-6 text-zinc-600 opacity-60 mb-1" />
              <span>Nenhum log encontrado.</span>
            </div>
          ) : (
            filteredLogs.map((log) => {
              const isDetailsOpen = expandedDetailsId === log.id;
              return (
                <div
                  key={log.id}
                  className="group relative rounded p-1 hover:bg-zinc-900/80 transition border border-zinc-900/60 leading-tight space-y-0.5"
                >
                  <div className="flex items-start gap-1 flex-wrap">
                    {/* Timestamp */}
                    <span className="text-[9.5px] font-bold text-zinc-400 bg-zinc-900 px-1 py-0.2 rounded border border-zinc-800/80 shrink-0">
                      {log.formattedDateTime}
                    </span>

                    {/* Level Pill */}
                    <span
                      className={`px-1 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider shrink-0 border ${getLevelBadge(
                        log.level
                      )}`}
                    >
                      {log.level}
                    </span>

                    {/* Category Pill */}
                    <span
                      className={`px-1 py-0.2 rounded text-[9px] font-semibold uppercase tracking-wider shrink-0 border ${getCategoryBadge(
                        log.category
                      )}`}
                    >
                      {log.category}
                    </span>

                    {/* Source if present */}
                    {log.source && (
                      <span className="text-[9px] text-zinc-400 bg-zinc-900 px-1 rounded shrink-0">
                        @{log.source}
                      </span>
                    )}
                  </div>

                  {/* Main Message with minimal margins */}
                  <div className="text-zinc-200 font-sans text-[11px] leading-snug break-words px-0.5">
                    {log.message}
                  </div>

                  {/* Options on hover */}
                  <div className="flex items-center justify-end gap-1 pt-0.5">
                    {log.details && (
                      <button
                        type="button"
                        onClick={() => setExpandedDetailsId(isDetailsOpen ? null : log.id)}
                        className="px-1 py-0.2 text-[9px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition cursor-pointer"
                      >
                        {isDetailsOpen ? 'Ocultar JSON' : 'Ver JSON'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleCopyLine(log)}
                      title="Copiar linha"
                      className="p-0.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition cursor-pointer"
                    >
                      {copiedId === log.id ? (
                        <Check className="w-2.5 h-2.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-2.5 h-2.5" />
                      )}
                    </button>
                  </div>

                  {/* Expanded JSON details */}
                  {log.details && isDetailsOpen && (
                    <div className="mt-1 p-1.5 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-emerald-400 font-mono overflow-x-auto whitespace-pre-wrap">
                      {typeof log.details === 'object'
                        ? JSON.stringify(log.details, null, 2)
                        : String(log.details)}
                    </div>
                  )}
                </div>
              );
            })
          )}
          <div ref={logsEndRef} />
        </div>

        {/* Scroll to bottom button */}
        {!autoScroll && (
          <button
            type="button"
            onClick={() => {
              setAutoScroll(true);
              if (logsEndRef.current) {
                logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
              }
            }}
            className="absolute bottom-2 right-2 px-2 py-1 rounded-full bg-blue-600 text-white text-[10px] font-semibold shadow-lg flex items-center gap-1 transition cursor-pointer animate-bounce"
          >
            <ArrowDown className="w-3 h-3" />
            <span>Rolar até o final</span>
          </button>
        )}
      </div>
    </div>
  );
};
