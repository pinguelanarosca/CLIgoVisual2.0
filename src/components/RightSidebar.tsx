import React, { useState } from 'react';
import {
  X,
  Copy,
  Check,
  Code2,
  Terminal,
  Activity,
  Sliders,
  ShieldCheck,
  FileText,
  Briefcase,
  Settings,
  Zap,
  Target,
  Wrench,
  ChevronDown,
  ChevronRight,
  Eye,
  Layers,
} from 'lucide-react';
import { ChatMessage, AgentConfig, ProjectItem, AuthorizedDir, SkillConfig, McpConfig } from '../types.js';
import { getRawInspectionData, RawInspectionData } from '../utils/rawPayloadUtils.js';
import { estimateTokens } from '../utils/tokenUtils.js';

interface RightSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  message: ChatMessage | null;
  agent?: AgentConfig;
  project?: ProjectItem | null;
  authorizedDirs?: AuthorizedDir[];
  skills?: SkillConfig[];
  mcpServers?: McpConfig[];
  approvalMode?: string;
  onOpenSettings?: (tab?: string) => void;
}

const formatSseText = (
  data: RawInspectionData,
  resolvedModel: string,
  message: ChatMessage,
  estimatedTotalTokens: number
): string => {
  if (data.output.rawEvents && data.output.rawEvents.length > 0) {
    return data.output.rawEvents
      .map((ev, i) => {
        const eventName = ev.type || 'message';
        const payloadObj: Record<string, any> = { ...ev };
        delete payloadObj.type;
        return `event: ${eventName}\ndata: ${JSON.stringify(payloadObj, null, 2)}`;
      })
      .join('\n\n');
  }

  const sysText = data.finalApiRequest
    ? (typeof data.finalApiRequest.systemInstruction === 'string'
        ? data.finalApiRequest.systemInstruction
        : data.finalApiRequest.systemInstruction?.parts?.[0]?.text || '')
    : (data.input?.systemInstructions || '');

  const chunks = [
    `event: session_start\ndata: ${JSON.stringify({
      model: resolvedModel,
      agent: data.input.agentName || 'principal',
      workDir: data.input.workDir,
      approvalMode: data.input.approvalMode,
      timestamp: message.timestamp,
    }, null, 2)}`,
    `event: prompt_inject\ndata: ${JSON.stringify({
      systemTokens: estimateTokens(sysText),
      promptTokens: estimateTokens(data.input.promptText || message.content),
    }, null, 2)}`,
  ];

  if (message.toolCalls && message.toolCalls.length > 0) {
    message.toolCalls.forEach((tc) => {
      chunks.push(`event: tool_call\ndata: ${JSON.stringify({
        toolName: tc.toolName,
        status: tc.status,
        parameters: tc.parameters,
      }, null, 2)}`);
      if (tc.result || tc.error) {
        chunks.push(`event: tool_result\ndata: ${JSON.stringify({
          toolName: tc.toolName,
          result: tc.result || tc.error,
        }, null, 2)}`);
      }
    });
  }

  chunks.push(`event: content_delta\ndata: ${JSON.stringify({
    role: 'assistant',
    text: message.content,
  }, null, 2)}`);

  chunks.push(`event: finish\ndata: ${JSON.stringify({
    status: data.output.status || 'completed',
    tokenStats: data.output.tokenStats || { totalTokens: estimatedTotalTokens },
    completedAt: data.output.completedAt || message.timestamp,
  }, null, 2)}`);

  return chunks.join('\n\n');
};

