import React, { useState } from 'react';
import {
  ChevronRight,
  ChevronLeft,
  Cpu,
  Brain,
  Terminal,
  FileCode,
  Shield,
  Layers,
  Copy,
  Check,
  Sparkles,
  ExternalLink,
  Sliders,
  CheckCircle2,
  Clock,
  Zap,
} from 'lucide-react';
import {
  ChatMessage,
  AgentConfig,
  ProjectItem,
  AuthorizedDir,
  SkillConfig,
  McpConfig,
  ThinkingLevel,
} from '../types.js';
import { getRawInspectionData } from '../utils/rawPayloadUtils.js';

interface RightPayloadDrawerProps {
  isOpen: boolean;
  onToggle: () => void;
  selectedMessage: ChatMessage | null;
  latestMessage: ChatMessage | null;
  agent: AgentConfig | null;
  activeProject: ProjectItem | null;
  authorizedDirs: AuthorizedDir[];
  skills: SkillConfig[];
  mcpServers: McpConfig[];
  approvalMode: string;
  thinkingLevel: ThinkingLevel;
  onOpenMemoryModal?: () => void;
  onOpenVersionsModal?: () => void;
}

export const RightPayloadDrawer: React.FC<RightPayloadDrawerProps> = ({
  isOpen,
  onToggle,
  selectedMessage,
  latestMessage,
  agent,
  activeProject,
  authorizedDirs,
  skills,
  mcpServers,
  approvalMode,
  thinkingLevel,
  onOpenMemoryModal,
  onOpenVersionsModal,
}) => {
  const [activeTab, setActiveTab] = useState<'payload' | 'agent' | 'tools'>('payload');
  const [copied, setCopied] = useState(false);

  // Message to inspect: prefer specifically selected message, otherwise fallback to latest message
  const msgToInspect = selectedMessage || latestMessage;

  const inspectionData = msgToInspect
    ? getRawInspectionData(
        msgToInspect,
        agent || undefined,
        activeProject || undefined,
        authorizedDirs,
        skills,
        mcpServers,
        approvalMode as any
      )
    : null;

  const handleCopyJson = (obj: any) => {
    try {
      navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  if (!isOpen) {
    return (
      <div className="hidden lg:flex items-center shrink-0 border-l border-zinc-800 bg-zinc-950/80">
        <button
          onClick={onToggle}
          title="Abrir Painel de Payloads & Contexto (3ª Coluna)"
          className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800/80 transition flex flex-col items-center gap-2 cursor-pointer h-full justify-center"
        >
          <ChevronLeft className="w-4 h-4" />
          <span className="text-[10px] [writing-mode:vertical-rl] tracking-widest font-mono uppercase text-zinc-500">
            Payloads
          </span>
        </button>
      </div>
    );
  }

  return (
    <aside className="w-80 xl:w-96 border-l border-zinc-800 bg-zinc-950/95 flex flex-col shrink-0 overflow-hidden text-zinc-200 z-10 animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="h-12 px-3 border-b border-zinc-800 flex items-center justify-between shrink-0 bg-zinc-900/60">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Cpu className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-semibold text-white tracking-tight">Contexto & Payloads</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onToggle}
            title="Ocultar Painel"
            className="p-1.5 text-zinc-400 hover:text-white rounded-md hover:bg-zinc-800 transition cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="p-2 border-b border-zinc-800 bg-zinc-900/30 flex items-center gap-1 shrink-0">
        <button
          onClick={() => setActiveTab('payload')}
          className={`flex-1 py-1 text-[11px] font-medium rounded-md transition cursor-pointer flex items-center justify-center gap-1.5 ${
            activeTab === 'payload'
              ? 'bg-zinc-800 text-white shadow-2xs'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <FileCode className="w-3 h-3 text-indigo-400" />
          <span>Payload</span>
        </button>

        <button
          onClick={() => setActiveTab('agent')}
          className={`flex-1 py-1 text-[11px] font-medium rounded-md transition cursor-pointer flex items-center justify-center gap-1.5 ${
            activeTab === 'agent'
              ? 'bg-zinc-800 text-white shadow-2xs'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Brain className="w-3 h-3 text-teal-400" />
          <span>Agente</span>
        </button>

        <button
          onClick={() => setActiveTab('tools')}
          className={`flex-1 py-1 text-[11px] font-medium rounded-md transition cursor-pointer flex items-center justify-center gap-1.5 ${
            activeTab === 'tools'
              ? 'bg-zinc-800 text-white shadow-2xs'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Terminal className="w-3 h-3 text-amber-400" />
          <span>Tools ({skills.length + mcpServers.length})</span>
        </button>
      </div>

      {/* Drawer Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 font-mono text-xs">
        {/* TAB 1: Payload Viewer */}
        {activeTab === 'payload' && (
          <div className="space-y-3">
            {msgToInspect ? (
              <>
                <div className="flex items-center justify-between bg-zinc-900 p-2 rounded-lg border border-zinc-800">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                        msgToInspect.role === 'user'
                          ? 'bg-blue-950 text-blue-300 border border-blue-800/50'
                          : 'bg-emerald-950 text-emerald-300 border border-emerald-800/50'
                      }`}
                    >
                      {msgToInspect.role}
                    </span>
                    <span className="text-[10px] text-zinc-400 truncate max-w-[150px]">
                      {selectedMessage ? 'Mensagem Selecionada' : 'Última Mensagem'}
                    </span>
                  </div>

                  <button
                    onClick={() => handleCopyJson(inspectionData)}
                    className="p-1 text-zinc-400 hover:text-white rounded hover:bg-zinc-800 transition cursor-pointer flex items-center gap-1 text-[10px]"
                    title="Copiar JSON completo do payload"
                  >
                    {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copied ? 'Copiado' : 'Copiar'}</span>
                  </button>
                </div>

                {/* Token breakdown badge */}
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2 rounded-lg bg-zinc-900/80 border border-zinc-800">
                    <span className="text-zinc-500 block text-[9px] uppercase">Modelo</span>
                    <span className="text-zinc-200 font-bold truncate block">
                      {msgToInspect.model || agent?.model || 'gemini-3.5-flash-lite'}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-zinc-900/80 border border-zinc-800">
                    <span className="text-zinc-500 block text-[9px] uppercase">Raciocínio (Thinker)</span>
                    <span className="text-indigo-400 font-bold block uppercase">{thinkingLevel}</span>
                  </div>
                </div>

                {/* System Prompt snippet */}
                {inspectionData?.input?.systemInstructions && (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-2.5">
                    <span className="text-zinc-400 text-[10px] font-bold block mb-1">
                      System Prompt Efetivo
                    </span>
                    <pre className="text-[10px] text-zinc-300 whitespace-pre-wrap max-h-36 overflow-y-auto leading-relaxed select-text font-mono">
                      {inspectionData.input.systemInstructions}
                    </pre>
                  </div>
                )}

                {/* Tool Calls if any */}
                {msgToInspect.toolCalls && msgToInspect.toolCalls.length > 0 && (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-2.5">
                    <span className="text-zinc-400 text-[10px] font-bold block mb-1">
                      Chamadas de Ferramenta ({msgToInspect.toolCalls.length})
                    </span>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {msgToInspect.toolCalls.map((tc) => (
                        <div key={tc.id} className="p-2 bg-zinc-950 rounded border border-zinc-800/80">
                          <div className="flex items-center justify-between text-[10px] font-bold text-amber-400">
                            <span>{tc.toolName}</span>
                            <span className="text-zinc-500 uppercase text-[9px]">{tc.status}</span>
                          </div>
                          {tc.args && (
                            <pre className="text-[9px] text-zinc-400 overflow-x-auto mt-1 select-text">
                              {JSON.stringify(tc.args, null, 2)}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Raw inspection JSON */}
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2">
                  <span className="text-zinc-500 text-[9px] uppercase font-bold block mb-1">
                    Estrutura de Requisição / Resposta
                  </span>
                  <pre className="text-[10px] text-zinc-400 overflow-x-auto max-h-48 whitespace-pre leading-relaxed select-text">
                    {JSON.stringify(
                      {
                        messageId: msgToInspect.id,
                        role: msgToInspect.role,
                        model: msgToInspect.model,
                        approvalMode,
                        thinkingLevel,
                        agent: agent?.id,
                        activeProject: activeProject?.name,
                        authorizedDirsCount: authorizedDirs.length,
                      },
                      null,
                      2
                    )}
                  </pre>
                </div>
              </>
            ) : (
              <div className="py-12 text-center text-zinc-500 text-xs font-sans">
                Nenhuma mensagem disponível para inspecionar.
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Active Agent Specs */}
        {activeTab === 'agent' && (
          <div className="space-y-3 font-sans">
            <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-white">
                  {agent?.displayName || agent?.name || 'Agente Padrão'}
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-teal-400 border border-teal-500/20">
                  {agent?.model || 'gemini-3.5-flash-lite'}
                </span>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed mb-3">
                {agent?.description || 'Agente para desenvolvimento e execução no repositório.'}
              </p>

              <div className="space-y-2 border-t border-zinc-800 pt-2 text-xs">
                <div className="flex items-center justify-between text-zinc-400">
                  <span>Modo de Aprovação:</span>
                  <span className="font-mono text-zinc-200 font-medium capitalize">{approvalMode}</span>
                </div>
                <div className="flex items-center justify-between text-zinc-400">
                  <span>Raciocínio (Thinker):</span>
                  <span className="font-mono text-indigo-400 font-bold uppercase">{thinkingLevel}</span>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-lg space-y-2">
              <span className="text-xs font-semibold text-zinc-300 block mb-1">
                Atalhos Rápidos de Estado
              </span>
              <button
                onClick={onOpenMemoryModal}
                className="w-full py-1.5 px-2 bg-teal-950/40 hover:bg-teal-900/50 text-teal-300 border border-teal-500/30 rounded-md text-xs font-medium flex items-center justify-between transition cursor-pointer"
              >
                <div className="flex items-center gap-1.5">
                  <Brain className="w-3.5 h-3.5 text-teal-400" />
                  <span>Memória Compartilhada</span>
                </div>
                <ExternalLink className="w-3 h-3" />
              </button>

              <button
                onClick={onOpenVersionsModal}
                className="w-full py-1.5 px-2 bg-indigo-950/40 hover:bg-indigo-900/50 text-indigo-300 border border-indigo-500/30 rounded-md text-xs font-medium flex items-center justify-between transition cursor-pointer"
              >
                <div className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                  <span>App Versions (Snapshots)</span>
                </div>
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {/* TAB 3: Tools & MCP */}
        {activeTab === 'tools' && (
          <div className="space-y-3 font-sans">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-zinc-300">
                  Servidores MCP ({mcpServers.length})
                </span>
              </div>
              {mcpServers.length === 0 ? (
                <div className="p-3 bg-zinc-900/60 rounded-lg border border-zinc-800 text-xs text-zinc-500">
                  Nenhum servidor MCP configurado.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {mcpServers.map((mcp) => (
                    <div
                      key={mcp.name}
                      className="p-2 bg-zinc-900 rounded-lg border border-zinc-800 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-1.5">
                        <Terminal className="w-3.5 h-3.5 text-amber-400" />
                        <span className="font-semibold text-zinc-200">{mcp.name}</span>
                      </div>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                        {mcp.type}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-zinc-300">Skills ({skills.length})</span>
              </div>
              {skills.length === 0 ? (
                <div className="p-3 bg-zinc-900/60 rounded-lg border border-zinc-800 text-xs text-zinc-500">
                  Nenhuma skill habilitada.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {skills.map((s) => (
                    <div
                      key={s.name}
                      className="p-2 bg-zinc-900 rounded-lg border border-zinc-800 flex items-center justify-between text-xs"
                    >
                      <span className="font-semibold text-zinc-200">{s.name}</span>
                      <span className="text-[10px] text-zinc-500 truncate max-w-[120px]">
                        {s.description}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
