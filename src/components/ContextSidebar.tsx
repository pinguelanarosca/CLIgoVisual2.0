import React, { useState } from 'react';
import {
  Sparkles,
  X,
  Zap,
  BarChart2,
  Minimize2,
  CheckCircle2,
  Info,
  FileText,
  FolderGit2,
  MessageSquare,
  Wrench,
} from 'lucide-react';
import { ContextSettingsView } from './ContextSettingsView.js';
import {
  ChatMessage,
  AgentConfig,
  ProjectItem,
  AuthorizedDir,
  SkillConfig,
  McpConfig,
  SessionItem,
} from '../types.js';
import {
  ContextSettings,
  calculateContextBreakdown,
  compressContextMessages,
  formatTokenCount,
} from '../utils/tokenUtils.js';

interface ContextSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  targetSession?: SessionItem | null;
  sessions?: SessionItem[];
  currentSessionId?: string;
  onUpdateSessionMessages?: (sessionId: string, newMessages: ChatMessage[]) => void;
  messages: ChatMessage[];
  onUpdateMessages: (newMessages: ChatMessage[]) => void;
  agent?: AgentConfig | null;
  activeProject?: ProjectItem | null;
  projects?: ProjectItem[];
  authorizedDirs?: AuthorizedDir[];
  skills?: SkillConfig[];
  mcpServers?: McpConfig[];
  contextSettings: ContextSettings;
  onUpdateContextSettings: (updates: Partial<ContextSettings>) => void;
}