export const RightSidebar: React.FC<RightSidebarProps> = ({
  isOpen,
  onClose,
  message,
  agent,
  project,
  authorizedDirs = [],
  skills = [],
  mcpServers = [],
  approvalMode = 'default',
  onOpenSettings,
}) => {
  // Accordion state: all sections start collapsed as requested
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  if (!isOpen || !message) return null;

  const toggleSection = (sec: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sec)) {
        next.delete(sec);
      } else {
        next.add(sec);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedSections(new Set(['finalApi', 'params', 'output', 'sse', 'rawJson']));
  };

  const collapseAll = () => {
    setExpandedSections(new Set());
  };

  const data: RawInspectionData = getRawInspectionData(
    message,
    agent,
    project,
    authorizedDirs,
    skills,
    mcpServers,
    approvalMode
  );

  const fullJsonStructure = {
    messageId: message.id,
    role: message.role,
    timestamp: message.timestamp,
    finalApiRequest: data.finalApiRequest,
    isRealCapturedRequest: data.isRealCapturedRequest,
    allRealRequests: data.allRealRequests,
    parameterOrigins: data.parameterOrigins,
    cliInvocation: data.input,
    output: data.output,
  };

  const [selectedRequestIndex, setSelectedRequestIndex] = useState<number>(0);

  const realRequestsList = data.allRealRequests && data.allRealRequests.length > 0
    ? data.allRealRequests
    : data.finalApiRequest
    ? [{ finalApiRequest: data.finalApiRequest, callIndex: 1, timestamp: message.timestamp, model: data.finalApiRequest.model, role: 'assistant' }]
    : [];

  const activeRequestObj = realRequestsList[selectedRequestIndex]?.finalApiRequest || data.finalApiRequest;
  const isRealCaptured = data.isRealCapturedRequest || realRequestsList.length > 0;

  const handleCopy = (text: string, section: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopiedSection(section);
      setTimeout(() => setCopiedSection(null), 1800);
    });
  };

  // Calculate estimated total tokens
  const sysText = activeRequestObj
    ? (typeof activeRequestObj.systemInstruction === 'string'
        ? activeRequestObj.systemInstruction
        : activeRequestObj.systemInstruction?.parts?.[0]?.text || '')
    : (data.input?.systemInstructions || '');

  const promptText = data.input.promptText || message.content || '';
  const estimatedTotalTokens =
    data.output.tokenStats?.totalTokens ||
    (estimateTokens(sysText) + estimateTokens(promptText) + 120);

  const sseEventsCount = data.output.rawEvents?.length || 3;
  const toolCallsList = data.output.toolCalls || message.toolCalls || [];
  const toolDeclarations = activeRequestObj?.tools?.[0]?.functionDeclarations || [];

  const resolvedModel = activeRequestObj?.model || agent?.model || 'models/gemini-2.5-flash';
  const genConfig = activeRequestObj?.generationConfig || {};
  const tempVal = genConfig.temperature !== undefined ? genConfig.temperature : '0.2';
  const topPVal = genConfig.topP !== undefined ? genConfig.topP : '0.95';
  const topKVal = genConfig.topK !== undefined ? genConfig.topK : '40';
  const maxTokensVal = genConfig.maxOutputTokens !== undefined ? genConfig.maxOutputTokens : 'Janela Total';
  const thinkingVal =
    agent?.thinking || genConfig.thinkingConfig
      ? (genConfig.thinkingConfig?.thinkingLevel ? `${genConfig.thinkingConfig.thinkingLevel.toUpperCase()} (Ativo)` : 'High (Profundo)')
      : 'Desativado';

  const allExpanded = expandedSections.size === 5;

  return (
    <div className="h-full w-full flex flex-col bg-[#0c0c0e]/98 text-zinc-100 select-text overflow-hidden">
      {/* Top Header — Amber Identity with collapse, token badge and Copy JSON */}
      <div className="h-10 px-2.5 border-b border-amber-500/20 flex items-center justify-between shrink-0 bg-zinc-950/90 gap-1.5 overflow-hidden">
        <div className="flex items-center gap-1.5 min-w-0">
          <Eye className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-[11px] font-mono font-bold uppercase tracking-tight text-amber-400 truncate">
            PAYLOAD BRUTO
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <span className="px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 font-mono text-[9.5px] font-semibold">
            {estimatedTotalTokens} tok.
          </span>

          <button
            onClick={allExpanded ? collapseAll : expandAll}
            className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
            title={allExpanded ? 'Recolher todas as abas' : 'Expandir todas as abas'}
          >
            {allExpanded ? 'Recolher' : 'Expandir'}
          </button>

          <button
            onClick={(e) => handleCopy(JSON.stringify(fullJsonStructure, null, 2), 'all', e)}
            className="p-1 sm:px-2 sm:py-0.5 rounded bg-zinc-900 border border-zinc-700/80 hover:bg-zinc-800 text-zinc-200 transition cursor-pointer text-[10.5px] flex items-center gap-1 font-sans shrink-0"
            title="Copiar JSON completo do payload"
          >
            {copiedSection === 'all' ? (
              <Check className="w-3 h-3 text-emerald-400" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
            <span className="hidden sm:inline">JSON</span>
          </button>

          <button
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition cursor-pointer shrink-0"
            title="Fechar Painel (Esc)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Content Area: Vertical Collapsible Accordions (All start closed) */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 font-sans text-xs leading-snug">
        {/* ========================================================
            ACCORDION 1: Payload API Google (finalApiRequest)
           ======================================================== */}
        <div className="rounded-lg border border-amber-500/30 bg-zinc-950/70 overflow-hidden transition-all shadow-xs">
          {/* Header */}
          <div
            onClick={() => toggleSection('finalApi')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleSection('finalApi');
              }
            }}
            className={`w-full px-3 py-2 flex items-center justify-between text-left transition cursor-pointer select-none ${
              expandedSections.has('finalApi')
                ? 'bg-amber-500/15 border-b border-amber-500/30 text-amber-300'
                : 'hover:bg-zinc-900/80 text-zinc-200'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {expandedSections.has('finalApi') ? (
                <ChevronDown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              )}
              <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <Target className="w-3 h-3 text-amber-400 -ml-1.5 shrink-0" />
              <span className="font-semibold text-xs truncate">
                Payload API Google (finalApiRequest)
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={(e) =>
                  handleCopy(
                    JSON.stringify(activeRequestObj || data.finalApiRequest || {}, null, 2),
                    'finalApiReq',
                    e
                  )
                }
                className="p-1 text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
                title="Copiar finalApiRequest"
              >
                {copiedSection === 'finalApiReq' ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </div>
          </div>

          {/* Body */}
          {expandedSections.has('finalApi') && (
            <div className="p-2.5 space-y-2 bg-zinc-950/40">
              {!activeRequestObj ? (
                <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800 text-center space-y-2">
                  <div className="flex items-center justify-center gap-2 text-amber-400 font-medium text-xs">
                    <ShieldCheck className="w-4 h-4 text-amber-400" />
                    <span>Nenhum Final API Request capturado para esta mensagem</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 max-w-sm mx-auto leading-relaxed">
                    Esta mensagem foi gerada antes da captura de runtime ou é uma mensagem de sistema.
                    Envie uma nova mensagem no chat para inspecionar o payload real capturado no ponto de envio do Gemini CLI.
                  </p>
                </div>
              ) : (
                <>
                  {/* Emerald Banner Card */}
                  <div className="p-2 rounded bg-emerald-950/20 border border-emerald-500/25 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-emerald-400 font-semibold text-[11.5px]">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>Payload Efetivo Real Capturado do Gemini CLI</span>
                        {isRealCaptured && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                            Real CLI Capture
                          </span>
                        )}
                      </div>
                      <p className="text-[10.5px] text-zinc-400 mt-0.5 leading-snug">
                        Requisição real preparada pelo Gemini CLI imediatamente antes do envio ao modelo Gemini (sem reconstrução ou estimativa pela GUI).
                      </p>
                    </div>
                  </div>

                  {/* Multi-turn selector if more than 1 API request happened in this interaction */}
                  {realRequestsList.length > 1 && (
                    <div className="flex items-center gap-1.5 p-1.5 rounded bg-zinc-900/90 border border-zinc-800 text-[10.5px]">
                      <span className="text-zinc-400 font-mono text-[10px] pl-1 shrink-0">
                        Chamadas API do Turno ({realRequestsList.length}):
                      </span>
                      <div className="flex items-center gap-1 overflow-x-auto">
                        {realRequestsList.map((req, idx) => (
                          <button
                            key={idx}
                            onClick={() => setSelectedRequestIndex(idx)}
                            className={`px-2 py-0.5 rounded font-mono text-[10px] transition cursor-pointer shrink-0 ${
                              selectedRequestIndex === idx
                                ? 'bg-amber-500 text-zinc-950 font-bold'
                                : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                            }`}
                          >
                            Chamada #{idx + 1}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Row: Modelo Efetivo Resolvido */}
                  <div className="flex items-center justify-between gap-2 p-2 rounded bg-zinc-900/60 border border-zinc-800/80 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-zinc-400 font-mono text-[10.5px] shrink-0">Modelo Resolvido:</span>
                      <span className="font-mono font-bold text-emerald-400 text-[11.5px] truncate">
                        {resolvedModel}
                      </span>
                    </div>
                    <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-zinc-950 text-zinc-400 border border-zinc-800 shrink-0">
                      Agente: {data.input.agentName || 'principal'}
                    </span>
                  </div>

                  {/* Hiperparâmetros de Geração (generationConfig) — 5 Cards compactos */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-amber-400 font-semibold text-[11px]">
                      <Sliders className="w-3 h-3 text-amber-400" />
                      <span>Hiperparâmetros de Geração (generationConfig)</span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                      {/* 1. TEMPERATURE */}
                      <div className="p-1.5 rounded bg-zinc-900/80 border border-zinc-800/80 flex flex-col items-center justify-center text-center">
                        <span className="text-[9px] uppercase font-mono font-semibold text-zinc-400">
                          TEMPERATURE
                        </span>
                        <span className="text-xs font-mono font-bold text-amber-400 my-0.5">
                          {tempVal}
                        </span>
                        <span className="text-[8.5px] font-mono text-zinc-500">Resolvido</span>
                      </div>

                      {/* 2. TOPP */}
                      <div className="p-1.5 rounded bg-zinc-900/80 border border-zinc-800/80 flex flex-col items-center justify-center text-center">
                        <span className="text-[9px] uppercase font-mono font-semibold text-zinc-400">
                          TOPP
                        </span>
                        <span className="text-xs font-mono font-bold text-cyan-400 my-0.5">
                          {topPVal}
                        </span>
                        <span className="text-[8.5px] font-mono text-zinc-500">Resolvido</span>
                      </div>

                      {/* 3. TOPK */}
                      <div className="p-1.5 rounded bg-zinc-900/80 border border-zinc-800/80 flex flex-col items-center justify-center text-center">
                        <span className="text-[9px] uppercase font-mono font-semibold text-zinc-400">
                          TOPK
                        </span>
                        <span className="text-xs font-mono font-bold text-purple-400 my-0.5">
                          {topKVal}
                        </span>
                        <span className="text-[8.5px] font-mono text-zinc-500">Resolvido</span>
                      </div>

                      {/* 4. MAXOUTPUTTOKENS */}
                      <div className="p-1.5 rounded bg-zinc-900/80 border border-zinc-800/80 flex flex-col items-center justify-center text-center">
                        <span className="text-[9px] uppercase font-mono font-semibold text-zinc-400">
                          MAX TOKENS
                        </span>
                        <span className="text-xs font-mono font-bold text-blue-400 my-0.5 truncate w-full">
                          {maxTokensVal}
                        </span>
                        <span className="text-[8.5px] font-mono text-zinc-500">
                          {typeof maxTokensVal === 'number' ? 'Limite' : 'Total'}
                        </span>
                      </div>

                      {/* 5. THINKINGCONFIG */}
                      <div className="p-1.5 rounded bg-zinc-900/80 border border-zinc-800/80 flex flex-col items-center justify-center text-center">
                        <span className="text-[9px] uppercase font-mono font-semibold text-zinc-400">
                          THINKING
                        </span>
                        <span className="text-[11px] font-mono font-bold text-amber-300 my-0.5 truncate w-full">
                          {thinkingVal}
                        </span>
                        <span className="text-[8.5px] font-mono text-zinc-500">Config</span>
                      </div>
                    </div>
                  </div>

                  {/* systemInstruction */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-1.5 text-amber-400 font-semibold">
                        <FileText className="w-3 h-3 text-amber-400" />
                        <span>systemInstruction (Diretivas Injetadas no Modelo)</span>
                      </div>
                      <span className="text-[9.5px] text-zinc-500 font-mono">
                        {estimateTokens(sysText)} tokens
                      </span>
                    </div>

                    <div className="p-2 rounded bg-zinc-950 border border-zinc-800/80 text-zinc-300 font-mono text-[10.5px] leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap select-text">
                      {sysText || 'Nenhuma diretiva de sistema explícita definida.'}
                    </div>
                  </div>

                  {/* contents */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-1.5 text-blue-400 font-semibold">
                        <Code2 className="w-3 h-3 text-blue-400" />
                        <span>contents.parts (Conteúdo & Prompt Enviado)</span>
                      </div>
                      <span className="text-[9.5px] text-zinc-500 font-mono">
                        {estimateTokens(promptText)} tokens
                      </span>
                    </div>

                    <div className="p-2 rounded bg-zinc-950 border border-zinc-800/80 text-zinc-300 font-mono text-[10.5px] leading-relaxed max-h-36 overflow-y-auto whitespace-pre-wrap select-text">
                      {promptText}
                    </div>
                  </div>

                  {/* tools & functionDeclarations — Fidedigno à realidade */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                        <Wrench className="w-3 h-3 text-emerald-400" />
                        <span>tools.functionDeclarations (Declarações de Ferramentas)</span>
                      </div>
                      <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 text-emerald-400 border border-emerald-500/20">
                        {toolDeclarations.length > 0 ? `${toolDeclarations.length} ferramentas` : 'Nenhuma ferramenta declarada'}
                      </span>
                    </div>

                    {toolDeclarations.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {toolDeclarations.map((fn) => (
                          <div
                            key={fn.name}
                            className="p-1.5 rounded bg-zinc-900/60 border border-zinc-800/80 flex flex-col justify-between"
                          >
                            <span className="font-mono text-[11px] font-semibold text-emerald-400">
                              {fn.name}
                            </span>
                            <span className="text-[9.5px] text-zinc-400 line-clamp-2 mt-0.5 leading-tight">
                              {fn.description}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-2 rounded bg-zinc-950/80 border border-zinc-800/80 text-zinc-500 text-[10.5px]">
                        Nenhuma ferramenta externa (MCP ou Tools) vinculada a esta inferência específica.
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* ========================================================
            ACCORDION 2: Parâmetros CLI & Invocação
           ======================================================== */}
        <div className="rounded-lg border border-amber-500/30 bg-zinc-950/70 overflow-hidden transition-all shadow-xs">
          <div
            onClick={() => toggleSection('params')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleSection('params');
              }
            }}
            className={`w-full px-3 py-2 flex items-center justify-between text-left transition cursor-pointer select-none ${
              expandedSections.has('params')
                ? 'bg-amber-500/15 border-b border-amber-500/30 text-amber-300'
                : 'hover:bg-zinc-900/80 text-zinc-200'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {expandedSections.has('params') ? (
                <ChevronDown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              )}
              <FileText className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <Briefcase className="w-3 h-3 text-zinc-400 -ml-1.5 shrink-0" />
              <span className="font-semibold text-xs truncate">
                Parâmetros CLI & Invocação
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={(e) =>
                  handleCopy(JSON.stringify(data.parameterOrigins, null, 2), 'params', e)
                }
                className="p-1 text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
                title="Copiar origens de parâmetros"
              >
                {copiedSection === 'params' ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </div>
          </div>

          {expandedSections.has('params') && (
            <div className="p-2.5 space-y-2 bg-zinc-950/40">
              <div className="flex items-center justify-between text-[11px] pb-1 border-b border-zinc-800/60">
                <span className="text-zinc-400 font-mono">Origens Mapeadas dos Parâmetros</span>
                <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
                  {Object.keys(data.parameterOrigins || {}).length} parâmetros rastreados
                </span>
              </div>

              <div className="space-y-1.5">
                {Object.entries(data.parameterOrigins || {}).map(([paramKey, origin]) => (
                  <div
                    key={paramKey}
                    className="p-1.5 rounded bg-zinc-900/70 border border-zinc-800/80 flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <span className="text-blue-400 font-mono font-bold text-[11px]">{paramKey}</span>
                      <div className="text-zinc-300 font-mono truncate max-w-xs mt-0.5 text-[10px]">
                        {typeof origin.value === 'object'
                          ? JSON.stringify(origin.value)
                          : String(origin.value)}
                      </div>
                    </div>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 shrink-0 border border-zinc-700/50 max-w-[180px] truncate">
                      {origin.source}
                    </span>
                  </div>
                ))}
              </div>

              {/* Invocação Processo */}
              <div className="mt-2 pt-2 border-t border-zinc-800/80 space-y-1.5">
                <span className="text-amber-400 font-semibold text-[11px] flex items-center gap-1.5">
                  <Terminal className="w-3 h-3 text-amber-400" />
                  Invocação do Processo CLI
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[10.5px]">
                  <div className="p-1.5 rounded bg-zinc-900/60 border border-zinc-800">
                    <span className="text-zinc-500 font-mono text-[9px] block">EXECUTÁVEL</span>
                    <span className="font-mono text-zinc-200">{data.input.cliExecutable || 'gemini'}</span>
                  </div>
                  <div className="p-1.5 rounded bg-zinc-900/60 border border-zinc-800">
                    <span className="text-zinc-500 font-mono text-[9px] block">MODO DE APROVAÇÃO</span>
                    <span className="font-mono text-amber-400 uppercase">{data.input.approvalMode}</span>
                  </div>
                  <div className="p-1.5 rounded bg-zinc-900/60 border border-zinc-800 sm:col-span-2">
                    <span className="text-zinc-500 font-mono text-[9px] block">DIRETÓRIO DE TRABALHO</span>
                    <span className="font-mono text-zinc-300 truncate block">{data.input.workDir}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ========================================================
            ACCORDION 3: Saída & Ferramentas
           ======================================================== */}
        <div className="rounded-lg border border-amber-500/30 bg-zinc-950/70 overflow-hidden transition-all shadow-xs">
          <div
            onClick={() => toggleSection('output')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleSection('output');
              }
            }}
            className={`w-full px-3 py-2 flex items-center justify-between text-left transition cursor-pointer select-none ${
              expandedSections.has('output')
                ? 'bg-amber-500/15 border-b border-amber-500/30 text-amber-300'
                : 'hover:bg-zinc-900/80 text-zinc-200'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {expandedSections.has('output') ? (
                <ChevronDown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              )}
              <Settings className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <Briefcase className="w-3 h-3 text-zinc-400 -ml-1.5 shrink-0" />
              <span className="font-semibold text-xs truncate">
                Saída & Ferramentas
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={(e) => handleCopy(JSON.stringify(data.output, null, 2), 'output', e)}
                className="p-1 text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
                title="Copiar dados de saída"
              >
                {copiedSection === 'output' ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </div>
          </div>

          {expandedSections.has('output') && (
            <div className="p-2.5 space-y-2 bg-zinc-950/40">
              {/* Tool calls execution list */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10.5px]">
                  <span className="text-zinc-400 font-mono">Chamadas de Ferramentas Executadas:</span>
                  <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 text-emerald-400 border border-zinc-800">
                    {toolCallsList.length} execuções
                  </span>
                </div>

                {toolCallsList.length > 0 ? (
                  toolCallsList.map((tc, idx) => (
                    <div
                      key={idx}
                      className="p-2 rounded bg-zinc-900/80 border border-zinc-800 space-y-1 text-[10.5px]"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-emerald-400">{tc.toolName || (tc as any).name}</span>
                        <span className="text-[9.5px] text-zinc-500 font-mono">Chamada #{idx + 1}</span>
                      </div>
                      {tc.parameters && (
                        <div className="p-1 rounded bg-zinc-950 text-zinc-300 font-mono text-[10px] overflow-x-auto">
                          <pre>{JSON.stringify(tc.parameters, null, 2)}</pre>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="p-2 rounded bg-zinc-950 border border-zinc-800 text-zinc-500 text-[10.5px]">
                    Nenhuma ferramenta foi invocada pelo modelo nesta resposta.
                  </div>
                )}
              </div>

              {/* Status and Latency */}
              <div className="grid grid-cols-2 gap-1.5 text-[10.5px] pt-1">
                <div className="p-1.5 rounded bg-zinc-900/60 border border-zinc-800">
                  <span className="text-zinc-500 font-mono text-[9px] block">STATUS</span>
                  <span className="font-mono text-emerald-400">{data.output.status || 'CONCLUÍDO'}</span>
                </div>
                <div className="p-1.5 rounded bg-zinc-900/60 border border-zinc-800">
                  <span className="text-zinc-500 font-mono text-[9px] block">DURAÇÃO</span>
                  <span className="font-mono text-zinc-200">{data.output.durationMs ? `${data.output.durationMs}ms` : 'Stream Finalizado'}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ========================================================
            ACCORDION 4: Log SSE (Server-Sent Events)
           ======================================================== */}
        <div className="rounded-lg border border-amber-500/30 bg-zinc-950/70 overflow-hidden transition-all shadow-xs">
          <div
            onClick={() => toggleSection('sse')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleSection('sse');
              }
            }}
            className={`w-full px-3 py-2 flex items-center justify-between text-left transition cursor-pointer select-none ${
              expandedSections.has('sse')
                ? 'bg-amber-500/15 border-b border-amber-500/30 text-amber-300'
                : 'hover:bg-zinc-900/80 text-zinc-200'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {expandedSections.has('sse') ? (
                <ChevronDown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              )}
              <span className="font-mono text-zinc-400 text-xs shrink-0">{`>_`}</span>
              <Zap className="w-3 h-3 text-amber-400 -ml-1 shrink-0" />
              <span className="font-semibold text-xs truncate">
                Log SSE (Server-Sent Events)
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  const sseContent = formatSseText(data, resolvedModel, message, estimatedTotalTokens);
                  handleCopy(sseContent, 'sse', e);
                }}
                className="p-1 text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
                title="Copiar log SSE"
              >
                {copiedSection === 'sse' ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </div>
          </div>

          {expandedSections.has('sse') && (
            <div className="p-2.5 bg-zinc-950/40 space-y-1.5">
              <div className="flex items-center justify-between text-[10.5px]">
                <span className="text-zinc-400 font-mono">Stream de Pacotes SSE em Tempo Real:</span>
                <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 text-amber-400 border border-zinc-800">
                  {sseEventsCount} eventos transmitidos
                </span>
              </div>

              <div className="p-2 rounded bg-zinc-950 border border-zinc-800 font-mono text-[10px] text-emerald-400/90 max-h-52 overflow-y-auto leading-relaxed whitespace-pre-wrap select-text selection:bg-emerald-950">
                {formatSseText(data, resolvedModel, message, estimatedTotalTokens)}
              </div>
            </div>
          )}
        </div>

        {/* ========================================================
            ACCORDION 5: Raw JSON
           ======================================================== */}
        <div className="rounded-lg border border-amber-500/30 bg-zinc-950/70 overflow-hidden transition-all shadow-xs">
          <div
            onClick={() => toggleSection('rawJson')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleSection('rawJson');
              }
            }}
            className={`w-full px-3 py-2 flex items-center justify-between text-left transition cursor-pointer select-none ${
              expandedSections.has('rawJson')
                ? 'bg-amber-500/15 border-b border-amber-500/30 text-amber-300'
                : 'hover:bg-zinc-900/80 text-zinc-200'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {expandedSections.has('rawJson') ? (
                <ChevronDown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              )}
              <Code2 className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <span className="font-semibold text-xs truncate">
                Raw JSON (Estrutura Completa)
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={(e) =>
                  handleCopy(JSON.stringify(fullJsonStructure, null, 2), 'rawJson', e)
                }
                className="p-1 text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
                title="Copiar JSON Completo"
              >
                {copiedSection === 'rawJson' ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </div>
          </div>

          {expandedSections.has('rawJson') && (
            <div className="p-2.5 bg-zinc-950/40">
              <div className="p-2 rounded bg-zinc-950 border border-zinc-800 font-mono text-[10px] text-amber-400/90 max-h-60 overflow-y-auto leading-relaxed whitespace-pre-wrap select-text">
                {JSON.stringify(fullJsonStructure, null, 2)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
