import React from 'react';
import {
  Terminal,
  Settings,
  Volume2,
  VolumeX,
  History,
  RefreshCw,
  Activity,
  Square,
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
  onOpenSharedMemory?: () => void;
  onToggleRightSidebar?: () => void;
  onOpenLogs?: () => void;
  activeRightPanelMode?: string | null;
  isRightSidebarOpen?: boolean;
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
  onOpenSharedMemory,
  onToggleRightSidebar,
  onOpenLogs,
  activeRightPanelMode = null,
  isRightSidebarOpen = false,
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
    <header className="h-9 border-b border-zinc-200/90 dark:border-zinc-800 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md px-2 sm:px-3 flex items-center justify-between relative z-20 shrink-0 select-none">
      {/* Brand & CLI Status */}
      <div className="flex items-center gap-1.5">
        <div className="w-6 h-6 rounded bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-2xs shrink-0">
          <Terminal className="w-3.5 h-3.5" />
        </div>
        <div>
          <div className="flex items-center gap-1">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100 text-xs tracking-tight">
              GeminiCLI
            </span>
            <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border border-zinc-200/60 dark:border-zinc-700/60">
              {cliStatus?.version ? `v${cliStatus.version}` : '...'}
            </span>
          </div>
          <div className="flex items-center gap-1 leading-tight">
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
              className="text-[10px] text-zinc-600 dark:text-zinc-300 flex items-center gap-1 cursor-pointer hover:underline"
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
              <RefreshCw className={`w-2.5 h-2.5 ${isCheckingStatus ? 'animate-spin text-blue-500' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Center Nav Title / Branding (Clean) */}
      <div className="hidden sm:flex items-center">
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={onOpenLogs || (() => onOpenSettings('logs'))}
          title="Logs em Tempo Real"
          className={`flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium rounded transition border cursor-pointer ${
            activeRightPanelMode === 'logs'
              ? 'text-white bg-emerald-600 border-emerald-500 shadow-2xs'
              : 'text-emerald-700 dark:text-emerald-400 bg-emerald-50/70 dark:bg-emerald-950/30 hover:bg-emerald-100/70 dark:hover:bg-emerald-900/40 border-emerald-200/70 dark:border-emerald-800/60'
          }`}
        >
          <Activity className="w-3 h-3 animate-pulse" />
          <span>Logs</span>
        </button>

        {onOpenVersions && (
          <button
            onClick={onOpenVersions}
            title="Snapshots de Versões do Projeto"
            className={`flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium rounded transition border cursor-pointer ${
              activeRightPanelMode === 'versions'
                ? 'text-white bg-blue-600 border-blue-500 shadow-2xs'
                : 'text-blue-400 bg-blue-950/40 hover:bg-blue-900/50 border-blue-800/60'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Versões</span>
          </button>
        )}

        <button
          onClick={() => onOpenSettings()}
          title="Configurações"
          className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:opacity-90 transition shadow-2xs cursor-pointer"
        >
          <Settings className="w-3 h-3" />
          <span className="hidden sm:inline">Ajustes</span>
        </button>
      </div>
    </header>
  );
};
