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
      const res = await fetch('/api/logs?limit=500');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.logs)) {
          setLogs(data.logs);
        }
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

      es.onmessage = (e) => {
        if (!e.data || e.data.trim() === ': ping') return;
        try {
          const newEntry: SystemLogEntry = JSON.parse(e.data);
          if (newEntry && newEntry.id) {
            setLogs((prev) => {
              if (prev.some((item) => item.id === newEntry.id)) {
                return prev;
              }
              const updated = [...prev, newEntry];
              if (updated.length > 2500) {
                return updated.slice(-2500);
              }
              return updated;
            });
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

  return (
    <div className="space-y-4 max-w-5xl flex flex-col h-[750px] max-h-[80vh]">
      {/* Header & Controls bar */}
      <div className="shrink-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Logs do Sistema em Tempo Real</span>
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
                  }`}
                />
                {isConnected ? 'Transmissão Ao Vivo (SSE)' : 'Reconectando...'}
              </span>
            </h4>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Rastreamento em tempo real de chamadas do Gemini CLI, APIs, Agentes, Git, Áudio e eventos do sistema.
              Cada registro contém carimbo de data e hora com milissegundos.
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsPaused(!isPaused)}
              title={isPaused ? 'Retomar transmissão' : 'Pausar fluxo de logs'}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition flex items-center gap-1.5 cursor-pointer shadow-xs ${
                isPaused
                  ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
                  : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700'
              }`}
            >
              {isPaused ? <Play className="w-3.5 h-3.5 text-amber-600" /> : <Pause className="w-3.5 h-3.5" />}
              <span>{isPaused ? 'Pausado' : 'Pausar'}</span>
            </button>

            <button
              type="button"
              onClick={handleCopyAll}
              disabled={filteredLogs.length === 0}
              className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
            >
              {copiedAll ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedAll ? 'Copiado!' : 'Copiar'}</span>
            </button>

            <button
              type="button"
              onClick={handleDownload}
              disabled={logs.length === 0}
              className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Baixar .LOG</span>
            </button>

            <button
              type="button"
              onClick={handleClear}
              disabled={logs.length === 0}
              className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20 hover:bg-rose-100/70 text-rose-700 dark:text-rose-300 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Limpar</span>
            </button>
          </div>
        </div>

        {/* Filter bar: Search, Categories, Levels */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 pt-1">
          {/* Search box */}
          <div className="md:col-span-6 relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Pesquisar por data, hora, palavra-chave, endpoint, etc..."
              className="w-full pl-8.5 pr-3 py-1.5 text-xs rounded-lg bg-zinc-50 dark:bg-zinc-800/90 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500 transition"
            />
          </div>

          {/* Level Filter */}
          <div className="md:col-span-3">
            <select
              value={selectedLevel}
              onChange={(e) => setSelectedLevel(e.target.value as any)}
              className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-zinc-50 dark:bg-zinc-800/90 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500 transition cursor-pointer"
            >
              {LEVELS.map((lvl) => (
                <option key={lvl.id} value={lvl.id}>
                  {lvl.label}
                </option>
              ))}
            </select>
          </div>

          {/* Category Filter */}
          <div className="md:col-span-3">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value as any)}
              className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-zinc-50 dark:bg-zinc-800/90 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500 transition cursor-pointer"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Category Pills shortcut */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] scrollbar-none">
          <span className="text-zinc-400 dark:text-zinc-500 text-[10px] uppercase font-semibold flex items-center gap-1 shrink-0">
            <Filter className="w-3 h-3" /> Categorias:
          </span>
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const isSel = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-2 py-0.5 rounded-md font-medium transition shrink-0 flex items-center gap-1 cursor-pointer ${
                  isSel
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-zinc-100 dark:bg-zinc-800/80 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <Icon className="w-3 h-3" />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Terminal View / Live Logs Canvas */}
      <div className="flex-1 min-h-0 relative flex flex-col rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-200 shadow-inner overflow-hidden font-mono text-[11px]">
        {/* Terminal Header bar */}
        <div className="flex items-center justify-between px-3.5 py-2 bg-zinc-900 border-b border-zinc-800 text-[11px] text-zinc-400 shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
            <span className="ml-2 text-zinc-400 font-sans font-medium">terminal://realtime-system-logs</span>
          </div>

          <div className="flex items-center gap-3">
            <span>
              {filteredLogs.length} / {logs.length} linhas
            </span>
            <button
              onClick={() => fetchInitialLogs()}
              title="Recarregar logs"
              className="text-zinc-400 hover:text-white transition cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Scrollable logs body */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-3 space-y-1.5 select-text"
        >
          {filteredLogs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-500 space-y-2 py-12">
              <Terminal className="w-8 h-8 text-zinc-600 opacity-60" />
              <p className="text-xs">Nenhum evento registrado com os filtros selecionados.</p>
            </div>
          ) : (
            filteredLogs.map((log) => {
              const isDetailsOpen = expandedDetailsId === log.id;
              return (
                <div
                  key={log.id}
                  className="group relative flex flex-col rounded p-1.5 hover:bg-zinc-900/80 transition border border-transparent hover:border-zinc-800/80"
                >
                  <div className="flex items-start gap-2 flex-wrap sm:flex-nowrap leading-relaxed">
                    {/* Timestamp with Date and Time (Required) */}
                    <span className="text-zinc-400 font-bold shrink-0 select-all tracking-tight bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800 text-[10px]">
                      {log.formattedDateTime}
                    </span>

                    {/* Level Pill */}
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 border ${getLevelBadge(
                        log.level
                      )}`}
                    >
                      {log.level}
                    </span>

                    {/* Category Pill */}
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider shrink-0 border ${getCategoryBadge(
                        log.category
                      )}`}
                    >
                      {log.category}
                    </span>

                    {/* Source if present */}
                    {log.source && (
                      <span className="text-[10px] text-zinc-400 bg-zinc-900/60 px-1 rounded shrink-0">
                        @{log.source}
                      </span>
                    )}

                    {/* Main Message */}
                    <span className="text-zinc-200 flex-1 break-words font-sans text-xs">
                      {log.message}
                    </span>

                    {/* Copy Line Button on Hover */}
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 shrink-0">
                      {log.details && (
                        <button
                          type="button"
                          onClick={() => setExpandedDetailsId(isDetailsOpen ? null : log.id)}
                          className="px-1 py-0.5 text-[10px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
                        >
                          {isDetailsOpen ? 'Ocultar JSON' : 'Ver JSON'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleCopyLine(log)}
                        title="Copiar linha com data e hora"
                        className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
                      >
                        {copiedId === log.id ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Expanded JSON payload/details */}
                  {log.details && isDetailsOpen && (
                    <div className="mt-2 p-2.5 rounded bg-zinc-900 border border-zinc-800 text-[11px] text-emerald-400 font-mono overflow-x-auto whitespace-pre-wrap">
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

        {/* Floating Auto-scroll resume button when user scrolled away */}
        {!autoScroll && (
          <button
            type="button"
            onClick={() => {
              setAutoScroll(true);
              if (logsEndRef.current) {
                logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
              }
            }}
            className="absolute bottom-3 right-4 px-3 py-1.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg flex items-center gap-1.5 transition animate-bounce cursor-pointer"
          >
            <ArrowDown className="w-3.5 h-3.5" />
            <span>Rolar até o final (Tempo Real)</span>
          </button>
        )}
      </div>
    </div>
  );
};
