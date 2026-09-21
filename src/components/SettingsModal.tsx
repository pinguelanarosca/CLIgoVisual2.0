import React, { useState, useEffect } from 'react';
import { CliSettingsSection } from './settings/CliSettingsSection.js';
import { AgentsSettingsSection } from './settings/AgentsSettingsSection.js';
import { SkillsSettingsSection } from './settings/SkillsSettingsSection.js';
import { CommandsSettingsSection } from './settings/CommandsSettingsSection.js';
import { McpSettingsSection } from './settings/McpSettingsSection.js';
import { PoliciesSettingsSection } from './settings/PoliciesSettingsSection.js';
import { AudioSettingsSection } from './settings/AudioSettingsSection.js';
import { VoicePresetsSection } from './settings/VoicePresetsSection.js';
import { PackagingSettingsSection } from './settings/PackagingSettingsSection.js';
import {
  Settings,
  Terminal,
  Cpu,
  Bot,
  Sparkles,
  Code2,
  Layers,
  Shield,
  Volume2,
  Package,
  X,
  Check,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Play,
  Save,
  Plus,
  Trash2,
  RefreshCw,
  ExternalLink,
  ShieldAlert,
  ShieldCheck,
  Radio,
  Sliders,
  Copy,
  GitPullRequest,
  GitBranch,
  Activity,
  Paintbrush,
  Sun,
  Moon,
  Key,
} from 'lucide-react';
import {
  CliStatus,
  AgentConfig,
  SkillConfig,
  CommandConfig,
  McpConfig,
  PolicyConfig,
  AudioSettings,
  ValidationItem,
} from '../types.js';
import { ModelSelectorModal } from './ModelSelectorModal.js';
import { ModelCatalogView } from './ModelCatalogView.js';
import { GitUpdaterView } from './GitUpdaterView.js';
import { RealtimeLogsView } from './RealtimeLogsView.js';
import { ContextSettingsView } from './ContextSettingsView.js';
import { ContextSettings, DEFAULT_CONTEXT_SETTINGS } from '../utils/tokenUtils.js';
import { ChatMessage, ProjectItem, AuthorizedDir } from '../types.js';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: string;
  cliStatus: CliStatus | null;
  agents: AgentConfig[];
  onSaveAgent: (agent: AgentConfig) => Promise<void>;
  onDeleteAgent: (id: string) => Promise<void>;
  skills: SkillConfig[];
  onSaveSkill: (skill: SkillConfig) => Promise<void>;
  onDeleteSkill: (name: string) => Promise<void>;
  commands: CommandConfig[];
  onSaveCommand: (cmd: CommandConfig) => Promise<void>;
  onDeleteCommand: (name: string) => Promise<void>;
  mcpServers: McpConfig[];
  onSaveMcpServers: (servers: McpConfig[]) => Promise<void>;
  onTestMcp: (mcp: McpConfig) => Promise<{ success: boolean; message: string }>;
  audioSettings: AudioSettings;
  onUpdateAudioSettings: (updates: Partial<AudioSettings>) => void;
  approvalMode: 'default' | 'auto_edit' | 'yolo' | 'plan';
  onChangeApprovalMode: (mode: 'default' | 'auto_edit' | 'yolo' | 'plan') => void;
  onRefreshStatus?: () => void;
  onResetDefaultAgentsConfig?: () => Promise<void>;
  messages?: ChatMessage[];
  onUpdateMessages?: (newMessages: ChatMessage[]) => void;
  activeProject?: ProjectItem | null;
  authorizedDirs?: AuthorizedDir[];
  contextSettings?: ContextSettings;
  onUpdateContextSettings?: (updates: Partial<ContextSettings>) => void;
  theme: 'dark' | 'light';
  onChangeTheme: (theme: 'dark' | 'light') => void;
  projects: ProjectItem[];
  selectedAgentId?: string;
  onSelectAgent?: (id: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'cli',
  cliStatus,
  agents,
  onSaveAgent,
  onDeleteAgent,
  skills,
  onSaveSkill,
  onDeleteSkill,
  commands,
  onSaveCommand,
  onDeleteCommand,
  mcpServers,
  onSaveMcpServers,
  onTestMcp,
  audioSettings,
  onUpdateAudioSettings,
  approvalMode,
  onChangeApprovalMode,
  onRefreshStatus,
  onResetDefaultAgentsConfig,
  messages = [],
  onUpdateMessages = () => {},
  activeProject = null,
  authorizedDirs = [],
  contextSettings = DEFAULT_CONTEXT_SETTINGS,
  onUpdateContextSettings = () => {},
  theme,
  onChangeTheme,
  projects = [],
  selectedAgentId,
  onSelectAgent,
}) => {
  const [activeTab, setActiveTab] = useState<string>(initialTab);

  // API Live Validation state
  const [isValidatingApi, setIsValidatingApi] = useState(false);
  const [validationModel, setValidationModel] = useState<string>('gemini-3.1-flash-lite');
  const [apiValidationResult, setApiValidationResult] = useState<{
    success: boolean;
    message: string;
    latencyMs?: number;
    modelTested?: string;
  } | null>(null);

  const handleTestApiConnection = async () => {
    setIsValidatingApi(true);
    setApiValidationResult(null);
    try {
      const res = await fetch(`/api/api-key/validate?model=${encodeURIComponent(validationModel)}`);
      const contentType = res.headers.get('content-type');
      if (res.ok && contentType && contentType.includes('application/json')) {
        const data = await res.json();
        setApiValidationResult({
          success: Boolean(data.valid),
          message: data.message || (data.valid ? 'Conexão com a API validada com sucesso!' : 'Falha na validação com a API'),
          latencyMs: data.latencyMs,
          modelTested: data.modelTested,
        });
        if (onRefreshStatus) {
          onRefreshStatus();
        }
      } else {
        setApiValidationResult({
          success: false,
          message: `Falha na requisição: ${res.status}`,
        });
      }
    } catch (err: any) {
      setApiValidationResult({
        success: false,
        message: err.message || 'Erro ao comunicar com o endpoint de validação',
      });
    } finally {
      setIsValidatingApi(false);
    }
  };

  // Validation Matrix State
  const [matrix, setMatrix] = useState<ValidationItem[]>([]);
  const [isBuildingPackage, setIsBuildingPackage] = useState(false);
  const [packagingOutput, setPackagingOutput] = useState<{
    success: boolean;
    message: string;
    files: string[];
    instructions: string;
  } | null>(null);

  // Agent editing
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
  const [isNewAgent, setIsNewAgent] = useState(false);
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const [agentForModelSelect, setAgentForModelSelect] = useState<AgentConfig | null>(null);

  // Skill editing
  const [editingSkill, setEditingSkill] = useState<SkillConfig | null>(null);
  const [isNewSkill, setIsNewSkill] = useState(false);

  // Command editing
  const [editingCommand, setEditingCommand] = useState<CommandConfig | null>(null);

  // MCP editing state
  const [editingMcp, setEditingMcp] = useState<McpConfig | null>(null);
  const [isNewMcp, setIsNewMcp] = useState(false);

  // MCP testing state
  const [mcpTestResult, setMcpTestResult] = useState<{ [name: string]: { loading: boolean; message: string; success?: boolean } }>({});

  // Policy editing state
  const [policies, setPolicies] = useState<PolicyConfig[]>([]);
  const [editingPolicy, setEditingPolicy] = useState<PolicyConfig | null>(null);
  const [originalFilename, setOriginalFilename] = useState<string | null>(null);
  const [isNewPolicy, setIsNewPolicy] = useState(false);

  const loadLocalPolicies = async () => {
    try {
      const res = await fetch('/api/policies');
      const data = await res.json();
      setPolicies(data);
    } catch (err) {
      console.error('Falha ao carregar políticas:', err);
    }
  };

  const handleSavePolicy = async (policy: PolicyConfig, oldFilename?: string) => {
    try {
      const method = oldFilename ? 'PUT' : 'POST';
      const url = oldFilename ? `/api/policies/${oldFilename}` : '/api/policies';
      const body = oldFilename ? { newFilename: policy.filename, content: policy.content } : policy;
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        loadLocalPolicies();
        setEditingPolicy(null);
      }
    } catch (err) {
      console.error('Falha ao salvar política:', err);
    }
  };

  const handleDeletePolicy = async (filename: string) => {
    if (!confirm(`Tem certeza que deseja deletar a política "${filename}"?`)) return;
    try {
      const res = await fetch(`/api/policies/${filename}`, { method: 'DELETE' });
      if (res.ok) {
        loadLocalPolicies();
      }
    } catch (err) {
      console.error('Falha ao deletar política:', err);
    }
  };

  const handleSelectCliPath = async (newPath: string) => {
    try {
      await fetch('/api/cli/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliPath: newPath }),
      });
      if (onRefreshStatus) {
        onRefreshStatus();
      }
    } catch (err) {
      console.error('Falha ao alterar caminho do CLI:', err);
    }
  };

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (isOpen) {
      fetch('/api/packaging/matrix')
        .then((res) => res.json())
        .then((data) => setMatrix(data))
        .catch(console.error);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && activeTab === 'policies') {
      loadLocalPolicies();
    }
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  const handleBuildPackage = async () => {
    setIsBuildingPackage(true);
    setPackagingOutput(null);
    try {
      const res = await fetch('/api/packaging/build', { method: 'POST' });
      const data = await res.json();
      setPackagingOutput(data);
    } catch (err: any) {
      setPackagingOutput({
        success: false,
        message: err.message,
        files: [],
        instructions: '',
      });
    } finally {
      setIsBuildingPackage(false);
    }
  };

  const testMcp = async (mcp: McpConfig) => {
    setMcpTestResult((prev) => ({ ...prev, [mcp.name]: { loading: true, message: 'Testando processo...' } }));
    try {
      const res = await onTestMcp(mcp);
      setMcpTestResult((prev) => ({
        ...prev,
        [mcp.name]: { loading: false, message: res.message, success: res.success },
      }));
    } catch (err: any) {
      setMcpTestResult((prev) => ({
        ...prev,
        [mcp.name]: { loading: false, message: err.message, success: false },
      }));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col h-[85vh]">
        {/* Header */}
        <div className="px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between shrink-0 bg-zinc-50/50 dark:bg-zinc-900/50">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Settings className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 text-xs sm:text-sm">
                Configurações do Gemini CLI
              </h3>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                Gerencie motor, agentes, contexto, comandos e interface
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body with Sidebar Tabs */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar Tabs */}
          <div className="w-48 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40 p-1.5 space-y-0.5 overflow-y-auto shrink-0">
            {[
              { id: 'cli', label: 'Gemini CLI', icon: Terminal },
              { id: 'context', label: 'Contexto & Tokens', icon: Sparkles },
              { id: 'models', label: 'Modelos & Catálogo', icon: Cpu },
              { id: 'agents', label: 'Agentes (6)', icon: Bot },
              { id: 'skills', label: 'Skills (4)', icon: Sparkles },
              { id: 'commands', label: 'Comandos (6)', icon: Code2 },
              { id: 'mcp', label: 'MCP (GitHub)', icon: Layers },
              { id: 'policies', label: 'Políticas de IA', icon: ShieldCheck },
              { id: 'voice', label: 'Voz (Narrador)', icon: Volume2 },
              { id: 'hooks', label: 'Hooks Operacionais', icon: Sliders },
              { id: 'permissions', label: 'Permissões & Modos', icon: Shield },
              { id: 'interface', label: 'Aparência & Tema', icon: Paintbrush },
              { id: 'packaging', label: 'Empacotamento', icon: Package },
              { id: 'git_update', label: 'Atualizações', icon: GitPullRequest },
              { id: 'logs', label: 'Logs do CLI', icon: Activity },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 transition cursor-pointer ${
                    isActive
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 font-semibold'
                      : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate text-xs">{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Tab Content Area */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 bg-white dark:bg-zinc-900">
            {/* 1. GEMINI CLI */}
            {activeTab === 'cli' && (
              <CliSettingsSection
                cliStatus={cliStatus}
                approvalMode={approvalMode}
                onChangeApprovalMode={onChangeApprovalMode}
                onRefreshStatus={onRefreshStatus}
                onNavigateToTab={setActiveTab}
              />
            )}

            {/* 2. MODELOS */}
            {activeTab === 'models' && (
              <div className="space-y-6 max-w-4xl">
                <div>
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Catálogo de Modelos, Cotas e Mapeamento
                  </h4>
                  <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                    Prioridade oficial por cotas (RPM / TPM / RPD), especialidades operacionais e configuração padrão dos agentes.
                  </p>
                </div>
                <ModelCatalogView
                  agents={agents}
                  selectedAgentId={selectedAgentId}
                  onSelectAgent={onSelectAgent}
                  onResetDefaultAgentsConfig={onResetDefaultAgentsConfig || (async () => {})}
                  onSaveAgent={onSaveAgent}
                />
              </div>
            )}

            {/* 3. AGENTES */}
            {activeTab === 'agents' && (
              <AgentsSettingsSection
                agents={agents}
                selectedAgentId={selectedAgentId}
                onSelectAgent={onSelectAgent}
                onSaveAgent={onSaveAgent}
                onDeleteAgent={onDeleteAgent}
                onResetDefaultAgentsConfig={onResetDefaultAgentsConfig}
                onOpenModelSelectorForAgent={(ag) => {
                  setAgentForModelSelect(ag);
                  setIsModelSelectorOpen(true);
                }}
              />
            )}

            {/* 4. SKILLS */}
            {activeTab === 'skills' && (
              <SkillsSettingsSection
                skills={skills}
                onSaveSkill={onSaveSkill}
                onDeleteSkill={onDeleteSkill}
              />
            )}

            {/* 5. COMANDOS */}
            {activeTab === 'commands' && (
              <CommandsSettingsSection
                commands={commands}
                onSaveCommand={onSaveCommand}
                onDeleteCommand={onDeleteCommand}
              />
            )}

            {/* 6. MCP */}
            {activeTab === 'mcp' && (
              <McpSettingsSection
                mcpServers={mcpServers}
                onSaveMcpServers={onSaveMcpServers}
                onTestMcp={onTestMcp}
              />
            )}

            {/* 7. POLICIES */}
            {activeTab === 'policies' && (
              <PoliciesSettingsSection
                policies={policies}
                onSavePolicy={handleSavePolicy}
                onDeletePolicy={handleDeletePolicy}
              />
            )}

            {/* 7.5 VOICE */}
            {activeTab === 'voice' && (
              <VoicePresetsSection
                audioSettings={audioSettings}
                onUpdateAudioSettings={onUpdateAudioSettings}
              />
            )}

            {/* 7. HOOKS */}
            {activeTab === 'hooks' && (
              <div className="space-y-6 max-w-2xl animate-in slide-in-from-right duration-300">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-amber-500" />
                      Hooks e Acionadores de Eventos do Gemini CLI
                    </h4>
                    <p className="text-xs text-zinc-500 mt-1">
                      Gerencie como o CLI reage a eventos internos e integrações externas.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 font-mono uppercase">
                      Sistema Ativo
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  {/* Migration Hook */}
                  <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800">
                          <RefreshCw className="w-3.5 h-3.5 text-blue-500" />
                        </div>
                        <span className="font-semibold text-xs text-zinc-800 dark:text-zinc-200">
                          gemini hooks migrate
                        </span>
                      </div>
                      <span className="text-[9px] uppercase font-bold px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                        Totalmente Suportado
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500 leading-relaxed">
                      Este hook migra automaticamente configurações de ambiente legado (Claude Code, Aider, etc) para a estrutura <code className="bg-zinc-200 dark:bg-zinc-700 px-1 rounded">.gemini/</code>.
                    </p>
                    <button className="text-[10px] font-bold text-blue-600 hover:underline flex items-center gap-1">
                      Executar migração assistida <ExternalLink className="w-2.5 h-2.5" />
                    </button>
                  </div>

                  {/* Tool Lifecycle Hooks */}
                  <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-xs text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                          <Code2 className="w-3.5 h-3.5 text-purple-500" />
                          Tool Lifecycle Hooks
                        </span>
                        <span className="text-[9px] uppercase font-bold px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                          Configuração Parcial
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-500">
                        Scripts personalizados executados antes ou depois da invocação de ferramentas.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-700">
                        <span className="text-[11px] font-mono text-zinc-600 dark:text-zinc-400">pre-tool-call</span>
                        <span className="text-[10px] text-zinc-400 italic">Nenhum script definido</span>
                      </div>
                      <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-700">
                        <span className="text-[11px] font-mono text-zinc-600 dark:text-zinc-400">post-tool-call</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-emerald-500 font-bold uppercase">audit-check.sh</span>
                          <Check className="w-3 h-3 text-emerald-500" />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Custom System Notifications Hook */}
                  <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800">
                          <Activity className="w-3.5 h-3.5 text-rose-500" />
                        </div>
                        <span className="font-semibold text-xs text-zinc-800 dark:text-zinc-200">
                          Runtime Event Stream
                        </span>
                      </div>
                      <span className="text-[9px] uppercase font-bold px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-500 border border-zinc-300 dark:border-zinc-600">
                        Desativado
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500 leading-relaxed">
                      Streaming de eventos de execução para webhooks externos ou logs de sistema. Atualmente limitado por restrições de sandbox de iFrame.
                    </p>
                  </div>
                </div>

                <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900/30 bg-amber-50/30 dark:bg-amber-950/10">
                  <div className="flex gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                    <div>
                      <h5 className="text-xs font-bold text-amber-800 dark:text-amber-400">Nota sobre Validação Headless</h5>
                      <p className="text-[11px] text-amber-700 dark:text-amber-500 mt-1 leading-relaxed">
                        Em conformidade com a distinção de estados: a estrutura de configuração em <code className="font-mono">settings.json</code> está pronta, mas o disparo em stream-json headless sem extensão de terminal interativo está classificado como <strong>NOT VALIDATED</strong>.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 8. PERMISSÕES */}
            {activeTab === 'permissions' && (
              <div className="space-y-6 max-w-2xl">
                <div>
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Permissões de Execução e Segurança
                  </h4>
                  <p className="text-xs text-zinc-500 mt-1">
                    Definição das restrições de comandos, modificação de arquivos e operações Git.
                  </p>
                </div>

                <div className="space-y-3 text-xs">
                  {[
                    { title: 'Comandos de Shell', desc: 'Permite que o Gemini CLI execute comandos no terminal do Ubuntu.', def: true },
                    { title: 'Gravação de Arquivos', desc: 'Permite criar e sobrescrever arquivos nos diretórios autorizados.', def: true },
                    { title: 'Operações Git', desc: 'Permite diffs e preparação de commits validados.', def: true },
                    { title: 'Execução de MCP', desc: 'Permite invocar ferramentas expostas por servidores MCP registrados.', def: true },
                    { title: 'Ações Destrutivas (rm -rf, git reset)', desc: 'Exige confirmação manual obrigatória independente do modo.', def: false },
                  ].map((perm) => (
                    <div
                      key={perm.title}
                      className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center justify-between"
                    >
                      <div>
                        <div className="font-semibold text-zinc-800 dark:text-zinc-200">{perm.title}</div>
                        <div className="text-zinc-500 text-[11px]">{perm.desc}</div>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                        Ativo
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 9. INTERFACE E APARÊNCIA */}
            {activeTab === 'interface' && (
              <AudioSettingsSection
                audioSettings={audioSettings}
                onUpdateAudioSettings={onUpdateAudioSettings}
                theme={theme}
                onChangeTheme={onChangeTheme}
              />
            )}

            {/* 10. EMPACOTAMENTO E MATRIZ DE VALIDAÇÃO */}
            {activeTab === 'packaging' && (
              <PackagingSettingsSection
                isBuildingPackage={isBuildingPackage}
                handleBuildPackage={handleBuildPackage}
                packagingOutput={packagingOutput}
                matrix={matrix}
              />
            )}

            {/* 11. ATUALIZAÇÃO DO APLICATIVO VIA GIT */}
            {activeTab === 'git_update' && (
              <GitUpdaterView onRefreshGlobalStatus={onRefreshStatus} />
            )}

            {/* CONTEXTO & COMPRESSÃO */}
            {activeTab === 'context' && (
              <ContextSettingsView
                messages={messages}
                onUpdateMessages={onUpdateMessages}
                agent={agents?.find((a) => a.enabled) || agents?.[0]}
                activeProject={activeProject}
                projects={projects}
                authorizedDirs={authorizedDirs}
                skills={skills}
                mcpServers={mcpServers}
                contextSettings={contextSettings}
                onUpdateContextSettings={onUpdateContextSettings}
              />
            )}

            {/* 12. LOGS DO SISTEMA EM TEMPO REAL */}
            {activeTab === 'logs' && (
              <RealtimeLogsView />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:opacity-90 transition"
          >
            Fechar
          </button>
        </div>
      </div>

      {/* Model Selector Modal */}
      <ModelSelectorModal
        isOpen={isModelSelectorOpen}
        onClose={() => {
          setIsModelSelectorOpen(false);
          setAgentForModelSelect(null);
        }}
        currentModel={editingAgent?.model || agentForModelSelect?.model || 'gemini-3.5-flash-lite'}
        agentName={editingAgent?.displayName || editingAgent?.name || agentForModelSelect?.displayName || agentForModelSelect?.name}
        onSelectModel={async (modelId) => {
          if (editingAgent) {
            setEditingAgent({ ...editingAgent, model: modelId });
          } else if (agentForModelSelect) {
            const updated = { ...agentForModelSelect, model: modelId };
            await onSaveAgent(updated);
          }
        }}
      />
    </div>
  );
};