export const ContextSidebar: React.FC<ContextSidebarProps> = ({
  onClose,
  targetSession,
  sessions = [],
  currentSessionId,
  onUpdateSessionMessages,
  messages,
  onUpdateMessages,
  agent,
  activeProject,
  projects = [],
  authorizedDirs,
  skills,
  mcpServers,
  contextSettings,
  onUpdateContextSettings,
}) => {
  const [compressionResult, setCompressionResult] = useState<{
    success: boolean;
    message: string;
    tokensSaved?: number;
  } | null>(null);

  // If opened for a specific target session via 3-dots, use that session; otherwise find active session or fallback to current messages
  const activeSession =
    targetSession ||
    sessions.find((s) => (currentSessionId && s.id === currentSessionId) || s.messages === messages) ||
    null;
  const activeChatMessages = activeSession ? activeSession.messages || [] : messages;
  const sessionTitle = activeSession ? activeSession.title || 'Nova Conversa' : 'Sessão Ativa';
  
  const linkedProject = activeSession?.projectId
    ? projects.find((p) => p.id === activeSession.projectId)
    : activeProject;

  const breakdown = calculateContextBreakdown(
    activeChatMessages,
    agent,
    linkedProject,
    authorizedDirs,
    skills,
    mcpServers,
    contextSettings.maxContextWindow
  );

  const handleManualCompress = () => {
    if (!activeChatMessages || activeChatMessages.length === 0) {
      setCompressionResult({
        success: false,
        message: 'Esta conversa está vazia. Nenhuma compressão necessária.',
      });
      return;
    }

    const { compressedMessages, tokensSaved, originalTokens, newTokens } = compressContextMessages(
      activeChatMessages,
      contextSettings
    );

    if (tokensSaved <= 0) {
      setCompressionResult({
        success: true,
        message: 'O contexto desta conversa já está otimizado e dentro do limite.',
      });
      return;
    }

    if (activeSession && onUpdateSessionMessages) {
      onUpdateSessionMessages(activeSession.id, compressedMessages);
    } else {
      onUpdateMessages(compressedMessages);
    }

    const savingsPercent = Math.round((tokensSaved / originalTokens) * 100);

    setCompressionResult({
      success: true,
      message: `Compressão concluída! Reduzido de ${formatTokenCount(
        originalTokens
      )} para ${formatTokenCount(newTokens)} tokens (${savingsPercent}% de economia = ${formatTokenCount(
        tokensSaved
      )} tokens salvos).`,
      tokensSaved,
    });
  };

  return (
    <div className="h-full w-full flex flex-col bg-[#0c0c0e]/98 text-zinc-100 select-text overflow-hidden text-xs">
      {/* Header */}
      <div className="h-10 px-2.5 border-b border-amber-500/20 flex items-center justify-between shrink-0 bg-zinc-950/90 gap-1.5 overflow-hidden">
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-[11px] font-mono font-bold uppercase tracking-tight text-amber-400 truncate">
            CONTEXTO & TOKENS
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 font-mono text-[9.5px] font-semibold flex items-center gap-0.5">
            <Zap className="w-2.5 h-2.5" />
            {formatTokenCount(breakdown.totalActiveTokens)}
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

      {/* Body: Lightweight chat-specific view if targetSession is set, otherwise full ContextSettingsView */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-3">
        {targetSession ? (
          <div className="space-y-3">
            {/* 1. Origem do Contexto e Alvo de Compressão */}
            <div className="p-2.5 rounded-xl bg-zinc-900/90 border border-amber-500/30 text-[11px] space-y-1.5 font-sans">
              <div className="flex items-center gap-1.5 text-amber-400 font-semibold">
                <Info className="w-3.5 h-3.5 shrink-0" />
                <span>Origem do Contexto e Alvo de Compressão:</span>
              </div>

              <div className="space-y-1 text-zinc-200 text-[10.5px]">
                <div className="flex justify-between items-center py-0.5 border-b border-zinc-800/80">
                  <span className="text-zinc-400 font-medium">Sessão Ativa:</span>
                  <span className="font-mono text-amber-300 font-bold truncate max-w-[180px]" title={sessionTitle}>
                    {sessionTitle}
                  </span>
                </div>

                <div className="flex justify-between items-center py-0.5">
                  <span className="text-zinc-400 font-medium">Projeto Vinculado:</span>
                  <span className="font-mono text-emerald-400 font-semibold truncate max-w-[180px]">
                    {linkedProject ? linkedProject.name : 'Nenhum (Chat Livre)'}
                  </span>
                </div>
              </div>
            </div>

            {/* 2. Estrutura do Contexto Atual Enviado para o Agente */}
            <div className="bg-zinc-900/80 p-3 rounded-xl border border-zinc-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="text-[11px] font-bold uppercase font-mono tracking-wider text-zinc-300 flex items-center gap-1.5">
                  <BarChart2 className="w-3.5 h-3.5 text-blue-400" />
                  Estrutura do Contexto Atual
                </h4>
                <span className="text-[10px] font-mono font-bold text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">
                  {formatTokenCount(breakdown.totalActiveTokens)} / {formatTokenCount(breakdown.maxContextWindow)}
                </span>
              </div>

              {/* Progress Bar */}
              <div className="space-y-1">
                <div className="w-full bg-zinc-800 h-2.5 rounded-full overflow-hidden flex">
                  <div
                    title={`System Prompt: ${formatTokenCount(breakdown.systemInstructionsTokens)} tokens`}
                    className="bg-indigo-500 h-full transition-all"
                    style={{
                      width: `${(breakdown.systemInstructionsTokens / breakdown.maxContextWindow) * 100}%`,
                    }}
                  />
                  <div
                    title={`Projeto & Diretórios: ${formatTokenCount(breakdown.projectContextTokens)} tokens`}
                    className="bg-emerald-500 h-full transition-all"
                    style={{
                      width: `${(breakdown.projectContextTokens / breakdown.maxContextWindow) * 100}%`,
                    }}
                  />
                  <div
                    title={`Mensagens do Chat: ${formatTokenCount(breakdown.messagesTokens)} tokens`}
                    className="bg-amber-500 h-full transition-all"
                    style={{
                      width: `${(breakdown.messagesTokens / breakdown.maxContextWindow) * 100}%`,
                    }}
                  />
                  <div
                    title={`Ferramentas / Skills: ${formatTokenCount(breakdown.toolsAndMcpTokens)} tokens`}
                    className="bg-purple-500 h-full transition-all"
                    style={{
                      width: `${(breakdown.toolsAndMcpTokens / breakdown.maxContextWindow) * 100}%`,
                    }}
                  />
                </div>
                <div className="flex justify-between text-[9.5px] text-zinc-400 font-mono">
                  <span>Janela: {breakdown.utilizationPercent}%</span>
                  <span>Max: 1.000.000 tokens</span>
                </div>
              </div>

              {/* Breakdown Cards */}
              <div className="grid grid-cols-2 gap-1.5 pt-1">
                <div className="bg-zinc-950 p-2 rounded-lg border border-zinc-800/80">
                  <div className="flex items-center gap-1 text-[9.5px] text-indigo-400 font-bold uppercase mb-0.5">
                    <FileText className="w-2.5 h-2.5" />
                    System Prompt
                  </div>
                  <div className="text-[11px] font-mono font-bold text-zinc-200">
                    {formatTokenCount(breakdown.systemInstructionsTokens)} tokens
                  </div>
                </div>

                <div className="bg-zinc-950 p-2 rounded-lg border border-zinc-800/80">
                  <div className="flex items-center gap-1 text-[9.5px] text-emerald-400 font-bold uppercase mb-0.5">
                    <FolderGit2 className="w-2.5 h-2.5" />
                    Projeto
                  </div>
                  <div className="text-[11px] font-mono font-bold text-zinc-200">
                    {formatTokenCount(breakdown.projectContextTokens)} tokens
                  </div>
                </div>

                <div className="bg-zinc-950 p-2 rounded-lg border border-zinc-800/80">
                  <div className="flex items-center gap-1 text-[9.5px] text-amber-400 font-bold uppercase mb-0.5">
                    <MessageSquare className="w-2.5 h-2.5" />
                    Chat ({breakdown.messageCount} msgs)
                  </div>
                  <div className="text-[11px] font-mono font-bold text-zinc-200">
                    {formatTokenCount(breakdown.messagesTokens)} tokens
                  </div>
                </div>

                <div className="bg-zinc-950 p-2 rounded-lg border border-zinc-800/80">
                  <div className="flex items-center gap-1 text-[9.5px] text-purple-400 font-bold uppercase mb-0.5">
                    <Wrench className="w-2.5 h-2.5" />
                    Ferramentas & MCPs
                  </div>
                  <div className="text-[11px] font-mono font-bold text-zinc-200">
                    {formatTokenCount(breakdown.toolsAndMcpTokens)} tokens
                  </div>
                </div>
              </div>
            </div>

            {/* 3. Compressão Manual */}
            <div className="bg-amber-500/10 border border-amber-500/30 p-2.5 rounded-xl space-y-2">
              <div>
                <h4 className="text-[11px] font-bold text-amber-400 flex items-center gap-1.5">
                  <Minimize2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Comprimir Contexto do Chat</span>
                </h4>
                <p className="text-[10px] text-zinc-300 mt-0.5 leading-tight">
                  Resuma e otimize este chat especificamente para liberar espaço na janela do Gemini.
                </p>
              </div>

              <button
                onClick={handleManualCompress}
                className="w-full py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-[11px] transition shadow-xs cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Comprimir Contexto Agora</span>
              </button>

              {compressionResult && (
                <div
                  className={`p-2 rounded-lg text-[10.5px] flex items-center gap-1.5 ${
                    compressionResult.success
                      ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                      : 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>{compressionResult.message}</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <ContextSettingsView
            messages={messages}
            onUpdateMessages={onUpdateMessages}
            sessions={sessions}
            onUpdateSessionMessages={onUpdateSessionMessages}
            agent={agent}
            activeProject={activeProject}
            projects={projects}
            authorizedDirs={authorizedDirs}
            skills={skills}
            mcpServers={mcpServers}
            contextSettings={contextSettings}
            onUpdateContextSettings={onUpdateContextSettings}
          />
        )}
      </div>
    </div>
  );
};
