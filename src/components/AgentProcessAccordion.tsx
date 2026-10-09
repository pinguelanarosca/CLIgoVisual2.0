import React, { useState, useMemo } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Terminal,
  Clock,
  Copy,
  Check,
  AlertTriangle,
  Code2,
} from 'lucide-react';
import { ToolCallStep, NormalizedActivity, ActivityType } from '../types.js';
import { normalizeActivities } from '../utils/activityTraceUtils.js';

interface AgentProcessAccordionProps {
  toolCalls?: ToolCallStep[];
  activities?: NormalizedActivity[];
  rawEvents?: any[];
  isStreaming?: boolean;
  agentName?: string;
  model?: string;
  error?: string;
  durationMs?: number;
}

export const AgentProcessAccordion: React.FC<AgentProcessAccordionProps> = ({
  toolCalls = [],
  activities: directActivities,
  rawEvents = [],
  isStreaming = false,
  agentName,
  model,
  error,
  durationMs,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedActivityIds, setExpandedActivityIds] = useState<Record<string, boolean>>({});
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Normalização estrita de atividades reais
  const activities: NormalizedActivity[] = useMemo(() => {
    if (directActivities && directActivities.length > 0) {
      return directActivities.filter(activity => activity.type !== 'runtime_event' || activity.metadata?.event === 'EXECUTION_BLOCKED');
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

  // Identificação da ação ativa e estados do fluxo
  const activeRunningActivity = activities.find((a) => a.status === 'running');
  const hasErrors = activities.some((a) => a.status === 'failed');
  const lastActivity = activities[activities.length - 1];

  const toggleSubActivity = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedActivityIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleCopy = (text: string, fieldId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 1800);
  };

  const formatDuration = (ms?: number) => {
    if (ms === undefined || ms === null) return null;
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  // Ícone discreto terminal chevron (>_) para cada ação
  const renderTerminalChevronIcon = (status: 'running' | 'completed' | 'failed' | 'cancelled') => {
    let colorClass = 'text-blue-400'; // Padrão concluído: Azul
    if (status === 'running') {
      colorClass = 'text-amber-400 animate-pulse'; // Executando: Amarelo
    } else if (status === 'failed') {
      colorClass = 'text-rose-400'; // Falhou: Vermelho
    } else if (status === 'cancelled') {
      colorClass = 'text-zinc-500';
    }

    return (
      <span className={`font-mono font-bold text-[11px] shrink-0 flex items-center ${colorClass}`}>
        &gt;_
      </span>
    );
  };

  // Texto da barra principal (Camada 1)
  const mainBarStatus = activeRunningActivity ? 'running' : hasErrors ? 'failed' : 'completed';
  const toolCount = activities.filter(activity => activity.toolCallId && activity.type !== 'invoke_agent').length;
  const agentCount = activities.filter(activity => activity.type === 'invoke_agent').length;
  const elapsed = durationMs === undefined ? '' : ` em ${(durationMs / 1000).toFixed(1).replace('.', ',')}s`;
  const mainBarText = `${isStreaming ? 'Executando' : error?.startsWith('Execução parcial:') ? 'Execução parcial' : error || hasErrors ? 'Encerrado com erro' : 'Concluído'}${elapsed} · ${toolCount} ferramentas · ${agentCount} subagentes`;


  return (
    <div className="my-1 select-text font-sans w-full">
      {/* =========================================================================
          CAMADA 1 (Fechada): Barra simples e transparente com o status da ação atual
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
        className={`flex items-center justify-between gap-2 text-[11px] py-1 px-2 rounded-md transition-all cursor-pointer group backdrop-blur-xs border ${
          mainBarStatus === 'running'
            ? 'bg-amber-950/20 border-amber-500/30 hover:bg-amber-900/30'
            : mainBarStatus === 'failed'
            ? 'bg-rose-950/20 border-rose-500/30 hover:bg-rose-900/30'
            : 'bg-zinc-900/40 border-zinc-800/60 hover:bg-zinc-800/40 text-zinc-300'
        }`}
        title={isExpanded ? 'Recolher detalhes de execução' : 'Clique para ver a lista de execuções'}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-200 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-200 shrink-0" />
          )}

          {renderTerminalChevronIcon(mainBarStatus)}

          <span className="font-mono text-[11px] font-medium text-zinc-200 truncate">
            {mainBarText}
          </span>
        </div>
      </div>

      {/* =========================================================================
          CAMADA 2 (Expandida): Lista limpa de execuções sem caixas ou botões gigantes
         ========================================================================= */}
      {isExpanded && (
        <div className="mt-1 ml-1 pl-2.5 border-l border-zinc-800/80 space-y-1 py-1">
          {activities.map((act, index) => {
            const actId = act.id || `act_${index}`;
            const isSubExpanded = !!expandedActivityIds[actId];
            const durationStr = formatDuration(act.durationMs);

            return (
              <div key={actId} className="flex flex-col">
                {/* Linha simples da ação: Clicar desdobra a sub-aba direta */}
                <div
                  onClick={(e) => toggleSubActivity(actId, e)}
                  className={`flex items-center justify-between gap-2 p-1.5 rounded-md transition-all cursor-pointer group/step hover:bg-zinc-800/50 ${
                    act.status === 'running'
                      ? 'text-amber-300 font-semibold'
                      : act.status === 'failed'
                      ? 'text-rose-300 font-semibold'
                      : 'text-zinc-300'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {renderTerminalChevronIcon(act.status)}
                    <span className="font-mono text-[11px] leading-snug break-words flex-1">
                      {act.title}
                    </span>
                  </div>

                  {/* Indicador sutil de expansão */}
                  <ChevronDown
                    className={`w-3 h-3 text-zinc-500 group-hover/step:text-zinc-300 transition-transform duration-150 shrink-0 ${
                      isSubExpanded ? 'rotate-180 text-blue-400' : ''
                    }`}
                  />
                </div>

                {/* =========================================================================
                    CAMADA 3 (Sub-aba desdobrada diretamente abaixo da ação, sem modal)
                   ========================================================================= */}
                {isSubExpanded && (
                  <div className="mt-1 mb-1.5 ml-3 p-2.5 rounded-md bg-zinc-950/80 border border-zinc-800/80 text-[10.5px] font-mono space-y-2 text-zinc-300 shadow-inner animate-fade-in">
                    {/* Metadados Reais da Ação */}
                    <div className="flex flex-wrap items-center gap-3 text-[10px] text-zinc-400 pb-1.5 border-b border-zinc-850">
                      {durationStr && (
                        <span className="flex items-center gap-1 text-emerald-400">
                          <Clock className="w-2.5 h-2.5" />
                          <span>Duração: {durationStr}</span>
                        </span>
                      )}

                      {act.timestamp && (
                        <span className="text-zinc-400">
                          Hora: {new Date(act.timestamp).toLocaleTimeString()}
                        </span>
                      )}

                      {(act.agentName || act.model) && (
                        <span className="text-blue-400">
                          Agente/Modelo: {act.agentName || 'Agente'} ({act.model || 'Gemini'})
                        </span>
                      )}
                    </div>

                    {/* Arquivo Alvo / Comando Real */}
                    {act.filePath && (
                      <div className="space-y-0.5">
                        <span className="text-[9.5px] text-zinc-500 uppercase block font-sans">
                          Arquivo Alvo
                        </span>
                        <div className="flex items-center justify-between gap-1 text-cyan-300 bg-zinc-900/90 p-1.5 rounded border border-zinc-800 break-all">
                          <span>{act.filePath}</span>
                          <button
                            type="button"
                            onClick={(e) => handleCopy(act.filePath!, 'file', e)}
                            className="p-1 text-zinc-500 hover:text-zinc-200 shrink-0 cursor-pointer"
                            title="Copiar caminho"
                          >
                            {copiedField === 'file' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                      </div>
                    )}

                    {act.command && (
                      <div className="space-y-0.5">
                        <span className="text-[9.5px] text-zinc-500 uppercase block font-sans">
                          Comando Executado
                        </span>
                        <div className="flex items-center justify-between gap-1 text-emerald-300 bg-zinc-900/90 p-1.5 rounded border border-zinc-800 break-all">
                          <span>{act.command}</span>
                          <button
                            type="button"
                            onClick={(e) => handleCopy(act.command!, 'cmd', e)}
                            className="p-1 text-zinc-500 hover:text-zinc-200 shrink-0 cursor-pointer"
                            title="Copiar comando"
                          >
                            {copiedField === 'cmd' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Argumentos Reais da Invocação (Entrada) */}
                    {act.arguments && Object.keys(act.arguments).length > 0 && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[9.5px] text-zinc-500 uppercase font-sans">
                            Argumentos da Invocação
                          </span>
                          <button
                            type="button"
                            onClick={(e) => handleCopy(JSON.stringify(act.arguments, null, 2), 'args', e)}
                            className="text-[9.5px] text-zinc-400 hover:text-zinc-200 cursor-pointer flex items-center gap-1"
                          >
                            {copiedField === 'args' ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
                            <span>Copiar JSON</span>
                          </button>
                        </div>
                        <pre className="p-2 rounded bg-zinc-900/90 border border-zinc-800 text-zinc-300 text-[10px] overflow-x-auto max-h-40 whitespace-pre-wrap break-all">
                          {JSON.stringify(act.arguments, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* Resultado / Saída Real da Execução */}
                    {act.result && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[9.5px] text-zinc-500 uppercase font-sans">
                            Resultado / Saída Real da Execução
                          </span>
                          <button
                            type="button"
                            onClick={(e) => handleCopy(act.result!, 'res', e)}
                            className="text-[9.5px] text-zinc-400 hover:text-zinc-200 cursor-pointer flex items-center gap-1"
                          >
                            {copiedField === 'res' ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
                            <span>Copiar Saída</span>
                          </button>
                        </div>
                        <pre className="p-2 rounded bg-zinc-900/90 border border-zinc-800 text-zinc-200 text-[10px] overflow-x-auto max-h-52 whitespace-pre-wrap break-all leading-relaxed">
                          {act.status === 'failed' && act.type !== 'runtime_event' ? 'Atividade encerrada. Consulte Logs/Payload.' : act.result}
                        </pre>
                      </div>
                    )}

                    {/* Erro Reportado pelo Runtime */}
                    {act.error && (
                      <div className="space-y-1">
                        <span className="text-[9.5px] text-rose-400 uppercase font-sans font-bold flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-rose-400" />
                          <span>Erro Reportado pelo Runtime</span>
                        </span>
                        <pre className="p-2 rounded bg-rose-950/30 border border-rose-500/40 text-rose-200 text-[10px] overflow-x-auto max-h-36 whitespace-pre-wrap break-all">
                          Falha na atividade. Consulte Logs/Payload.
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
