import React, { useState } from 'react';
import {
  Code,
  Terminal,
  FileText,
  Layers,
  Activity,
  Cpu,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  Sliders,
  Sparkles,
  ShieldCheck,
  HelpCircle,
  Zap,
} from 'lucide-react';
import { RawInspectionData } from '../utils/rawPayloadUtils.js';

interface RawPayloadViewerProps {
  data: RawInspectionData;
  isUserMessage: boolean;
}

export const RawPayloadViewer: React.FC<RawPayloadViewerProps> = ({ data, isUserMessage }) => {
  const [activeTab, setActiveTab] = useState<'finalApi' | 'input' | 'output' | 'events' | 'json'>('finalApi');
  const [copied, setCopied] = useState(false);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);

  const fullJsonStructure = {
    finalApiRequest: data.finalApiRequest,
    parameterOrigins: data.parameterOrigins,
    cliInvocation: data.input,
    output: data.output,
  };

  const fullJsonString = JSON.stringify(fullJsonStructure, null, 2);
  const finalApiJsonString = JSON.stringify(data.finalApiRequest, null, 2);

  const handleCopy = (text: string, section?: string) => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text)
          .then(() => {
            showFeedback(section);
          })
          .catch((err) => {
            console.warn('Falha ao usar navigator.clipboard, tentando fallback...', err);
            fallbackCopy(text, section);
          });
      } else {
        fallbackCopy(text, section);
      }
    } catch (err) {
      console.warn('Erro geral ao copiar, tentando fallback...', err);
      fallbackCopy(text, section);
    }
  };

  const fallbackCopy = (text: string, section?: string) => {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.fontSize = '12pt';
      textarea.style.position = 'fixed';
      textarea.style.top = '0';
      textarea.style.left = '0';
      textarea.style.width = '2em';
      textarea.style.height = '2em';
      textarea.style.padding = '0';
      textarea.style.border = 'none';
      textarea.style.outline = 'none';
      textarea.style.boxShadow = 'none';
      textarea.style.background = 'transparent';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (success) {
        showFeedback(section);
      } else {
        console.error('Falha no fallback de copia com execCommand.');
      }
    } catch (err) {
      console.error('Erro no fallback de copia:', err);
    }
  };

  const showFeedback = (section?: string) => {
    if (section) {
      setCopiedSection(section);
      setTimeout(() => setCopiedSection(null), 2000);
    } else {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const genConfig = data.finalApiRequest?.generationConfig || {};

  return (
    <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-950/20 dark:bg-amber-950/30 overflow-hidden text-xs shadow-xs">
      {/* Header Bar */}
      <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between gap-2">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 font-mono font-semibold text-amber-700 dark:text-amber-300 hover:text-amber-800 dark:hover:text-amber-200 transition"
        >
          <Eye className="w-4 h-4 text-amber-500" />
          <span>PAYLOAD BRUTO FINAL & AUDITORIA DE API (GOOGLE GEMINI)</span>
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-800 dark:text-amber-200 border border-amber-500/30">
            {data.output.tokenStats.totalTokens.toLocaleString()} tokens
          </span>
          <button
            onClick={() => handleCopy(fullJsonString)}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition cursor-pointer"
            title="Copiar JSON completo da requisição final e resposta"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copiado!' : 'Copiar JSON'}</span>
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="p-3 space-y-3">
          {/* Tabs selector */}
          <div className="flex items-center gap-1 border-b border-zinc-800/80 pb-2 overflow-x-auto">
            <button
              onClick={() => setActiveTab('finalApi')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium transition whitespace-nowrap cursor-pointer ${
                activeTab === 'finalApi'
                  ? 'bg-amber-500 text-zinc-950 font-bold shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              <Zap className="w-3.5 h-3.5 text-amber-950 dark:text-amber-200" />
              <span>🎯 Payload API Google (finalApiRequest)</span>
            </button>

            <button
              onClick={() => setActiveTab('input')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium transition whitespace-nowrap cursor-pointer ${
                activeTab === 'input'
                  ? 'bg-amber-500 text-zinc-950 font-bold shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>📥 Parâmetros CLI & Invocação</span>
            </button>

            <button
              onClick={() => setActiveTab('output')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium transition whitespace-nowrap cursor-pointer ${
                activeTab === 'output'
                  ? 'bg-amber-500 text-zinc-950 font-bold shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>📤 Saída & Ferramentas</span>
            </button>

            <button
              onClick={() => setActiveTab('events')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium transition whitespace-nowrap cursor-pointer ${
                activeTab === 'events'
                  ? 'bg-amber-500 text-zinc-950 font-bold shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>⚡ Log SSE ({data.output.rawEvents.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('json')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium transition whitespace-nowrap cursor-pointer ${
                activeTab === 'json'
                  ? 'bg-amber-500 text-zinc-950 font-bold shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              <Code className="w-3.5 h-3.5" />
              <span>{} Raw JSON</span>
            </button>
          </div>

          {/* TAB 1: FINAL API REQUEST (O PAYLOAD REAL EFETIVAMENTE ENVIADO AO GOOGLE) */}
          {activeTab === 'finalApi' && (
            <div className="space-y-3 font-mono text-[11px] text-zinc-300">
              {/* Alert / Explanation Banner */}
              <div className="p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-500/30 flex items-start justify-between gap-3">
                <div className="space-y-0.5 font-sans">
                  <div className="text-emerald-400 font-semibold flex items-center gap-1.5 text-xs">
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Payload Efetivo Montado Imediatamente Antes da Chamada à API Google</span>
                  </div>
                  <p className="text-zinc-400 text-[11px]">
                    Valores e hiperparâmetros consolidados e transmitidos diretamente na chamada de inferência ao Google Gemini API (sem expor chaves ou credenciais sensíveis).
                  </p>
                </div>
                <button
                  onClick={() => handleCopy(finalApiJsonString, 'finalApi')}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition text-[11px] shrink-0 font-mono"
                >
                  {copiedSection === 'finalApi' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSection === 'finalApi' ? 'Copiado!' : 'Copiar finalApiRequest'}</span>
                </button>
              </div>

              {/* Resolved Target Model */}
              <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-between">
                <div>
                  <span className="text-zinc-500">Modelo Efetivo Resolvido:</span>{' '}
                  <code className="text-emerald-400 font-bold text-xs">{data.finalApiRequest.model}</code>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
                  {data.parameterOrigins?.['model']?.source || 'Catálogo de Modelos'}
                </span>
              </div>

              {/* Generation Parameters Grid (temperature, topP, topK, maxTokens, thinking) */}
              <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-2">
                <div className="text-amber-400 font-bold flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Hiperparâmetros de Geração (generationConfig)</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
                  <div className="p-2 rounded bg-black/50 border border-zinc-800/80">
                    <span className="text-zinc-500 text-[10px] block uppercase">temperature</span>
                    <span className="text-amber-400 font-bold text-sm">{genConfig.temperature ?? '0.2'}</span>
                    <span className="text-[9px] text-zinc-500 block truncate mt-0.5" title={data.parameterOrigins?.['generationConfig.temperature']?.source}>
                      {data.parameterOrigins?.['generationConfig.temperature']?.value !== undefined ? 'Resolvido' : 'Padrão'}
                    </span>
                  </div>

                  <div className="p-2 rounded bg-black/50 border border-zinc-800/80">
                    <span className="text-zinc-500 text-[10px] block uppercase">topP</span>
                    <span className="text-cyan-400 font-bold text-sm">{genConfig.topP ?? '0.95'}</span>
                    <span className="text-[9px] text-zinc-500 block truncate mt-0.5" title={data.parameterOrigins?.['generationConfig.topP']?.source}>
                      {data.parameterOrigins?.['generationConfig.topP']?.value !== undefined ? 'Resolvido' : 'Padrão'}
                    </span>
                  </div>

                  <div className="p-2 rounded bg-black/50 border border-zinc-800/80">
                    <span className="text-zinc-500 text-[10px] block uppercase">topK</span>
                    <span className="text-purple-400 font-bold text-sm">{genConfig.topK ?? '40'}</span>
                    <span className="text-[9px] text-zinc-500 block truncate mt-0.5" title={data.parameterOrigins?.['generationConfig.topK']?.source}>
                      {data.parameterOrigins?.['generationConfig.topK']?.value !== undefined ? 'Resolvido' : 'Padrão'}
                    </span>
                  </div>

                  <div className="p-2 rounded bg-black/50 border border-zinc-800/80">
                    <span className="text-zinc-500 text-[10px] block uppercase">maxOutputTokens</span>
                    <span className="text-blue-400 font-bold text-sm">{genConfig.maxOutputTokens ?? 'Janela Total'}</span>
                    <span className="text-[9px] text-zinc-500 block truncate mt-0.5" title={data.parameterOrigins?.['generationConfig.maxOutputTokens']?.source}>
                      {genConfig.maxOutputTokens ? 'Limitado' : 'Sem Limite'}
                    </span>
                  </div>

                  <div className="p-2 rounded bg-black/50 border border-zinc-800/80">
                    <span className="text-zinc-500 text-[10px] block uppercase">thinkingConfig</span>
                    <span className={`font-bold text-sm ${genConfig.thinkingConfig?.includeThoughts ? 'text-emerald-400' : 'text-zinc-500'}`}>
                      {genConfig.thinkingConfig?.includeThoughts ? 'Ativo' : 'Desativado'}
                    </span>
                    <span className="text-[9px] text-zinc-500 block truncate mt-0.5">
                      {genConfig.thinkingConfig?.includeThoughts ? 'Thoughts ON' : 'Padrão'}
                    </span>
                  </div>
                </div>
              </div>

              {/* System Instruction (systemInstruction) */}
              <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1">
                <div className="flex items-center justify-between text-amber-400 font-bold">
                  <div className="flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" />
                    <span>systemInstruction (Diretivas Injetadas no Modelo)</span>
                  </div>
                  <span className="text-zinc-500 text-[10px] font-normal">
                    {data.parameterOrigins?.['systemInstruction']?.source || 'Instruções do Agente'}
                  </span>
                </div>
                <pre className="p-2 rounded bg-black/50 text-zinc-300 whitespace-pre-wrap max-h-40 overflow-y-auto font-sans leading-relaxed">
                  {typeof data.finalApiRequest.systemInstruction === 'object' && data.finalApiRequest.systemInstruction?.parts
                    ? data.finalApiRequest.systemInstruction.parts.map((p) => p.text).join('\n\n')
                    : typeof data.finalApiRequest.systemInstruction === 'string'
                    ? data.finalApiRequest.systemInstruction
                    : '(Nenhuma systemInstruction customizada)'}
                </pre>
              </div>

              {/* Contents Parts (Prompt + Context) */}
              <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1">
                <div className="flex items-center justify-between text-amber-400 font-bold">
                  <div className="flex items-center gap-1.5">
                    <Code className="w-3.5 h-3.5" />
                    <span>contents (Array de Mensagens & Partes de Texto)</span>
                  </div>
                  <span className="text-zinc-500 text-[10px] font-normal">
                    {data.finalApiRequest.contents?.length || 1} entrada(s)
                  </span>
                </div>
                <pre className="p-2 rounded bg-black/60 text-emerald-400 whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {JSON.stringify(data.finalApiRequest.contents, null, 2)}
                </pre>
              </div>

              {/* Tools and Function Declarations */}
              {data.finalApiRequest.tools && data.finalApiRequest.tools.length > 0 && (
                <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1">
                  <div className="text-amber-400 font-bold flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5" />
                    <span>tools (Declarações de Funções Habilitadas na Chamada)</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pt-1">
                    {data.finalApiRequest.tools[0]?.functionDeclarations?.map((fn: any) => (
                      <div key={fn.name} className="p-1.5 rounded bg-black/40 border border-zinc-800 text-[10px]">
                        <code className="text-cyan-400 font-bold">{fn.name}</code>
                        <span className="text-zinc-500 block truncate text-[9px] mt-0.5">{fn.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Parameter Provenance Table */}
              <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1.5">
                <div className="text-zinc-400 font-bold flex items-center gap-1.5">
                  <HelpCircle className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Rastreabilidade e Origem dos Parâmetros Resolvidos</span>
                </div>
                <div className="border border-zinc-800 rounded-md overflow-x-auto">
                  <table className="w-full text-left text-[10px] divide-y divide-zinc-800">
                    <thead className="bg-zinc-950/80 text-zinc-400 font-semibold uppercase tracking-wider">
                      <tr>
                        <th className="px-2.5 py-1.5">Parâmetro</th>
                        <th className="px-2.5 py-1.5">Valor Resolvido</th>
                        <th className="px-2.5 py-1.5">Origem da Configuração</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60 font-sans">
                      {Object.entries(data.parameterOrigins || {}).map(([paramKey, origin]) => {
                        const org = origin as { value?: any; source?: string };
                        return (
                          <tr key={paramKey} className="hover:bg-zinc-800/30 font-mono">
                            <td className="px-2.5 py-1 text-amber-300 font-medium">{paramKey}</td>
                            <td className="px-2.5 py-1 text-emerald-400 font-semibold">{String(org?.value ?? '')}</td>
                            <td className="px-2.5 py-1 text-zinc-400 font-sans text-[10px]">{org?.source || ''}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: INPUT (INVOVAÇÃO CLI) */}
          {activeTab === 'input' && (
            <div className="space-y-3 font-mono text-[11px] text-zinc-300">
              {/* CLI Execution Parameters */}
              <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1">
                <div className="text-amber-400 font-bold flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Comando de Invocação da CLI & Parâmetros</span>
                </div>
                <div>
                  <span className="text-zinc-500">Executável:</span> <code>{data.input.cliExecutable}</code>
                </div>
                <div>
                  <span className="text-zinc-500">Modelo:</span> <code className="text-emerald-400">{data.input.model}</code>
                </div>
                <div>
                  <span className="text-zinc-500">Agente Ativo:</span> {data.input.agentName}
                </div>
                <div>
                  <span className="text-zinc-500">Modo de Aprovação:</span>{' '}
                  <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-amber-300">{data.input.approvalMode}</span>
                </div>
                <div>
                  <span className="text-zinc-500">WorkDir:</span> <code>{data.input.workDir}</code>
                </div>
              </div>

              {/* System Instructions */}
              <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1">
                <div className="text-amber-400 font-bold flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Instruções do Agente de Sistema (System Instructions)</span>
                </div>
                <pre className="p-2 rounded bg-black/50 text-zinc-300 whitespace-pre-wrap max-h-40 overflow-y-auto font-sans leading-relaxed">
                  {data.input.systemInstructions}
                </pre>
              </div>

              {/* Injected Workspace Context & Dirs */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1">
                  <div className="text-amber-400 font-bold flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5" />
                    <span>Diretórios Autorizados ({data.input.authorizedDirs.length})</span>
                  </div>
                  {data.input.authorizedDirs.length === 0 ? (
                    <span className="text-zinc-500 italic">Nenhum diretório específico</span>
                  ) : (
                    <ul className="list-disc list-inside text-zinc-300">
                      {data.input.authorizedDirs.map((dir) => (
                        <li key={dir} className="truncate">{dir}</li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1">
                  <div className="text-amber-400 font-bold flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Skills ({data.input.activeSkills.length}) & MCPs ({data.input.activeMcps.length})</span>
                  </div>
                  <div className="text-[10px] space-y-1">
                    <div>
                      <span className="text-zinc-500">Skills:</span>{' '}
                      {data.input.activeSkills.join(', ') || 'Nenhuma'}
                    </div>
                    <div>
                      <span className="text-zinc-500">MCP Servers:</span>{' '}
                      {data.input.activeMcps.join(', ') || 'Nenhum'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Full Injected Prompt Buffer */}
              <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1">
                <div className="text-amber-400 font-bold flex items-center gap-1.5">
                  <Code className="w-3.5 h-3.5" />
                  <span>Prompt e Buffer de Contexto Injetado Completo</span>
                </div>
                <pre className="p-2 rounded bg-black/60 text-emerald-400 whitespace-pre-wrap max-h-56 overflow-y-auto">
                  {data.input.fullInjectedPrompt}
                </pre>
              </div>
            </div>
          )}

          {/* TAB 3: OUTPUT (RETORNADO) */}
          {activeTab === 'output' && (
            <div className="space-y-3 font-mono text-[11px] text-zinc-300">
              {/* Token Metrics & Timing */}
              <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                <div className="p-2 rounded bg-black/40">
                  <span className="text-zinc-500 text-[10px] block uppercase">Tokens de Entrada</span>
                  <span className="text-amber-400 font-bold text-sm">{data.output.tokenStats.inputTokens.toLocaleString()}</span>
                </div>
                <div className="p-2 rounded bg-black/40">
                  <span className="text-zinc-500 text-[10px] block uppercase">Tokens de Saída</span>
                  <span className="text-emerald-400 font-bold text-sm">{data.output.tokenStats.outputTokens.toLocaleString()}</span>
                </div>
                <div className="p-2 rounded bg-black/40">
                  <span className="text-zinc-500 text-[10px] block uppercase">Total Tokens</span>
                  <span className="text-blue-400 font-bold text-sm">{data.output.tokenStats.totalTokens.toLocaleString()}</span>
                </div>
                <div className="p-2 rounded bg-black/40">
                  <span className="text-zinc-500 text-[10px] block uppercase">Tempo Resposta</span>
                  <span className="text-purple-400 font-bold text-sm">{data.output.durationMs}ms</span>
                </div>
              </div>

              {/* Tool Calls executed */}
              {data.output.toolCalls.length > 0 && (
                <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-2">
                  <div className="text-amber-400 font-bold flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5" />
                    <span>Ferramentas Executadas ({data.output.toolCalls.length})</span>
                  </div>
                  {data.output.toolCalls.map((tc, idx) => (
                    <div key={tc.id || idx} className="p-2 rounded bg-black/50 border border-zinc-800 space-y-1">
                      <div className="flex items-center justify-between text-zinc-300 font-bold">
                        <div className="group relative flex items-center gap-2">
                          <span className="cursor-help underline decoration-dotted decoration-zinc-600 underline-offset-2">{tc.toolName}</span>
                          
                          {/* Transparency Tooltip */}
                          <div className="absolute bottom-full left-0 mb-2 w-80 p-3 bg-zinc-900 text-zinc-100 rounded-xl shadow-2xl opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 border border-zinc-700/50 font-sans text-[10px] leading-relaxed backdrop-blur-md">
                            <div className="space-y-2.5">
                              <div className="flex items-center gap-2 border-b border-zinc-700/50 pb-1.5 mb-1.5">
                                <Terminal className="w-3 h-3 text-blue-400" />
                                <span className="font-bold uppercase tracking-tight text-zinc-400">Transparência de Execução</span>
                              </div>
                              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                                <div>
                                  <span className="text-zinc-500 font-bold uppercase tracking-tighter block mb-0.5 text-[9px]">ID Real</span>
                                  <code className="text-blue-400 break-all font-mono">{tc.toolName}</code>
                                </div>
                                <div>
                                  <span className="text-zinc-500 font-bold uppercase tracking-tighter block mb-0.5 text-[9px]">Origem</span>
                                  <span className={tc.origin ? 'text-zinc-200' : 'text-zinc-500 italic'}>{tc.origin || 'Não disponível'}</span>
                                </div>
                                <div className="col-span-2">
                                  <span className="text-zinc-500 font-bold uppercase tracking-tighter block mb-0.5 text-[9px]">Descrição</span>
                                  <span className={tc.description ? 'text-zinc-200' : 'text-zinc-500 italic'}>{tc.description || 'Não disponível'}</span>
                                </div>
                                <div>
                                  <span className="text-zinc-500 font-bold uppercase tracking-tighter block mb-0.5 text-[9px]">Registro</span>
                                  <span className={tc.componentRegister ? 'text-zinc-200' : 'text-zinc-500 italic'}>{tc.componentRegister || 'Não disponível'}</span>
                                </div>
                                <div>
                                  <span className="text-zinc-500 font-bold uppercase tracking-tighter block mb-0.5 text-[9px]">Executor</span>
                                  <span className={tc.componentExecutor ? 'text-zinc-200' : 'text-zinc-500 italic'}>{tc.componentExecutor || 'Não disponível'}</span>
                                </div>
                              </div>
                              <div>
                                <span className="text-zinc-500 font-bold uppercase tracking-tighter block mb-0.5 text-[9px]">Parâmetros Efetivos</span>
                                <pre className="text-emerald-400 overflow-x-auto max-h-24 p-1.5 bg-black/40 rounded-lg font-mono text-[9px] border border-white/5 whitespace-pre-wrap break-all">
                                  {JSON.stringify(tc.parameters, null, 2)}
                                </pre>
                              </div>
                            </div>
                          </div>
                        </div>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300">
                          {tc.status}
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-500">Parâmetros:</span>
                        <pre className="p-1 rounded bg-zinc-900 text-amber-300 text-[10px] whitespace-pre-wrap break-all">
                          {JSON.stringify(tc.parameters, null, 2)}
                        </pre>
                      </div>
                      {tc.result && (
                        <div>
                          <span className="text-zinc-500">Stdout/Resultado:</span>
                          <pre className="p-1 rounded bg-zinc-900 text-zinc-300 text-[10px] max-h-28 overflow-y-auto whitespace-pre-wrap break-all">
                            {tc.result}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Raw Text Stream Output */}
              <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1">
                <div className="text-amber-400 font-bold flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5" />
                  <span>Texto Bruto Transmitido do Modelo (Raw Output Stream)</span>
                </div>
                <pre className="p-2 rounded bg-black/60 text-zinc-200 whitespace-pre-wrap max-h-60 overflow-y-auto font-sans leading-relaxed">
                  {data.output.rawTextStream || '(Nenhum texto retornado)'}
                </pre>
              </div>
            </div>
          )}

          {/* TAB 4: SSE EVENTS LOG */}
          {activeTab === 'events' && (
            <div className="space-y-2 font-mono text-[10px]">
              <div className="text-zinc-400 text-[11px]">
                Eventos brutos Server-Sent Events (SSE) recebidos token por token do processo Gemini CLI:
              </div>
              <div className="p-2.5 rounded-lg bg-black/80 border border-zinc-800 max-h-72 overflow-y-auto space-y-1">
                {data.output.rawEvents.length === 0 ? (
                  <div className="text-zinc-500 italic p-2">Nenhum evento registrado</div>
                ) : (
                  data.output.rawEvents.map((ev, idx) => (
                    <div key={idx} className="p-1.5 rounded bg-zinc-900/80 border border-zinc-800/60 font-mono text-zinc-300">
                      <span className="text-amber-400 font-bold mr-2">[{idx + 1}]</span>
                      <span className="text-blue-400 font-semibold">{ev.type || 'data'}</span>
                      <pre className="mt-1 text-[10px] text-zinc-400 whitespace-pre-wrap">
                        {JSON.stringify(ev, null, 2)}
                      </pre>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 5: RAW JSON COMPLETO COM finalApiRequest COMO SEÇÃO PRINCIPAL */}
          {activeTab === 'json' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-zinc-400 text-[11px]">
                <span>Estrutura completa de auditoria JSON (com seção clara `finalApiRequest`)</span>
                <button
                  onClick={() => handleCopy(fullJsonString)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition text-[10px] cursor-pointer"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? 'Copiado!' : 'Copiar'}</span>
                </button>
              </div>
              <pre className="p-3 rounded-lg bg-black text-emerald-400 font-mono text-[10px] max-h-96 overflow-y-auto border border-zinc-800 whitespace-pre-wrap break-all">
                {fullJsonString}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
