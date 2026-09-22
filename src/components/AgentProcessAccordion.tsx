import React, { useState, useMemo } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Terminal,
  FileEdit,
  FilePlus,
  BookOpen,
  Globe,
  Bot,
  Brain,
  ShieldCheck,
  Wrench,
  AlertCircle,
  XCircle,
  CheckCircle2,
  Loader2,
  Clock,
  Hash,
  Copy,
  Check,
  X,
  Maximize2,
} from 'lucide-react';
import { ToolCallStep, NormalizedActivity, ActivityType } from '../types';
import { normalizeActivities } from '../utils/activityTraceUtils';

interface AgentProcessAccordionProps {
  toolCalls?: ToolCallStep[];
  activities?: NormalizedActivity[];
  rawEvents?: any[];
  isStreaming?: boolean;
  agentName?: string;
  model?: string;
  error?: string;
}

export const AgentProcessAccordion: React.FC<AgentProcessAccordionProps> = ({
  toolCalls = [],
  activities: directActivities,
  rawEvents = [],
  isStreaming = false,
  agentName,
  model,
  error,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<NormalizedActivity | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Normalização estrita de eventos: raw events -> normalized activities -> presentation
  const activities: NormalizedActivity[] = useMemo(() => {
    if (directActivities && directActivities.length > 0) {
      return directActivities;
    }
    return normalizeActivities({
      rawEvents,
      toolCalls,
      isStreaming,
      agentName,
      model,
      error,
    });
  }, [directActivities, rawEvents, toolCalls, isStreaming, agentName, model, error]);

  if (!activities || activities.length === 0) return null;

  // Atividade real atualmente em execução (Camada 1)
  const activeRunningActivity = activities.find((a) => a.status === 'running');
  const hasErrors = activities.some((a) => a.status === 'failed');
  const hasCancelled = activities.some((a) => a.status === 'cancelled');

  const handleCopy = (text: string, fieldId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 1800);
  };

  const getActivityIcon = (type: ActivityType, sizeClass = 'w-3.5 h-3.5') => {
    switch (type) {
      case 'thinking':
        return <Brain className={`${sizeClass} text-purple-400 shrink-0`} />;
      case 'web_search':
        return <Globe className={`${sizeClass} text-cyan-400 shrink-0`} />;
      case 'command':
        return <Terminal className={`${sizeClass} text-emerald-400 shrink-0`} />;
      case 'file_read':
        return <BookOpen className={`${sizeClass} text-amber-400 shrink-0`} />;
      case 'file_edit':
        return <FileEdit className={`${sizeClass} text-blue-400 shrink-0`} />;
      case 'file_create':
        return <FilePlus className={`${sizeClass} text-indigo-400 shrink-0`} />;
      case 'invoke_agent':
        return <Bot className={`${sizeClass} text-violet-400 shrink-0`} />;
      case 'validation':
        return <ShieldCheck className={`${sizeClass} text-teal-400 shrink-0`} />;
      case 'error':
        return <AlertCircle className={`${sizeClass} text-rose-400 shrink-0`} />;
      case 'cancelled':
        return <XCircle className={`${sizeClass} text-zinc-400 shrink-0`} />;
      case 'completed':
        return <CheckCircle2 className={`${sizeClass} text-emerald-400 shrink-0`} />;
      default:
        return <Wrench className={`${sizeClass} text-zinc-400 shrink-0`} />;
    }
  };

  const formatDuration = (ms?: number) => {
    if (ms === undefined || ms === null) return null;
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="my-1.5 select-text font-sans">
      {/* =========================================================================
          CAMADA 1 (Recolhida): Mostrar somente a ação REAL em execução no momento
          Se nenhuma em execução, mostra resumo de ações concluídas
         ========================================================================= */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
        className={`flex items-center justify-between gap-2 text-[11px] py-1 px-2 rounded-md border transition-all cursor-pointer group ${
          activeRunningActivity
            ? 'bg-amber-950/20 border-amber-500/30 text-amber-200 hover:bg-amber-900/30'
            : hasErrors
            ? 'bg-rose-950/20 border-rose-500/30 text-rose-200 hover:bg-rose-900/30'
            : 'bg-zinc-900/60 border-zinc-800 text-zinc-300 hover:bg-zinc-800/60'
        }`}
        title={isExpanded ? 'Recolher Activity Trace' : 'Expandir Activity Trace (linha do tempo)'}
      >
        <div className="flex items-center gap-2 min-w-0">
          {isExpanded ? (
            <ChevronDown className="w-3 h-3 text-zinc-400 group-hover:text-zinc-200 shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-zinc-400 group-hover:text-zinc-200 shrink-0" />
          )}

          {activeRunningActivity ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400 shrink-0" />
          ) : hasErrors ? (
            <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          ) : hasCancelled ? (
            <XCircle className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          )}

          {/* CAMADA 1: Ação real no momento */}
          <span className="font-mono text-[11px] font-medium truncate">
            {activeRunningActivity ? (
              <span className="text-amber-300 flex items-center gap-1.5">
                {getActivityIcon(activeRunningActivity.type, 'w-3 h-3')}
                <span>{activeRunningActivity.title}</span>
              </span>
            ) : activities.length === 1 ? (
              activities[0].title
            ) : (
              `${activities.length} ações executadas`
            )}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {activities.length > 1 && (
            <span className="text-[10px] text-zinc-500 font-mono">
              ({activities.length} passos)
            </span>
          )}
          <span className="text-[9.5px] font-mono text-zinc-400 group-hover:text-zinc-200 bg-zinc-800/70 px-1.5 py-0.5 rounded border border-zinc-700/50">
            {isExpanded ? 'Recolher' : 'Timeline'}
          </span>
        </div>
      </div>

      {/* =========================================================================
          CAMADA 2 (Expandida): Timeline cronológica contínua das ações REAIS
         ========================================================================= */}
      {isExpanded && (
        <div className="mt-2 ml-1 pl-3.5 border-l-2 border-zinc-800/80 space-y-2 py-1">
          {activities.map((act, index) => {
            const isRunning = act.status === 'running';
            const isFailed = act.status === 'failed';
            const isCancelled = act.status === 'cancelled';
            const durationStr = formatDuration(act.durationMs);

            return (
              <div
                key={act.id || index}
                onClick={() => setSelectedActivity(act)}
                className={`relative flex items-start justify-between gap-3 p-2 rounded-md border transition-all cursor-pointer group/step ${
                  isRunning
                    ? 'bg-amber-950/25 border-amber-500/40 shadow-xs shadow-amber-950/40'
                    : isFailed
                    ? 'bg-rose-950/20 border-rose-500/30 hover:bg-rose-900/30'
                    : 'bg-zinc-900/40 border-zinc-800/80 hover:bg-zinc-800/50 hover:border-zinc-700'
                }`}
                title="Clique para inspecionar os dados reais deste evento (Camada 3)"
              >
                {/* Marcador cronológico alinhado ao track */}
                <div
                  className={`absolute -left-[19.5px] top-3 w-2.5 h-2.5 rounded-full border-2 ${
                    isRunning
                      ? 'bg-amber-400 border-zinc-950 animate-ping'
                      : isFailed
                      ? 'bg-rose-500 border-zinc-950'
                      : isCancelled
                      ? 'bg-zinc-500 border-zinc-950'
                      : 'bg-emerald-500 border-zinc-950'
                  }`}
                />

                {/* Conteúdo do passo */}
                <div className="flex items-start gap-2 min-w-0 flex-1">
                  <div className="mt-0.5 shrink-0">
                    {getActivityIcon(act.type, 'w-4 h-4')}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-medium text-[11.5px] text-zinc-100 group-hover/step:text-white leading-snug break-words">
                        {act.title}
                      </span>
                    </div>

                    {/* Metadados resumidos estruturados reais */}
                    <div className="flex items-center gap-2.5 mt-1 text-[10px] font-mono text-zinc-400 flex-wrap">
                      {act.toolName && (
                        <span className="text-zinc-400 bg-zinc-950 px-1 py-0.5 rounded border border-zinc-800">
                          {act.toolName}
                        </span>
                      )}

                      {act.filePath && (
                        <span className="text-cyan-400 bg-cyan-950/40 px-1 py-0.5 rounded border border-cyan-800/40 truncate max-w-xs">
                          {act.filePath}
                        </span>
                      )}

                      {act.targetAgent && (
                        <span className="text-violet-400 bg-violet-950/40 px-1 py-0.5 rounded border border-violet-800/40">
                          Agente: {act.targetAgent}
                        </span>
                      )}

                      {durationStr && (
                        <span className="flex items-center gap-1 text-zinc-400">
                          <Clock className="w-2.5 h-2.5" />
                          {durationStr}
                        </span>
                      )}

                      {act.toolCallId && (
                        <span className="text-zinc-400 text-[9px]">
                          ID: {act.toolCallId.slice(0, 14)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Status e Ação de Inspeção */}
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-semibold font-mono tracking-wider ${
                      isRunning
                        ? 'text-amber-300 bg-amber-500/20 animate-pulse border border-amber-500/30'
                        : isFailed
                        ? 'text-rose-400 bg-rose-500/20 border border-rose-500/30'
                        : isCancelled
                        ? 'text-zinc-400 bg-zinc-800 border border-zinc-700'
                        : 'text-emerald-400 bg-emerald-500/15 border border-emerald-500/30'
                    }`}
                  >
                    {act.status}
                  </span>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedActivity(act);
                    }}
                    className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50 transition cursor-pointer"
                    title="Inspecionar dados brutos deste evento"
                  >
                    <Maximize2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* =========================================================================
          CAMADA 3 (Inspector de Detalhes Reais do Evento):
          Abre somente os dados REAIS daquele evento: arquivo, comando, ferramenta,
          argumentos, resultado, duração, timestamp, agente, modelo, IDs e metadados.
         ========================================================================= */}
      {selectedActivity && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setSelectedActivity(null)}
        >
          <div
            className="bg-zinc-950 border border-zinc-800 rounded-xl max-w-3xl w-full max-h-[88vh] flex flex-col shadow-2xl overflow-hidden font-sans text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cabeçalho do Modal */}
            <div className="p-3.5 border-b border-zinc-800 flex items-center justify-between gap-3 bg-zinc-900/60">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-1.5 rounded-lg bg-zinc-800/80 border border-zinc-700/60">
                  {getActivityIcon(selectedActivity.type, 'w-4 h-4')}
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-zinc-100 text-[13px] truncate">
                    {selectedActivity.title}
                  </h3>
                  <p className="text-[10.5px] text-zinc-400 font-mono">
                    Tipo: <span className="text-zinc-300 font-medium">{selectedActivity.type}</span>
                    {selectedActivity.toolName && ` • Ferramenta: ${selectedActivity.toolName}`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold uppercase tracking-wider ${
                    selectedActivity.status === 'completed'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : selectedActivity.status === 'running'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse'
                      : selectedActivity.status === 'failed'
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                  }`}
                >
                  {selectedActivity.status}
                </span>

                <button
                  type="button"
                  onClick={() => setSelectedActivity(null)}
                  className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition cursor-pointer"
                  title="Fechar (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Conteúdo: Dados REAIS do Evento */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 font-sans text-zinc-300">
              {/* Metadados Reais em Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
                <div className="p-2.5 rounded-lg bg-zinc-900/70 border border-zinc-800/80">
                  <span className="text-zinc-500 text-[9.5px] block font-sans uppercase">Identificador</span>
                  <div className="flex items-center justify-between gap-1 mt-0.5">
                    <span className="text-zinc-200 truncate font-medium">
                      {selectedActivity.toolCallId || selectedActivity.id || 'N/A'}
                    </span>
                    {(selectedActivity.toolCallId || selectedActivity.id) && (
                      <button
                        type="button"
                        onClick={(e) =>
                          handleCopy(selectedActivity.toolCallId || selectedActivity.id, 'id', e)
                        }
                        className="text-zinc-500 hover:text-zinc-200 p-0.5"
                        title="Copiar ID"
                      >
                        {copiedField === 'id' ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    )}
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-zinc-900/70 border border-zinc-800/80">
                  <span className="text-zinc-500 text-[9.5px] block font-sans uppercase">Duração Real</span>
                  <span className="text-emerald-400 mt-0.5 block font-medium">
                    {formatDuration(selectedActivity.durationMs) ||
                      (selectedActivity.status === 'running' ? 'Em andamento...' : 'Instantâneo')}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-zinc-900/70 border border-zinc-800/80">
                  <span className="text-zinc-500 text-[9.5px] block font-sans uppercase">Timestamp</span>
                  <span className="text-zinc-300 mt-0.5 block truncate">
                    {selectedActivity.timestamp
                      ? new Date(selectedActivity.timestamp).toLocaleTimeString()
                      : 'N/A'}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-zinc-900/70 border border-zinc-800/80">
                  <span className="text-zinc-500 text-[9.5px] block font-sans uppercase">Agente / Modelo</span>
                  <span className="text-zinc-300 mt-0.5 block truncate">
                    {selectedActivity.agentName || selectedActivity.model || 'Gemini CLI'}
                  </span>
                </div>
              </div>

              {/* Informações Específicas do Tipo Real */}
              {selectedActivity.filePath && (
                <div className="p-3 rounded-lg bg-zinc-900/50 border border-zinc-800">
                  <span className="text-[10px] text-zinc-500 font-mono uppercase block mb-1">
                    Arquivo Alvo Real
                  </span>
                  <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-cyan-300 bg-zinc-950 p-2 rounded border border-zinc-850">
                    <span className="break-all">{selectedActivity.filePath}</span>
                    <button
                      type="button"
                      onClick={(e) => handleCopy(selectedActivity.filePath!, 'file', e)}
                      className="text-zinc-500 hover:text-zinc-200 p-1 shrink-0"
                      title="Copiar caminho"
                    >
                      {copiedField === 'file' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {selectedActivity.command && (
                <div className="p-3 rounded-lg bg-zinc-900/50 border border-zinc-800">
                  <span className="text-[10px] text-zinc-500 font-mono uppercase block mb-1">
                    Comando Shell Real
                  </span>
                  <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-emerald-300 bg-zinc-950 p-2 rounded border border-zinc-850">
                    <span className="break-all">{selectedActivity.command}</span>
                    <button
                      type="button"
                      onClick={(e) => handleCopy(selectedActivity.command!, 'cmd', e)}
                      className="text-zinc-500 hover:text-zinc-200 p-1 shrink-0"
                      title="Copiar comando"
                    >
                      {copiedField === 'cmd' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {selectedActivity.searchQuery && (
                <div className="p-3 rounded-lg bg-zinc-900/50 border border-zinc-800">
                  <span className="text-[10px] text-zinc-500 font-mono uppercase block mb-1">
                    Consulta de Busca Web (Exa)
                  </span>
                  <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-cyan-200 bg-zinc-950 p-2 rounded border border-zinc-850">
                    <span className="break-all">{selectedActivity.searchQuery}</span>
                    <button
                      type="button"
                      onClick={(e) => handleCopy(selectedActivity.searchQuery!, 'query', e)}
                      className="text-zinc-500 hover:text-zinc-200 p-1 shrink-0"
                      title="Copiar query"
                    >
                      {copiedField === 'query' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {selectedActivity.targetAgent && (
                <div className="p-3 rounded-lg bg-zinc-900/50 border border-zinc-800">
                  <span className="text-[10px] text-zinc-500 font-mono uppercase block mb-1">
                    Subagente Delegado (invoke_agent)
                  </span>
                  <div className="font-mono text-[11px] text-violet-300 bg-zinc-950 p-2 rounded border border-zinc-850">
                    Agente de Destino: <span className="font-bold">{selectedActivity.targetAgent}</span>
                  </div>
                </div>
              )}

              {/* Argumentos / Parâmetros Brutos Reais */}
              {selectedActivity.arguments && Object.keys(selectedActivity.arguments).length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-mono text-zinc-400 uppercase text-[10px]">
                      Argumentos Reais da Invocação
                    </span>
                    <button
                      type="button"
                      onClick={(e) =>
                        handleCopy(
                          JSON.stringify(selectedActivity.arguments, null, 2),
                          'args',
                          e
                        )
                      }
                      className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200 font-mono cursor-pointer"
                    >
                      {copiedField === 'args' ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>Copiar JSON</span>
                    </button>
                  </div>
                  <pre className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-300 font-mono text-[10.5px] overflow-x-auto max-h-52 whitespace-pre-wrap break-all">
                    {JSON.stringify(selectedActivity.arguments, null, 2)}
                  </pre>
                </div>
              )}

              {/* Resultado / Saída Real do Evento */}
              {selectedActivity.result && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-mono text-zinc-400 uppercase text-[10px]">
                      Resultado / Saída Real da Execução
                    </span>
                    <button
                      type="button"
                      onClick={(e) => handleCopy(selectedActivity.result!, 'res', e)}
                      className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200 font-mono cursor-pointer"
                    >
                      {copiedField === 'res' ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>Copiar Saída</span>
                    </button>
                  </div>
                  <pre className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-200 font-mono text-[10.5px] overflow-x-auto max-h-60 whitespace-pre-wrap break-all leading-relaxed">
                    {selectedActivity.result}
                  </pre>
                </div>
              )}

              {/* Erro Real do Evento (se houver) */}
              {selectedActivity.error && (
                <div className="space-y-1.5">
                  <span className="font-mono text-rose-400 uppercase text-[10px]">
                    Erro Reportado pelo Runtime
                  </span>
                  <pre className="p-3 rounded-lg bg-rose-950/30 border border-rose-500/40 text-rose-200 font-mono text-[10.5px] overflow-x-auto max-h-40 whitespace-pre-wrap break-all">
                    {selectedActivity.error}
                  </pre>
                </div>
              )}

              {/* Metadados Adicionais Reais (se houver) */}
              {selectedActivity.metadata && Object.keys(selectedActivity.metadata).length > 0 && (
                <div className="space-y-1 text-[10px] font-mono text-zinc-400 pt-2 border-t border-zinc-850">
                  <span className="text-zinc-500 uppercase block mb-1">Metadados de Execução</span>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(selectedActivity.metadata).map(([key, val]) => (
                      <div key={key} className="p-1.5 rounded bg-zinc-900/60 border border-zinc-800/60">
                        <span className="text-zinc-500 block">{key}:</span>
                        <span className="text-zinc-300 font-mono break-all">
                          {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Rodapé do Modal */}
            <div className="p-3 border-t border-zinc-800 bg-zinc-900/40 flex items-center justify-between text-zinc-400 text-[10.5px] font-mono">
              <span>Camada 3 • Dados Reais do Runtime</span>
              <button
                type="button"
                onClick={() => setSelectedActivity(null)}
                className="px-3 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition font-sans text-xs cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
