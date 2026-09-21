import React, { useState } from 'react';
import {
  Sparkles,
  Layers,
  Sliders,
  CheckCircle2,
  Minimize2,
  Trash2,
  RefreshCw,
  Cpu,
  Info,
  ShieldAlert,
  Zap,
  BarChart2,
  FileText,
  FolderGit2,
  MessageSquare,
  Wrench,
} from 'lucide-react';
import {
  ChatMessage,
  AgentConfig,
  ProjectItem,
  AuthorizedDir,
  SkillConfig,
  McpConfig,
} from '../types.js';
import {
  ContextSettings,
  DEFAULT_CONTEXT_SETTINGS,
  calculateContextBreakdown,
  compressContextMessages,
  formatTokenCount,
} from '../utils/tokenUtils.js';

interface ContextSettingsViewProps {
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

export const ContextSettingsView: React.FC<ContextSettingsViewProps> = ({
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

  const breakdown = calculateContextBreakdown(
    messages,
    agent,
    activeProject,
    authorizedDirs,
    skills,
    mcpServers,
    contextSettings.maxContextWindow
  );

  const handleManualCompress = () => {
    if (messages.length === 0) {
      setCompressionResult({
        success: false,
        message: 'A conversa atual está vazia. Nenhuma compressão necessária.',
      });
      return;
    }

    const { compressedMessages, tokensSaved, originalTokens, newTokens } = compressContextMessages(
      messages,
      contextSettings
    );

    if (tokensSaved <= 0) {
      setCompressionResult({
        success: true,
        message: 'O contexto atual já está otimizado e dentro do limite configurado.',
      });
      return;
    }

    onUpdateMessages(compressedMessages);
    const savingsPercent = Math.round((tokensSaved / originalTokens) * 100);

    setCompressionResult({
      success: true,
      message: `Compressão concluída com sucesso! Contexto reduzido de ${formatTokenCount(
        originalTokens
      )} para ${formatTokenCount(newTokens)} tokens (${savingsPercent}% de economia = ${formatTokenCount(
        tokensSaved
      )} tokens salvos).`,
      tokensSaved,
    });
  };

  const estimateProjectTokens = (proj: ProjectItem) => {
    const nameT = Math.ceil((proj.name || '').length / 4);
    const descT = Math.ceil((proj.description || '').length / 4);
    const dirsT = Math.ceil(((proj.associatedDirs || []).join(', ').length) / 4);
    const guideT = Math.ceil((proj.guidelines?.length || 0) / 4);
    return { nameT, descT, dirsT, guideT, total: nameT + descT + dirsT + guideT };
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Title & Intro */}
      <div className="border-b border-zinc-200 dark:border-zinc-800 pb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              Gerenciamento & Compressão de Contexto
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Estruture o contexto enviado ao agente Gemini e configure a compressão inteligente para evitar estouro de limite de tokens.
            </p>
          </div>
        </div>
      </div>

      {/* Live Context Inspector */}
      <div className="bg-zinc-50 dark:bg-zinc-800/50 p-4 rounded-2xl border border-zinc-200/80 dark:border-zinc-700/60 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase font-mono tracking-wider text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
            <BarChart2 className="w-4 h-4 text-blue-500" />
            Estrutura do Contexto Atual Enviado ao Agente
          </h4>
          <span className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-lg">
            Total: {formatTokenCount(breakdown.totalActiveTokens)} / {formatTokenCount(breakdown.maxContextWindow)} tokens
          </span>
        </div>

        {/* Usage Progress Bar */}
        <div className="space-y-1">
          <div className="w-full bg-zinc-200 dark:bg-zinc-700 h-3 rounded-full overflow-hidden flex">
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

          <div className="flex items-center justify-between text-[11px] text-zinc-500 font-mono pt-1">
            <span>Uso da Janela: {breakdown.utilizationPercent}%</span>
            <span>Janela Máxima: 1.000.000 tokens (Gemini 1.5/3.5/3.6)</span>
          </div>
        </div>

        {/* Breakdown Items Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
          <div className="bg-white dark:bg-zinc-900 p-2.5 rounded-xl border border-zinc-200/60 dark:border-zinc-800">
            <div className="flex items-center gap-1.5 text-[10px] text-indigo-600 dark:text-indigo-400 font-bold uppercase mb-1">
              <FileText className="w-3 h-3" />
              System Prompt
            </div>
            <div className="text-xs font-mono font-bold text-zinc-800 dark:text-zinc-200">
              {formatTokenCount(breakdown.systemInstructionsTokens)} tokens
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 p-2.5 rounded-xl border border-zinc-200/60 dark:border-zinc-800">
            <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase mb-1">
              <FolderGit2 className="w-3 h-3" />
              Projeto & Pastas
            </div>
            <div className="text-xs font-mono font-bold text-zinc-800 dark:text-zinc-200">
              {formatTokenCount(breakdown.projectContextTokens)} tokens
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 p-2.5 rounded-xl border border-zinc-200/60 dark:border-zinc-800">
            <div className="flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400 font-bold uppercase mb-1">
              <MessageSquare className="w-3 h-3" />
              Chat ({breakdown.messageCount} msgs)
            </div>
            <div className="text-xs font-mono font-bold text-zinc-800 dark:text-zinc-200">
              {formatTokenCount(breakdown.messagesTokens)} tokens
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 p-2.5 rounded-xl border border-zinc-200/60 dark:border-zinc-800">
            <div className="flex items-center gap-1.5 text-[10px] text-purple-600 dark:text-purple-400 font-bold uppercase mb-1">
              <Wrench className="w-3 h-3" />
              Ferramentas & MCPs
            </div>
            <div className="text-xs font-mono font-bold text-zinc-800 dark:text-zinc-200">
              {formatTokenCount(breakdown.toolsAndMcpTokens)} tokens
            </div>
          </div>
        </div>
      </div>

      {/* Statistics by Project */}
      <div className="space-y-4">
        <h4 className="text-xs font-bold uppercase font-mono tracking-wider text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
          <Layers className="w-4 h-4 text-emerald-500" />
          Estatísticas de Contexto por Projeto
        </h4>
        
        <div className="grid grid-cols-1 gap-3">
          {projects.map((proj) => {
            const stats = estimateProjectTokens(proj);
            const isActive = activeProject?.id === proj.id;
            
            return (
              <div 
                key={proj.id} 
                className={`p-4 rounded-2xl border transition-all ${
                  isActive 
                    ? 'bg-emerald-500/5 border-emerald-500/40 shadow-sm' 
                    : 'bg-zinc-50/50 dark:bg-zinc-800/30 border-zinc-200 dark:border-zinc-800'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100">{proj.name}</span>
                    {isActive && (
                      <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        Ativo
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-mono font-bold text-zinc-500">
                    Total Estimado: {formatTokenCount(stats.total)} tokens
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[10px] font-mono">
                  <div className="flex flex-col">
                    <span className="text-zinc-500 uppercase mb-0.5 text-[9px]">Nome/Desc</span>
                    <span className="text-zinc-800 dark:text-zinc-200">{formatTokenCount(stats.nameT + stats.descT)} tokens</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-zinc-500 uppercase mb-0.5 text-[9px]">Diretórios</span>
                    <span className="text-zinc-800 dark:text-zinc-200">{formatTokenCount(stats.dirsT)} tokens</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-zinc-500 uppercase mb-0.5 text-[9px]">Guidelines</span>
                    <span className="text-zinc-800 dark:text-zinc-200">{formatTokenCount(stats.guideT)} tokens</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-zinc-500 uppercase mb-0.5 text-[9px]">Mensagem Média</span>
                    <span className="text-zinc-800 dark:text-zinc-200">~150 tokens</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Manual Compression Action */}
      <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h4 className="text-xs font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
            <Minimize2 className="w-4 h-4" />
            Ação Manual: Comprimir Contexto da Conversa
          </h4>
          <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-0.5">
            Compacta o histórico do chat atual com base na estratégia selecionada mantendo pontos cruciais do contexto.
          </p>
        </div>
        <button
          onClick={handleManualCompress}
          className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs transition shadow-sm shrink-0 cursor-pointer flex items-center gap-1.5"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Comprimir Contexto Agora</span>
        </button>
      </div>

      {compressionResult && (
        <div
          className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
            compressionResult.success
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
              : 'bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{compressionResult.message}</span>
        </div>
      )}

      {/* Auto Compression Settings Form */}
      <div className="space-y-4">
        <h4 className="text-xs font-bold uppercase font-mono tracking-wider text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
          <Sliders className="w-4 h-4 text-blue-500" />
          Configuração de Compressão Automática
        </h4>

        <div className="space-y-3 bg-zinc-50 dark:bg-zinc-800/40 p-4 rounded-2xl border border-zinc-200/80 dark:border-zinc-700/60">
          {/* Toggle Auto Compress */}
          <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-700/60">
            <div>
              <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 block">
                Habilitar Compressão Automática de Contexto
              </span>
              <span className="text-[11px] text-zinc-500 block">
                Comprime o contexto em segundo plano automaticamente ao atingir o gatilho.
              </span>
            </div>
            <input
              type="checkbox"
              checked={contextSettings.autoCompress}
              onChange={(e) => onUpdateContextSettings({ autoCompress: e.target.checked })}
              className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
            />
          </div>

          {/* Strategy Selection */}
          <div className="space-y-1.5 pt-1">
            <label className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 block">
              Estratégia de Compressão
            </label>
            <select
              value={contextSettings.strategy}
              onChange={(e) =>
                onUpdateContextSettings({
                  strategy: e.target.value as ContextSettings['strategy'],
                })
              }
              className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-xl px-3 py-2 text-xs font-medium text-zinc-800 dark:text-zinc-200 outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="summarize_old">
                🧠 Resumo Sintético de Conversas Antigas (Recomendado)
              </option>
              <option value="truncate_tools">
                ✂️ Truncamento Inteligente de Outputs de Ferramentas & Logs
              </option>
              <option value="keep_recent_only">
                📌 Manter Apenas N Mensagens Recentes + System Prompt
              </option>
            </select>
          </div>

          {/* Threshold sliders */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div>
              <label className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 block mb-1">
                Gatilho por Limiar de Tokens: {formatTokenCount(contextSettings.compressionThresholdTokens)} tokens
              </label>
              <input
                type="range"
                min={20000}
                max={500000}
                step={10000}
                value={contextSettings.compressionThresholdTokens}
                onChange={(e) =>
                  onUpdateContextSettings({
                    compressionThresholdTokens: Number(e.target.value),
                  })
                }
                className="w-full accent-blue-600 cursor-pointer"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 block mb-1">
                Mensagens Recentes Preservadas: {contextSettings.recentMessagesToKeep} mensagens
              </label>
              <input
                type="range"
                min={4}
                max={30}
                step={2}
                value={contextSettings.recentMessagesToKeep}
                onChange={(e) =>
                  onUpdateContextSettings({
                    recentMessagesToKeep: Number(e.target.value),
                  })
                }
                className="w-full accent-blue-600 cursor-pointer"
              />
            </div>
          </div>

          {/* Strict Preservation Options */}
          <div className="pt-2 border-t border-zinc-200 dark:border-zinc-700/60 space-y-2">
            <span className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 uppercase font-mono block">
              Regras de Preservação Estrita
            </span>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="pres_sys"
                checked={contextSettings.preserveSystemPrompt}
                onChange={(e) => onUpdateContextSettings({ preserveSystemPrompt: e.target.checked })}
                className="w-3.5 h-3.5 rounded text-blue-600 cursor-pointer"
              />
              <label htmlFor="pres_sys" className="text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
                Nunca comprimir ou remover Instruções do Sistema (System Prompt)
              </label>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="pres_proj"
                checked={contextSettings.preserveProjectContext}
                onChange={(e) => onUpdateContextSettings({ preserveProjectContext: e.target.checked })}
                className="w-3.5 h-3.5 rounded text-blue-600 cursor-pointer"
              />
              <label htmlFor="pres_proj" className="text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
                Nunca remover Contexto do Projeto & Diretórios Autorizados
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
