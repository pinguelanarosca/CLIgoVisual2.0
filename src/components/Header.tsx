import React from 'react';
import {
  Terminal,
  Settings,
  Volume2,
  VolumeX,
  RefreshCw,
  Activity,
  Square,
  History,
  Brain,
  PanelRight,
} from 'lucide-react';
import { CliStatus, ProjectItem, AgentConfig, ChatMessage, AuthorizedDir, SkillConfig, McpConfig } from '../types.js';
import { TokenMonitorBar } from './TokenMonitorBar.js';

interface HeaderProps {
  cliStatus: CliStatus | null;
  projects: ProjectItem[];
  activeProject: ProjectItem | null;
  onSelectProject: (proj: ProjectItem) => void;
  onOpenProjectsModal: () => void;
  agents: AgentConfig[];
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
  activeView: 'chat' | 'diffs';
  onSelectView: (view: 'chat' | 'diffs') => void;
  onOpenDirsModal: () => void;
  onOpenHistory: () => void;
  onOpenSettings: (tab?: string) => void;
  onOpenVersions?: () => void;
  onOpenMemory?: () => void;
  isRightDrawerOpen?: boolean;
  onToggleRightDrawer?: () => void;
  autoPlayTts: boolean;
  onToggleAutoPlayTts: () => void;
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  onRefreshStatus: () => void;
  isCheckingStatus: boolean;
  messages?: ChatMessage[];
  isStreaming?: boolean;
  onCancelExecution?: () => void;
  authorizedDirs?: AuthorizedDir[];
  skills?: SkillConfig[];
  mcpServers?: McpConfig[];
  metrics?: { rpm: number; tpm: number; rpd: number };
}

export const Header: React.FC<HeaderProps> = ({
  cliStatus,
  projects,
  activeProject,
  onSelectProject,
  onOpenProjectsModal,
  agents,
  selectedAgentId,
  onSelectAgent,
  activeView,
  onSelectView,
  onOpenDirsModal,
  onOpenHistory,
  onOpenSettings,
  onOpenVersions,
  onOpenMemory,
  isRightDrawerOpen = false,
  onToggleRightDrawer,
  autoPlayTts,
  onToggleAutoPlayTts,
  onRefreshStatus,
  isCheckingStatus,
  messages = [],
  isStreaming = false,
  onCancelExecution,
  authorizedDirs = [],
  skills = [],
  mcpServers = [],
  metrics = { rpm: 1, tpm: 0, rpd: 1 },
}) => {
  return (
    <header className="h-13 border-b border-zinc-200/90 dark:border-zinc-800 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md px-3 sm:px-4 flex items-center justify-between relative z-20 shrink-0 select-none">
      {/* Brand & CLI Status */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-2xs shrink-0">
          <Terminal className="w-4 h-4" />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100 text-xs tracking-tight">
              GeminiCLI
            </span>
            <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border border-zinc-200/60 dark:border-zinc-700/60">
              {cliStatus?.version ? `v${cliStatus.version}` : '...'}
            </span>
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                isCheckingStatus
                  ? 'bg-blue-500 animate-pulse'
                  : !cliStatus?.authConfigured
                  ? 'bg-rose-500'
                  : cliStatus?.apiValid === false
                  ? 'bg-amber-500 animate-pulse'
                  : 'bg-emerald-500 shadow-2xs shadow-emerald-500/40'
              }`}
            />
            <div
              className="text-[11px] text-zinc-600 dark:text-zinc-300 flex items-center gap-1 cursor-pointer hover:underline"
              onClick={() => onOpenSettings('cli')}
              title={
                cliStatus?.apiError
                  ? `Erro: ${cliStatus.apiError}`
                  : cliStatus?.apiValid
                  ? `API conectada (${cliStatus.modelTested || 'gemini-3.1-flash-lite'})`
                  : 'Configurações da API'
              }
            >
              {isCheckingStatus ? (
                <span className="text-zinc-400">Sincronizando...</span>
              ) : !cliStatus?.authConfigured ? (
                <span className="text-rose-600 dark:text-rose-400 font-medium">Sem Chave</span>
              ) : cliStatus?.apiValid === false ? (
                <span className="text-amber-600 dark:text-amber-400 font-medium">
                  {cliStatus.apiError?.includes('429') || cliStatus.apiError?.includes('quota')
                    ? 'Cota 429'
                    : 'Aviso API'}
                </span>
              ) : (
                <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                  API Ativa
                </span>
              )}

              {cliStatus?.apiValid && cliStatus?.latencyMs !== undefined && (
                <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-mono">
                  {cliStatus.latencyMs}ms
                </span>
              )}
            </div>

            <button
              onClick={onRefreshStatus}
              disabled={isCheckingStatus}
              title="Revalidar conexão"
              className="text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 ml-0.5 transition cursor-pointer p-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <RefreshCw className={`w-3 h-3 ${isCheckingStatus ? 'animate-spin text-blue-500' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Center Nav Views */}
      <div className="hidden sm:flex items-center">
        <div className="flex items-center gap-0.5 bg-zinc-100/90 dark:bg-zinc-800/60 p-0.5 rounded-lg border border-zinc-200/80 dark:border-zinc-800">
          <button
            onClick={() => onSelectView('chat')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition cursor-pointer ${
              activeView === 'chat'
                ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-2xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            Terminal & Chat
          </button>
          <button
            onClick={() => onSelectView('diffs')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition cursor-pointer ${
              activeView === 'diffs'
                ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-2xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            Arquivos & Diffs
          </button>
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-1 sm:gap-1.5">
        <button
          onClick={() => onOpenSettings('logs')}
          title="Logs em Tempo Real"
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md text-emerald-700 dark:text-emerald-400 bg-emerald-50/70 dark:bg-emerald-950/30 hover:bg-emerald-100/70 dark:hover:bg-emerald-900/40 transition border border-emerald-200/70 dark:border-emerald-800/60 cursor-pointer"
        >
          <Activity className="w-3 h-3 text-emerald-600 dark:text-emerald-400 animate-pulse" />
          <span>Logs</span>
        </button>

        {isStreaming && (
          <button
            onClick={onCancelExecution}
            title="Interromper execução"
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-md text-white bg-rose-600 hover:bg-rose-700 transition shadow-2xs animate-pulse cursor-pointer"
          >
            <Square className="w-2.5 h-2.5 fill-current" />
            <span>PARAR</span>
          </button>
        )}

        {/* Versões (App Versions) Button */}
        <button
          onClick={onOpenVersions}
          title="App Versions (Snapshots de Código)"
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md text-indigo-300 bg-indigo-950/40 hover:bg-indigo-900/50 transition border border-indigo-500/30 cursor-pointer shadow-2xs"
        >
          <History className="w-3.5 h-3.5 text-indigo-400" />
          <span className="hidden sm:inline">Versões</span>
        </button>

        {/* Memória Compartilhada Button */}
        <button
          onClick={onOpenMemory}
          title="Memória Compartilhada Persistente"
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md text-teal-300 bg-teal-950/40 hover:bg-teal-900/50 transition border border-teal-500/30 cursor-pointer shadow-2xs"
        >
          <Brain className="w-3.5 h-3.5 text-teal-400" />
          <span className="hidden sm:inline">Memória</span>
        </button>

        <button
          onClick={onToggleAutoPlayTts}
          title={autoPlayTts ? 'TTS Ativo' : 'TTS Desativado'}
          className={`p-1.5 rounded-md transition border border-zinc-200/60 dark:border-zinc-800 cursor-pointer ${
            autoPlayTts
              ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
              : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
          }`}
        >
          {autoPlayTts ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
        </button>

        <button
          onClick={() => onOpenSettings()}
          title="Configurações"
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:opacity-90 transition shadow-2xs cursor-pointer"
        >
          <Settings className="w-3 h-3" />
          <span className="hidden sm:inline">Ajustes</span>
        </button>

        {/* 3rd Column Drawer Toggle Button */}
        {onToggleRightDrawer && (
          <button
            onClick={onToggleRightDrawer}
            title={isRightDrawerOpen ? 'Ocultar Painel Lateral (3ª Coluna)' : 'Exibir Painel de Payloads & Contexto (3ª Coluna)'}
            className={`p-1.5 rounded-md transition border cursor-pointer ${
              isRightDrawerOpen
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/40 shadow-2xs'
                : 'text-zinc-400 hover:text-white border-zinc-200/60 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            <PanelRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </header>
  );
};
