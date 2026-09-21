import React, { useState, useEffect } from 'react';
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

  // CLI update & reinstall state
  const [isUpdatingCli, setIsUpdatingCli] = useState(false);
  const [updateCliResult, setUpdateCliResult] = useState<{ success: boolean; message: string; version?: string; globalNotice?: string } | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);

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

  const handleUpdateCli = async () => {
    setIsUpdatingCli(true);
    setUpdateCliResult(null);
    try {
      const res = await fetch('/api/cli/update', { method: 'POST' });
      const contentType = res.headers.get('content-type');
      if (res.ok && contentType && contentType.includes('application/json')) {
        const data = await res.json();
        if (data.success) {
          setUpdateCliResult({
            success: true,
            message: data.message || `Gemini CLI atualizado com sucesso para v${data.version}!`,
            version: data.version,
            globalNotice: data.globalNotice,
          });
          if (onRefreshStatus) {
            onRefreshStatus();
          }
        } else {
          setUpdateCliResult({
            success: false,
            message: data.error || 'Falha ao atualizar o Gemini CLI',
          });
        }
      } else {
        setUpdateCliResult({
          success: false,
          message: `O servidor retornou um erro HTTP ${res.status}. Tente novamente.`,
        });
      }
    } catch (err: any) {
      setUpdateCliResult({
        success: false,
        message: err.message || 'Erro de conexão ao tentar atualizar o CLI',
      });
    } finally {
      setIsUpdatingCli(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2500);
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
              <div className="space-y-6 max-w-2xl">
                <div>
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Status e Integração do Gemini CLI
                  </h4>
                  <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                    A aplicação executa o binário oficial do Gemini CLI como motor de execução nativo.
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 space-y-3 text-xs">
                  <div className="flex justify-between items-center pb-2 border-b border-zinc-200/60 dark:border-zinc-700/50">
                    <span className="font-semibold text-zinc-800 dark:text-zinc-200">Executável Ativo em Uso:</span>
                    <span className="font-mono font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800">
                      {cliStatus?.cliPath || 'Auto'} ({cliStatus?.version ? `v${cliStatus.version}` : 'Detectando...'})
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    <div className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-zinc-700 dark:text-zinc-300">1. CLI Local do Projeto</span>
                        <span className="font-mono text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                          {cliStatus?.localVersion ? `v${cliStatus.localVersion}` : 'Não detectado'}
                        </span>
                      </div>
                      <p className="font-mono text-[10px] text-zinc-500 truncate" title={cliStatus?.localCliPath || 'node_modules/.bin/gemini'}>
                        {cliStatus?.localCliPath || 'node_modules/.bin/gemini'}
                      </p>
                      {cliStatus?.localCliPath && (
                        <button
                          type="button"
                          onClick={() => handleSelectCliPath(cliStatus.localCliPath!)}
                          disabled={cliStatus.cliPath === cliStatus.localCliPath}
                          className="mt-1 text-[10px] px-2 py-0.5 rounded font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-blue-600 hover:text-white dark:hover:bg-blue-600 transition disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
                        >
                          {cliStatus.cliPath === cliStatus.localCliPath ? '✓ Usando Este' : 'Ativar CLI Local'}
                        </button>
                      )}
                    </div>

                    <div className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-zinc-700 dark:text-zinc-300">2. CLI Global do Sistema</span>
                        <span className="font-mono text-[11px] font-bold text-blue-600 dark:text-blue-400">
                          {cliStatus?.globalVersion ? `v${cliStatus.globalVersion}` : 'Não detectado'}
                        </span>
                      </div>
                      <p className="font-mono text-[10px] text-zinc-500 truncate" title={cliStatus?.globalCliPath || 'gemini (PATH)'}>
                        {cliStatus?.globalCliPath || 'gemini (PATH)'}
                      </p>
                      {cliStatus?.globalCliPath && (
                        <button
                          type="button"
                          onClick={() => handleSelectCliPath(cliStatus.globalCliPath!)}
                          disabled={cliStatus.cliPath === cliStatus.globalCliPath || cliStatus.cliPath === 'gemini'}
                          className="mt-1 text-[10px] px-2 py-0.5 rounded font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-blue-600 hover:text-white dark:hover:bg-blue-600 transition disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
                        >
                          {cliStatus.cliPath === cliStatus.globalCliPath || cliStatus.cliPath === 'gemini' ? '✓ Usando Este' : 'Ativar CLI Global'}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-1">
                    <span className="text-zinc-500">Estado da Conexão CLI:</span>
                    {cliStatus?.available && cliStatus?.connectionState === 'connected' ? (
                      <span className="flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="w-4 h-4" /> Conectado e Operacional
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 font-semibold text-rose-600 dark:text-rose-400">
                        <AlertCircle className="w-4 h-4" /> {cliStatus?.errorMessage || 'Indisponível'}
                      </span>
                    )}
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-zinc-500">Autenticação (Ambiente):</span>
                    {cliStatus?.authConfigured ? (
                      cliStatus.apiValid ? (
                        <span className="flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="w-4 h-4" /> GEMINI_API_KEY Validada {cliStatus.latencyMs !== undefined ? `(${cliStatus.latencyMs}ms)` : ''}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 font-semibold text-amber-600 dark:text-amber-400">
                          <AlertCircle className="w-4 h-4" /> Chave Configurada (Aviso na API)
                        </span>
                      )
                    ) : (
                      <span className="flex items-center gap-1.5 font-semibold text-rose-600 dark:text-rose-400">
                        <AlertCircle className="w-4 h-4" /> Chave Ausente no Ambiente
                      </span>
                    )}
                  </div>
                </div>

                {/* API Environment Status & Live Validation Card */}
                <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/90 shadow-xs space-y-3.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h5 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        <span>GEMINI_API_KEY (Variável de Ambiente)</span>
                        {cliStatus?.authConfigured && (
                          <span className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded font-medium">
                            {cliStatus.apiValid ? 'Validada & Ativa' : 'Detectada no Ambiente'}
                          </span>
                        )}
                      </h5>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                        A autenticação com o Google Gemini é carregada automaticamente a partir das variáveis de ambiente seguras do sistema.
                      </p>
                    </div>
                  </div>

                  <div className="bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded-lg border border-zinc-200/80 dark:border-zinc-700/60 space-y-2 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-zinc-500 dark:text-zinc-400">Origem da Credencial:</span>
                      <span className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300 font-semibold">
                        process.env.GEMINI_API_KEY
                      </span>
                    </div>
                    {cliStatus?.maskedApiKey && (
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-500 dark:text-zinc-400">Chave Lida:</span>
                        <span className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300 font-semibold bg-zinc-200/50 dark:bg-zinc-900/50 px-1.5 py-0.5 rounded">
                          {cliStatus.maskedApiKey}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between items-center">
                      <span className="text-zinc-500 dark:text-zinc-400">Status Operacional:</span>
                      <span className="font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        {cliStatus?.authConfigured ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {cliStatus.apiValid ? 'Verificada e Operacional' : 'Configurada no Servidor'}
                          </>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                            <AlertCircle className="w-3.5 h-3.5" />
                            Defina GEMINI_API_KEY no ambiente
                          </span>
                        )}
                      </span>
                    </div>
                    {cliStatus?.modelTested && (
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-500 dark:text-zinc-400">Modelo Testado:</span>
                        <span className="font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
                          {cliStatus.modelTested}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleTestApiConnection}
                      disabled={isValidatingApi}
                      className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white transition flex items-center gap-1.5 shrink-0 shadow-xs cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isValidatingApi ? 'animate-spin' : ''}`} />
                      {isValidatingApi ? 'Validando conexão com o Google Gemini...' : 'Testar Conexão com a API em Tempo Real'}
                    </button>
                  </div>

                  {apiValidationResult && (
                    <div
                      className={`p-3 rounded-lg text-xs flex items-start gap-2.5 ${
                        apiValidationResult.success
                          ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                          : 'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                      }`}
                    >
                      {apiValidationResult.success ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
                      )}
                      <div>
                        <p className="font-semibold">{apiValidationResult.message}</p>
                        {apiValidationResult.latencyMs !== undefined && (
                          <p className="text-[11px] opacity-80 mt-0.5">
                            Latência de resposta da API: <strong>{apiValidationResult.latencyMs}ms</strong>
                            {apiValidationResult.modelTested && ` • Modelo verificado: ${apiValidationResult.modelTested}`}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500 leading-relaxed">
                    🔒 <strong>Segurança:</strong> A chave de API permanece estritamente no backend do servidor e nunca é trafegada para o cliente.
                  </p>
                </div>

                {/* CLI Reinstall & Update Card */}
                <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/90 shadow-xs space-y-3">
                  <div>
                    <h5 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                      <RefreshCw className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span>Remover Versão Anterior e Instalar Versão Mais Recente</span>
                    </h5>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                      Atualize o binário oficial do Gemini CLI (<code className="font-mono text-zinc-700 dark:text-zinc-300">@google/gemini-cli</code>) para a versão mais recente publicada.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleUpdateCli}
                      disabled={isUpdatingCli}
                      className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isUpdatingCli ? 'animate-spin' : ''}`} />
                      {isUpdatingCli ? 'Atualizando Gemini CLI...' : 'Instalar Versão Mais Recente Agora'}
                    </button>
                  </div>

                  {updateCliResult && (
                    <div className="space-y-2">
                      <div
                        className={`p-3 rounded-lg text-xs flex items-start gap-2.5 ${
                          updateCliResult.success
                            ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                            : 'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                        }`}
                      >
                        {updateCliResult.success ? (
                          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
                        ) : (
                          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                        )}
                        <div className="space-y-1">
                          <p className="font-semibold">{updateCliResult.message}</p>
                          {updateCliResult.version && (
                            <p className="text-[11px] font-mono">Versão ativa do app: v{updateCliResult.version}</p>
                          )}
                        </div>
                      </div>

                      {updateCliResult.globalNotice && (
                        <div className="p-3 rounded-lg text-xs bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 space-y-2">
                          <div className="flex items-center gap-1.5 font-semibold">
                            <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
                            <span>Atualização do CLI Global do Sistema (Ubuntu / Linux)</span>
                          </div>
                          <p className="text-[11px] leading-relaxed">{updateCliResult.globalNotice}</p>
                          <div className="pt-1 flex items-center justify-between">
                            <code className="font-mono text-[10px] bg-amber-100 dark:bg-amber-900/50 px-2 py-1 rounded text-amber-900 dark:text-amber-200">
                              sudo npm install -g @google/gemini-cli@latest
                            </code>
                            <button
                              type="button"
                              onClick={() => copyToClipboard('sudo npm install -g @google/gemini-cli@latest')}
                              className="text-[10px] text-amber-700 dark:text-amber-300 hover:underline flex items-center gap-1 cursor-pointer font-semibold"
                            >
                              <Copy className="w-3 h-3" />
                              {copiedCmd ? 'Copiado!' : 'Copiar Sudo'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/60">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                        Comandos para executar no Terminal (Ubuntu / Linux / Mac):
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(
                            'npm uninstall -g @google/gemini-cli && npm install -g @google/gemini-cli@latest'
                          )
                        }
                        className="text-[10px] flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        <Copy className="w-3 h-3" />
                        {copiedCmd ? 'Copiado!' : 'Copiar Comandos'}
                      </button>
                    </div>
                    <div className="p-3 rounded-lg bg-zinc-900 text-zinc-200 font-mono text-[11px] overflow-x-auto space-y-1.5">
                      <p className="text-zinc-500"># 1. Remover versão anterior globalmente:</p>
                      <p className="text-amber-400">npm uninstall -g @google/gemini-cli</p>
                      <p className="text-zinc-500 pt-1"># 2. Instalar a versão mais recente oficial:</p>
                      <p className="text-emerald-400">npm install -g @google/gemini-cli@latest</p>
                      <p className="text-zinc-500 pt-1"># 3. Confirmar a versão instalada no sistema:</p>
                      <p className="text-blue-400">gemini --version</p>
                    </div>

                    <div className="pt-2 flex items-center justify-between">
                      <span className="text-[11px] text-zinc-500">Deseja atualizar o código da interface gráfica via Git?</span>
                      <button
                        type="button"
                        onClick={() => setActiveTab('git_update')}
                        className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <GitPullRequest className="w-3.5 h-3.5" />
                        <span>Abrir Atualizador Git</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    Modo de Aprovação de Ações (--approval-mode)
                  </label>
                  <select
                    value={approvalMode}
                    onChange={(e: any) => onChangeApprovalMode(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 outline-none"
                  >
                    <option value="default">default - Solicita aprovação para comandos e alterações</option>
                    <option value="auto_edit">auto_edit - Aprova edições de arquivos automaticamente</option>
                    <option value="yolo">yolo - Executa comandos sem confirmações intermediárias</option>
                    <option value="plan">plan - Modo plano / somente leitura</option>
                  </select>
                </div>
              </div>
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
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      Agentes Especializados do Gemini CLI (.gemini/agents/*.md)
                    </h4>
                    <p className="text-xs text-zinc-500 mt-1">
                      Cada agente possui arquivo Markdown com YAML frontmatter reconhecido pelo Gemini CLI.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingAgent({
                          id: '',
                          name: '',
                          displayName: '',
                          role: '',
                          model: 'gemini-3.5-flash-lite',
                          description: '',
                          baseInstructions: '',
                          systemInstructions: '',
                          overrideBasePrompt: false,
                          enabled: true,
                          kind: 'local',
                          tools: ['*'],
                          temperature: 0.2,
                          topP: 0.95,
                          topK: 40,
                          maxOutputTokens: undefined,
                          thinking: false,
                          conceptualProfile: '',
                          maxTurns: 25,
                          statusGrade: 'CONFIGURED',
                        });
                        setIsNewAgent(true);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Novo Agente</span>
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (onResetDefaultAgentsConfig) {
                          await onResetDefaultAgentsConfig();
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shrink-0"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Restaurar Padrões</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {agents.map((agent) => (
                    <div
                      key={agent.id}
                      className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 flex flex-col justify-between group relative"
                    >
                      {!['principal', 'investigator', 'architect', 'auditor', 'tester', 'worker'].includes(agent.id.toLowerCase()) && (
                        <button
                          onClick={async () => {
                            if (confirm(`Deseja realmente remover o agente "${agent.displayName || agent.name}"?`)) {
                              await onDeleteAgent(agent.id);
                            }
                          }}
                          className="absolute top-2 right-2 p-1.5 text-zinc-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <div>
                        <div className="flex items-center justify-between pr-8">
                          <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100">
                            {agent.displayName || agent.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setAgentForModelSelect(agent);
                              setIsModelSelectorOpen(true);
                            }}
                            title="Clique para trocar de modelo pelo catálogo"
                            className="font-mono text-[11px] px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800/60 transition cursor-pointer flex items-center gap-1"
                          >
                            <Cpu className="w-3 h-3" />
                            <span>{agent.model}</span>
                          </button>
                        </div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5 line-clamp-2">
                          {agent.description}
                        </p>
                      </div>

                      <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700/60 flex items-center justify-between">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] text-zinc-400 font-mono">
                            tools: {agent.tools.join(', ')} | max: {agent.maxTurns}
                          </span>
                          {agent.thinking && (
                            <span className="text-[9px] text-emerald-500 font-bold uppercase tracking-tighter">Thinking Enabled</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {onSelectAgent && (
                            <button
                              type="button"
                              onClick={() => onSelectAgent(agent.id)}
                              className={`px-2 py-1 text-xs font-medium rounded-lg transition cursor-pointer flex items-center gap-1 ${
                                selectedAgentId?.toLowerCase() === agent.id.toLowerCase()
                                  ? 'bg-emerald-600 text-white shadow-xs'
                                  : 'bg-zinc-100 dark:bg-zinc-700/60 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600'
                              }`}
                              title={
                                selectedAgentId?.toLowerCase() === agent.id.toLowerCase()
                                  ? 'Agente Principal Ativo no Chat'
                                  : 'Definir como Agente Principal do Chat'
                              }
                            >
                              <Radio className="w-3 h-3" />
                              <span>
                                {selectedAgentId?.toLowerCase() === agent.id.toLowerCase()
                                  ? 'Principal Ativo'
                                  : 'Tornar Principal'}
                              </span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setAgentForModelSelect(agent);
                              setIsModelSelectorOpen(true);
                            }}
                            className="px-2 py-1 text-xs font-medium rounded-lg bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-600 transition cursor-pointer"
                          >
                            Modelo
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingAgent({ ...agent });
                              setIsNewAgent(false);
                            }}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition cursor-pointer"
                          >
                            Editar Agente
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Edit Agent Modal Subview */}
                {editingAgent && (
                  <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-4xl p-6 space-y-4 shadow-2xl overflow-y-auto max-h-[90vh]">
                      <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-4">
                        <div className="flex items-center gap-2">
                          <Bot className="w-5 h-5 text-blue-500" />
                          <h4 className="font-bold text-base">
                            {isNewAgent ? 'Criar Novo Agente Personalizado' : `Editar Agente: ${editingAgent.displayName || editingAgent.name}`}
                          </h4>
                        </div>
                        <button onClick={() => setEditingAgent(null)} className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition">
                          <X className="w-5 h-5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                        {/* Left Column: Identificação */}
                        <div className="space-y-4">
                          <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700/60">
                            <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-3">1. Identificação</label>
                            <div className="space-y-3">
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-[10px] text-zinc-400 mb-1">Nome Interno (ID)</label>
                                  <input
                                    type="text"
                                    disabled={!isNewAgent}
                                    value={editingAgent.name}
                                    onChange={(e) => setEditingAgent({ ...editingAgent, name: e.target.value, id: e.target.value })}
                                    placeholder="ex: meu_agente"
                                    className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs disabled:opacity-50 font-mono"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[10px] text-zinc-400 mb-1">Nome de Exibição</label>
                                  <input
                                    type="text"
                                    value={editingAgent.displayName || ''}
                                    onChange={(e) => setEditingAgent({ ...editingAgent, displayName: e.target.value })}
                                    placeholder="ex: Especialista em React"
                                    className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs"
                                  />
                                </div>
                              </div>
                              <div>
                                <label className="block text-[10px] text-zinc-400 mb-1">Perfil Conceitual</label>
                                <input
                                  type="text"
                                  value={editingAgent.conceptualProfile || ''}
                                  onChange={(e) => setEditingAgent({ ...editingAgent, conceptualProfile: e.target.value })}
                                  placeholder="ex: Minimalista, Técnico, Poético..."
                                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] text-zinc-400 mb-1">Breve Descrição (Metadados)</label>
                                <textarea
                                  rows={2}
                                  value={editingAgent.description}
                                  onChange={(e) => setEditingAgent({ ...editingAgent, description: e.target.value })}
                                  placeholder="Descreva a especialidade deste agente para fins de roteamento..."
                                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs resize-none"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] text-blue-600 dark:text-blue-400 font-bold mb-1 uppercase tracking-tighter">Instruções Básicas (Prompt Principal)</label>
                                <textarea
                                  rows={12}
                                  value={editingAgent.baseInstructions || ''}
                                  onChange={(e) => setEditingAgent({ ...editingAgent, baseInstructions: e.target.value })}
                                  placeholder="Defina as instruções fundamentais e permanentes do agente..."
                                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-[11px] font-mono focus:ring-2 focus:ring-blue-500/20 outline-none leading-relaxed"
                                />
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Right Column: Model & Advanced & Override */}
                        <div className="space-y-4">
                          {/* 2. Configuração de Modelo */}
                          <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700/60">
                            <div className="flex items-center justify-between mb-3">
                              <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-500">2. Configuração de Modelo</label>
                              <button
                                type="button"
                                onClick={() => {
                                  setAgentForModelSelect(editingAgent);
                                  setIsModelSelectorOpen(true);
                                }}
                                className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                              >
                                <Cpu className="w-3 h-3" />
                                Abrir Catálogo
                              </button>
                            </div>
                            <div className="space-y-3">
                              <input
                                type="text"
                                value={editingAgent.model}
                                onChange={(e) => setEditingAgent({ ...editingAgent, model: e.target.value })}
                                className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 font-mono text-xs text-blue-600 dark:text-blue-400 font-bold"
                                placeholder="ex: gemini-3.7-flash"
                              />
                            </div>
                          </div>

                          {/* 3. Configurações Avançadas */}
                          <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700/60">
                            <div className="flex items-center gap-2 mb-3">
                              <Sliders className="w-4 h-4 text-blue-500" />
                              <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-500">3. Configurações Avançadas</label>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                              <div className="space-y-1">
                                <label className="block text-[10px] text-zinc-500">Temperature ({editingAgent.temperature})</label>
                                <input
                                  type="range"
                                  min="0"
                                  max="2"
                                  step="0.1"
                                  value={editingAgent.temperature || 0}
                                  onChange={(e) => setEditingAgent({ ...editingAgent, temperature: parseFloat(e.target.value) })}
                                  className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="block text-[10px] text-zinc-500">Top P ({editingAgent.topP || 0.95})</label>
                                <input
                                  type="range"
                                  min="0"
                                  max="1"
                                  step="0.05"
                                  value={editingAgent.topP || 0.95}
                                  onChange={(e) => setEditingAgent({ ...editingAgent, topP: parseFloat(e.target.value) })}
                                  className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="block text-[10px] text-zinc-500">Top K</label>
                                <input
                                  type="number"
                                  value={editingAgent.topK ?? 40}
                                  onChange={(e) => setEditingAgent({ ...editingAgent, topK: parseInt(e.target.value) })}
                                  className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs font-mono"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="block text-[10px] text-zinc-500">Max Tokens</label>
                                <input
                                  type="number"
                                  value={editingAgent.maxOutputTokens ?? ''}
                                  placeholder="Padrão"
                                  onChange={(e) => {
                                    const val = e.target.value === '' ? undefined : parseInt(e.target.value);
                                    setEditingAgent({ ...editingAgent, maxOutputTokens: val });
                                  }}
                                  className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs font-mono"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="block text-[10px] text-zinc-500">Max Turns</label>
                                <input
                                  type="number"
                                  value={editingAgent.maxTurns || 25}
                                  onChange={(e) => setEditingAgent({ ...editingAgent, maxTurns: parseInt(e.target.value) })}
                                  className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs font-mono"
                                />
                              </div>
                              <div className="flex items-center justify-between col-span-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                                <div className="flex flex-col">
                                  <span className="text-[10px] font-bold text-zinc-700 dark:text-zinc-300">Modo Thinking</span>
                                  <span className="text-[9px] text-zinc-500">Ativa raciocínio em cadeia</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setEditingAgent({ ...editingAgent, thinking: !editingAgent.thinking })}
                                  className={`w-9 h-4.5 rounded-full transition-colors relative flex items-center px-0.5 ${
                                    editingAgent.thinking ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'
                                  }`}
                                >
                                  <div className={`w-3.5 h-3.5 bg-white rounded-full transition-transform ${editingAgent.thinking ? 'translate-x-4.5' : 'translate-x-0'}`} />
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* 4. SYSTEM PROMPT OVERRIDE */}
                          <div className="p-4 rounded-2xl bg-amber-50/40 dark:bg-amber-950/10 border border-amber-200 dark:border-amber-900/30">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <ShieldAlert className="w-4 h-4 text-amber-600" />
                                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">4. System Prompt Override</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[9px] font-bold text-zinc-500 uppercase">Sobrescrever base</span>
                                <button
                                  type="button"
                                  onClick={() => setEditingAgent({ ...editingAgent, overrideBasePrompt: !editingAgent.overrideBasePrompt })}
                                  className={`w-8 h-4 rounded-full transition-colors relative flex items-center px-0.5 ${
                                    editingAgent.overrideBasePrompt ? 'bg-amber-500' : 'bg-zinc-300 dark:bg-zinc-600'
                                  }`}
                                >
                                  <div className={`w-3 h-3 bg-white rounded-full transition-transform ${editingAgent.overrideBasePrompt ? 'translate-x-4' : 'translate-x-0'}`} />
                                </button>
                              </div>
                            </div>
                            <p className="text-[10px] text-amber-700/80 dark:text-amber-400/80 mb-2 leading-relaxed">
                              {editingAgent.overrideBasePrompt 
                                ? '⚠️ MODO SUBSTITUIÇÃO: Este prompt IGNORARÁ as Instruções Básicas.' 
                                : '✨ MODO COMPLEMENTAR: Este prompt será anexado às Instruções Básicas.'}
                            </p>
                            <textarea
                              rows={6}
                              value={editingAgent.systemInstructions}
                              onChange={(e) => setEditingAgent({ ...editingAgent, systemInstructions: e.target.value })}
                              placeholder="Adicione instruções contextuais ou específicas para esta camada..."
                              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-800/50 font-mono text-[11px] text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-amber-500/20 outline-none leading-relaxed"
                            />
                          </div>

                          {/* 5. AGENTE RESERVA (FALLBACK POR COTAS OU SOBRECARGA) */}
                          <div className="p-4 rounded-2xl bg-blue-50/40 dark:bg-blue-950/10 border border-blue-200 dark:border-blue-900/30">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-900 dark:text-blue-300">
                                  5. Agente Reserva (Fallback por Cotas / Sobrecarga)
                                </span>
                              </div>
                              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                                Auto-Failover
                              </span>
                            </div>
                            <p className="text-[10px] text-blue-700/80 dark:text-blue-400/80 mb-2 leading-relaxed">
                              Agente que assumirá automaticamente a solicitação em caso de erro 429 (Cotas Esgotadas) ou 500/503 (Servidor Sobrecarregado).
                            </p>
                            <select
                              value={editingAgent.backupAgentId || ''}
                              onChange={(e) => setEditingAgent({ ...editingAgent, backupAgentId: e.target.value || undefined })}
                              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-blue-200 dark:border-blue-800/50 text-xs text-zinc-800 dark:text-zinc-200 outline-none focus:ring-2 focus:ring-blue-500/20"
                            >
                              <option value="">Nenhum (usar padrão do sistema)</option>
                              {agents
                                .filter((ag) => ag.id.toLowerCase() !== editingAgent.id?.toLowerCase() && ag.name.toLowerCase() !== editingAgent.name?.toLowerCase())
                                .map((ag) => (
                                  <option key={ag.id} value={ag.id}>
                                    {ag.displayName || ag.name} ({ag.model})
                                  </option>
                                ))}
                            </select>
                          </div>
                        </div>
                      </div>

                      <div className="flex justify-end gap-3 pt-6 border-t border-zinc-100 dark:border-zinc-800">
                        <button
                          onClick={() => setEditingAgent(null)}
                          className="px-4 py-2 text-xs font-semibold text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={async () => {
                            if (isNewAgent && !editingAgent.name) {
                              alert('O nome interno do agente é obrigatório.');
                              return;
                            }
                            await onSaveAgent(editingAgent);
                            setEditingAgent(null);
                          }}
                          className="px-6 py-2 text-xs font-bold rounded-xl bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-600/20 transition-all flex items-center gap-2"
                        >
                          <Save className="w-4 h-4" />
                          <span>{isNewAgent ? 'Criar Agente' : 'Salvar Alterações'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 4. SKILLS */}
            {activeTab === 'skills' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      Skills Reais do Gemini CLI (.gemini/skills/*/SKILL.md)
                    </h4>
                    <p className="text-xs text-zinc-500 mt-1">
                      Mapeamento dos fluxos estruturados de desenvolvimento e convenções.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setEditingSkill({
                        name: '',
                        description: '',
                        content: '',
                        enabled: true,
                        statusGrade: 'CONFIGURED',
                      });
                      setIsNewSkill(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Nova Skill</span>
                  </button>
                </div>

                <div className="space-y-3">
                  {skills.map((skill) => (
                    <div
                      key={skill.name}
                      className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-xs text-blue-600 dark:text-blue-400">
                            {skill.name}
                          </span>
                          <span className="text-xs text-zinc-500">— {skill.description}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              setEditingSkill({ ...skill });
                              setIsNewSkill(false);
                            }}
                            className="px-2.5 py-1 text-xs rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200"
                          >
                            Editar
                          </button>
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-xs font-mono text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">
                        {skill.content}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Edit Skill Modal */}
                {editingSkill && (
                  <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4">
                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-xl p-6 space-y-4 shadow-xl">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-sm">
                          {isNewSkill ? 'Criar Nova Skill' : `Editar Skill: ${editingSkill.name}`}
                        </h4>
                        <button onClick={() => setEditingSkill(null)} className="text-zinc-400 hover:text-zinc-600">
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="space-y-3 text-xs">
                        <div>
                          <label className="block text-zinc-500 mb-1">Nome da Skill</label>
                          <input
                            type="text"
                            disabled={!isNewSkill}
                            value={editingSkill.name}
                            onChange={(e) => setEditingSkill({ ...editingSkill, name: e.target.value })}
                            className="w-full px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-zinc-500 mb-1">Descrição</label>
                          <input
                            type="text"
                            value={editingSkill.description}
                            onChange={(e) => setEditingSkill({ ...editingSkill, description: e.target.value })}
                            className="w-full px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700"
                          />
                        </div>
                        <div>
                          <label className="block text-zinc-500 mb-1">Conteúdo do Procedimento (SKILL.md)</label>
                          <textarea
                            rows={6}
                            value={editingSkill.content}
                            onChange={(e) => setEditingSkill({ ...editingSkill, content: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 font-mono text-xs"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-2">
                        <button onClick={() => setEditingSkill(null)} className="px-3 py-1.5 text-xs text-zinc-500">
                          Cancelar
                        </button>
                        <button
                          onClick={async () => {
                            await onSaveSkill(editingSkill);
                            setEditingSkill(null);
                          }}
                          className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white"
                        >
                          Salvar Skill
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 5. COMANDOS */}
            {activeTab === 'commands' && (
              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Comandos Operacionais (.gemini/commands/*.toml)
                  </h4>
                  <p className="text-xs text-zinc-500 mt-1">
                    Atalhos de execução para acionamento direto no chat via autocomplete '/'
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {commands.map((cmd) => (
                    <div
                      key={cmd.name}
                      className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-xs text-blue-600 dark:text-blue-400">
                            {cmd.name}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
                            TOML
                          </span>
                        </div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                          {cmd.description}
                        </p>
                        <pre className="mt-2 p-2 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-[11px] font-mono text-zinc-600 dark:text-zinc-400 line-clamp-3">
                          {cmd.promptTemplate}
                        </pre>
                      </div>

                      <div className="mt-3 flex justify-end">
                        <button
                          onClick={() => setEditingCommand({ ...cmd })}
                          className="px-2.5 py-1 text-xs rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200"
                        >
                          Editar Prompt
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Edit Command Modal */}
                {editingCommand && (
                  <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4">
                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-xl p-6 space-y-4 shadow-xl">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-sm">Editar Comando: {editingCommand.name}</h4>
                        <button onClick={() => setEditingCommand(null)} className="text-zinc-400 hover:text-zinc-600">
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="space-y-3 text-xs">
                        <div>
                          <label className="block text-zinc-500 mb-1">Descrição</label>
                          <input
                            type="text"
                            value={editingCommand.description}
                            onChange={(e) => setEditingCommand({ ...editingCommand, description: e.target.value })}
                            className="w-full px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700"
                          />
                        </div>
                        <div>
                          <label className="block text-zinc-500 mb-1">Template de Prompt Operacional</label>
                          <textarea
                            rows={6}
                            value={editingCommand.promptTemplate}
                            onChange={(e) => setEditingCommand({ ...editingCommand, promptTemplate: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 font-mono text-xs"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-2">
                        <button onClick={() => setEditingCommand(null)} className="px-3 py-1.5 text-xs text-zinc-500">
                          Cancelar
                        </button>
                        <button
                          onClick={async () => {
                            await onSaveCommand(editingCommand);
                            setEditingCommand(null);
                          }}
                          className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white"
                        >
                          Salvar Comando
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 6. MCP */}
            {activeTab === 'mcp' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      Model Context Protocol (MCP) no Gemini CLI
                    </h4>
                    <p className="text-xs text-zinc-500 mt-1">
                      Configuração de servidores MCP em <code className="font-mono">.gemini/settings.json</code>.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setEditingMcp({ name: '', command: '', args: [], enabled: true });
                      setIsNewMcp(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Nova MCP</span>
                  </button>
                </div>

                <div className="space-y-3">
                  {mcpServers.map((server) => {
                    const testState = mcpTestResult[server.name];
                    return (
                      <div
                        key={server.name}
                        className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-xs text-zinc-900 dark:text-zinc-100">
                              {server.name}
                            </span>
                            <span
                              className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${
                                server.enabled
                                  ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400'
                                  : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500'
                              }`}
                            >
                              {server.enabled ? 'Ativo' : 'Desativado'}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => testMcp(server)}
                              disabled={testState?.loading}
                              className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100 transition"
                            >
                              <Play className="w-3 h-3" />
                              <span>{testState?.loading ? 'Testando...' : 'Testar Conexão'}</span>
                            </button>
                            <button
                              onClick={() => {
                                setEditingMcp({ ...server });
                                setIsNewMcp(false);
                              }}
                              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                            >
                              <Sliders className="w-4 h-4" />
                            </button>
                            <button
                              onClick={async () => {
                                if (confirm(`Deseja remover o servidor MCP ${server.name}?`)) {
                                  await onSaveMcpServers(mcpServers.filter((m) => m.name !== server.name));
                                }
                              }}
                              className="p-1.5 rounded-lg text-rose-400 hover:text-rose-600"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <div className="text-xs font-mono bg-white dark:bg-zinc-900 p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300">
                          {server.command ? (
                            <span>{server.command} {server.args?.join(' ')}</span>
                          ) : server.httpUrl ? (
                            <span className="text-blue-600 dark:text-blue-400">HTTP: {server.httpUrl}</span>
                          ) : server.url ? (
                            <span className="text-emerald-600 dark:text-emerald-400">SSE: {server.url}</span>
                          ) : (
                            <span className="text-zinc-400 italic">Sem configuração</span>
                          )}
                        </div>

                        {testState && (
                          <div
                            className={`text-xs p-2.5 rounded-lg flex items-center gap-2 ${
                              testState.success
                                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                                : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                            }`}
                          >
                            {testState.success ? (
                              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                            ) : (
                              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                            )}
                            <div className="flex-1 overflow-auto max-h-48 whitespace-pre-wrap font-mono text-[10px]">
                              {testState.message}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Edit MCP Modal */}
                {editingMcp && (
                  <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4">
                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-xl">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-sm">
                          {isNewMcp ? 'Adicionar Novo Servidor MCP' : `Editar MCP: ${editingMcp.name}`}
                        </h4>
                        <button onClick={() => setEditingMcp(null)} className="text-zinc-400 hover:text-zinc-600">
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="space-y-4 text-xs">
                        <div>
                          <label className="block text-zinc-500 mb-1 font-semibold">Identificador (ID)</label>
                          <input
                            type="text"
                            disabled={!isNewMcp}
                            value={editingMcp.name}
                            onChange={(e) => setEditingMcp({ ...editingMcp, name: e.target.value })}
                            className="w-full px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 font-mono disabled:opacity-50"
                            placeholder="ex: github-mcp"
                          />
                        </div>
                        <div>
                          <label className="block text-zinc-500 mb-1 font-semibold">Comando Executável (Stdio)</label>
                          <input
                            type="text"
                            value={editingMcp.command || ''}
                            onChange={(e) => setEditingMcp({ ...editingMcp, command: e.target.value })}
                            className="w-full px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 font-mono"
                            placeholder="ex: npx, node, python3"
                          />
                        </div>
                        <div>
                          <label className="block text-zinc-500 mb-1 font-semibold">Argumentos (Um por linha)</label>
                          <textarea
                            rows={2}
                            value={editingMcp.args?.join('\n') || ''}
                            onChange={(e) => setEditingMcp({ ...editingMcp, args: e.target.value.split('\n') })}
                            className="w-full px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 font-mono"
                            placeholder="-y&#10;@modelcontextprotocol/server-github"
                          />
                        </div>
                        <div className="pt-1 border-t border-zinc-100 dark:border-zinc-800">
                          <label className="block text-zinc-500 mb-1 font-semibold">HTTP URL (Streamable HTTP)</label>
                          <input
                            type="text"
                            value={editingMcp.httpUrl || ''}
                            onChange={(e) => setEditingMcp({ ...editingMcp, httpUrl: e.target.value })}
                            className="w-full px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 font-mono"
                            placeholder="http://localhost:3001/mcp"
                          />
                        </div>
                        <div>
                          <label className="block text-zinc-500 mb-1 font-semibold">SSE URL (Server-Sent Events)</label>
                          <input
                            type="text"
                            value={editingMcp.url || ''}
                            onChange={(e) => setEditingMcp({ ...editingMcp, url: e.target.value })}
                            className="w-full px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 font-mono"
                            placeholder="http://localhost:3000/sse"
                          />
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                          <input
                            type="checkbox"
                            id="mcp-enabled"
                            checked={editingMcp.enabled}
                            onChange={(e) => setEditingMcp({ ...editingMcp, enabled: e.target.checked })}
                            className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
                          />
                          <label htmlFor="mcp-enabled" className="text-zinc-700 dark:text-zinc-300 font-semibold cursor-pointer">
                            Servidor Ativado
                          </label>
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-2">
                        <button onClick={() => setEditingMcp(null)} className="px-3 py-1.5 text-xs text-zinc-500">
                          Cancelar
                        </button>
                        <button
                          disabled={!editingMcp.name || (!editingMcp.command && !editingMcp.httpUrl && !editingMcp.url)}
                          onClick={async () => {
                            let newList: McpConfig[];
                            if (isNewMcp) {
                              newList = [...mcpServers, editingMcp];
                            } else {
                              newList = mcpServers.map((m) => (m.name === editingMcp.name ? editingMcp : m));
                            }
                            await onSaveMcpServers(newList);
                            setEditingMcp(null);
                          }}
                          className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white disabled:opacity-50"
                        >
                          Salvar Servidor MCP
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 7. POLICIES */}
            {activeTab === 'policies' && (
              <div className="space-y-6 animate-in slide-in-from-right duration-300">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-500" />
                      Motor de Políticas (Policy Engine)
                    </h4>
                    <p className="text-xs text-zinc-500 mt-1">
                      Defina regras de segurança e governança para ferramentas em <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">.gemini/policies/*.toml</code>
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setEditingPolicy({ filename: 'nova-politica.toml', content: '[[rule]]\ntoolName = "*"\ndecision = "ask_user"\npriority = 100\n' });
                      setOriginalFilename(null);
                      setIsNewPolicy(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Nova Política
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {policies.map((policy) => (
                    <div
                      key={policy.filename}
                      className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-mono font-bold text-xs text-emerald-600 dark:text-emerald-400 truncate pr-2">
                            {policy.filename}
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                setEditingPolicy({ ...policy });
                                setOriginalFilename(policy.filename);
                                setIsNewPolicy(false);
                              }}
                              className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 transition"
                              title="Editar Política"
                            >
                              <Code2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeletePolicy(policy.filename)}
                              className="p-1.5 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/30 text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 transition"
                              title="Deletar Política"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="text-[11px] font-mono text-zinc-500 bg-white dark:bg-zinc-900 p-2.5 rounded-lg border border-zinc-100 dark:border-zinc-800 line-clamp-4 overflow-hidden whitespace-pre">
                          {policy.content}
                        </div>
                      </div>
                    </div>
                  ))}
                  {policies.length === 0 && (
                    <div className="col-span-2 py-12 flex flex-col items-center justify-center text-zinc-400 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl">
                      <ShieldCheck className="w-8 h-8 mb-2 opacity-20" />
                      <p className="text-xs">Nenhuma política personalizada encontrada.</p>
                      <p className="text-[10px] mt-1 italic">Crie arquivos .toml para restringir ou autorizar ferramentas.</p>
                    </div>
                  )}
                </div>

                {/* Edit Policy Modal */}
                {editingPolicy && (
                  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-2xl p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="w-5 h-5 text-emerald-500" />
                          <h4 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                            {isNewPolicy ? 'Criar Nova Política' : 'Editar Política'}
                          </h4>
                        </div>
                        <button onClick={() => setEditingPolicy(null)} className="text-zinc-400 hover:text-zinc-600 transition">
                          <X className="w-5 h-5" />
                        </button>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="block text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-1.5">
                            Nome do Arquivo (Deve terminar em .toml)
                          </label>
                          <input
                            type="text"
                            value={editingPolicy.filename}
                            onChange={(e) => setEditingPolicy({ ...editingPolicy, filename: e.target.value })}
                            className="w-full px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 font-mono text-xs text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-emerald-500/20 outline-none transition"
                            placeholder="ex: restrict-shell.toml"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-1.5">
                            Conteúdo da Política (Sintaxe TOML)
                          </label>
                          <div className="relative">
                            <textarea
                              rows={12}
                              value={editingPolicy.content}
                              onChange={(e) => setEditingPolicy({ ...editingPolicy, content: e.target.value })}
                              className="w-full px-4 py-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 font-mono text-xs text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-emerald-500/20 outline-none leading-relaxed transition"
                              placeholder="[[rule]]&#10;toolName = '*'&#10;decision = 'ask_user'&#10;priority = 10"
                            />
                            <div className="absolute top-3 right-3 opacity-20 pointer-events-none">
                              <Code2 className="w-10 h-10" />
                            </div>
                          </div>
                          <p className="text-[10px] text-zinc-500 mt-2 italic text-center">
                            Sintaxe: [[rule]], toolName, decision (allow, deny, ask_user), priority, modes.
                          </p>
                        </div>
                      </div>

                      <div className="flex justify-end gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                        <button
                          onClick={() => setEditingPolicy(null)}
                          className="px-4 py-2 text-xs font-semibold text-zinc-500 hover:text-zinc-700 transition"
                        >
                          Cancelar
                        </button>
                        <button
                          disabled={!editingPolicy.filename || !editingPolicy.filename.endsWith('.toml')}
                          onClick={() => handleSavePolicy(editingPolicy, originalFilename || undefined)}
                          className="px-6 py-2 text-xs font-bold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition shadow-md"
                        >
                          Salvar Política
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
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
              <div className="space-y-6 max-w-2xl animate-in fade-in duration-200">
                <div>
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Configurações de Interface e Aparência
                  </h4>
                  <p className="text-xs text-zinc-500 mt-1">
                    Personalize o visual, o comportamento e os agentes de suporte de áudio da interface do usuário.
                  </p>
                </div>

                {/* Seção 1: Aparência */}
                <div className="space-y-3">
                  <h5 className="text-xs font-bold uppercase font-mono tracking-wider text-zinc-700 dark:text-zinc-300">
                    Aparência (Tema)
                  </h5>
                  <div className="grid grid-cols-2 gap-4">
                    {/* Tema Claro */}
                    <button
                      type="button"
                      onClick={() => onChangeTheme('light')}
                      className={`flex items-center gap-3 p-4 rounded-xl border text-left transition ${
                        theme === 'light'
                          ? 'border-blue-500 bg-blue-500/5 text-blue-600 dark:text-blue-400 font-semibold shadow-xs'
                          : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 text-zinc-700 dark:text-zinc-400 hover:bg-zinc-100/60 dark:hover:bg-zinc-800/40'
                      }`}
                    >
                      <div className={`p-2 rounded-lg ${theme === 'light' ? 'bg-blue-500/10' : 'bg-zinc-200/50 dark:bg-zinc-800'}`}>
                        <Sun className="w-5 h-5 text-amber-500" />
                      </div>
                      <div>
                        <span className="text-xs font-semibold block">Tema Claro</span>
                        <span className="text-[10px] text-zinc-500 block">Fundo claro e alto contraste</span>
                      </div>
                    </button>

                    {/* Tema Escuro */}
                    <button
                      type="button"
                      onClick={() => onChangeTheme('dark')}
                      className={`flex items-center gap-3 p-4 rounded-xl border text-left transition ${
                        theme === 'dark'
                          ? 'border-blue-500 bg-blue-500/5 text-blue-600 dark:text-blue-400 font-semibold shadow-xs'
                          : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 text-zinc-700 dark:text-zinc-400 hover:bg-zinc-100/60 dark:hover:bg-zinc-800/40'
                      }`}
                    >
                      <div className={`p-2 rounded-lg ${theme === 'dark' ? 'bg-blue-500/10' : 'bg-zinc-200/50 dark:bg-zinc-800'}`}>
                        <Moon className="w-5 h-5 text-indigo-400" />
                      </div>
                      <div>
                        <span className="text-xs font-semibold block">Tema Escuro</span>
                        <span className="text-[10px] text-zinc-500 block">Fundo escuro e conforto visual</span>
                      </div>
                    </button>
                  </div>
                </div>

                <hr className="border-zinc-200 dark:border-zinc-800" />

                {/* Seção 2: Agentes Utilizados na Interface */}
                <div className="space-y-4">
                  <h5 className="text-xs font-bold uppercase font-mono tracking-wider text-zinc-700 dark:text-zinc-300">
                    Agentes da Interface (Áudio)
                  </h5>

                  {/* Nova API para Narração e Transcrição */}
                  <div className="space-y-3 p-4 bg-zinc-50/50 dark:bg-zinc-800/30 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/80">
                    <div className="flex items-center gap-2 text-xs font-bold text-zinc-800 dark:text-zinc-200">
                      <Key className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      <span>Configuração de API Dedicada para Áudio</span>
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      Configure uma API diferente com chaves e endpoints alternativos para as funções de áudio (STT e TTS).
                    </p>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                          Chave de API de Áudio (Gemini API Key)
                        </label>
                        <input
                          type="password"
                          value={audioSettings.audioApiKey || ''}
                          onChange={(e) => onUpdateAudioSettings({ audioApiKey: e.target.value })}
                          placeholder="Opcional (Usa padrão se vazio)"
                          className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500 transition"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                          Endpoint Customizado (Base URL)
                        </label>
                        <input
                          type="text"
                          value={audioSettings.audioApiUrl || ''}
                          onChange={(e) => onUpdateAudioSettings({ audioApiUrl: e.target.value })}
                          placeholder="Opcional (Ex: https://api.proxy...)"
                          className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500 transition font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Transcritor (STT) */}
                  <div className="space-y-2 p-4 bg-zinc-50/50 dark:bg-zinc-800/30 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/80">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-bold text-zinc-800 dark:text-zinc-200">
                        Agente de Transcrição / Ditado (STT)
                      </label>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400">
                        Entrada por Voz
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      Converte a sua gravação de voz em texto em tempo real para ser enviado ao terminal.
                    </p>
                    <select
                      value={audioSettings.sttModel}
                      onChange={(e) => onUpdateAudioSettings({ sttModel: e.target.value })}
                      className="w-full mt-1.5 px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
                    >
                      <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash Lite (Padrão do Sistema)</option>
                      <option value="gemini-3.5-transcribe">Gemini 3.5 Transcribe</option>
                      <option value="gemini-3.5-transcribe-live">Gemini 3.5 Transcribe Live (API Live)</option>
                      <option value="gemini-3.5-live-translate">Gemini 3.5 Live Translate (API Live)</option>
                      <option value="gemini-3-flash-live">Gemini 3 Flash Live (API Live)</option>
                      <option value="gemini-2.5-flash-native-audio-dialog">Gemini 2.5 Flash Native Audio Dialog (API Live)</option>
                      <option value="gemini-3.8-flash">Gemini 3.8 Flash (Altamente Estável)</option>
                      <option value="browser-native">Web Speech API (Conversão local do navegador - Instantânea)</option>
                    </select>

                    <div className="mt-2">
                      <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                        Instruções Absolutas do Transcritor
                      </label>
                      <textarea
                        value={audioSettings.sttInstructions || ''}
                        onChange={(e) => onUpdateAudioSettings({ sttInstructions: e.target.value })}
                        placeholder="Ex: Mantenha termos técnicos em inglês, formate como tópicos limpos e aplique pontuação estrita."
                        rows={2}
                        className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                      <p className="text-[10px] text-zinc-500 mt-0.5">
                        Enviadas no topo de cada requisição de transcrição como regras absolutas.
                      </p>
                    </div>
                    
                    {audioSettings.sttModel === 'gemini-3.5-flash-lite' && (
                      <div className="mt-2 text-[10px] bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 p-2.5 rounded-lg flex gap-1.5 leading-normal">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <div>
                          <strong>Nota de Estabilidade:</strong> Se o modelo <code>gemini-3.5-flash-lite</code> apresentar erros ou ficar inativo em sua conta, o sistema ativará automaticamente o fallback para o modelo <code>gemini-3.1-flash-lite</code> e depois <code>gemini-3.5-flash</code>.
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Narrador (TTS) */}
                  <div className="space-y-4 p-4 bg-zinc-50/50 dark:bg-zinc-800/30 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/80">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-bold text-zinc-800 dark:text-zinc-200">
                        Agente de Narração / Leitura (TTS)
                      </label>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        Saída por Voz
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      Lê em voz alta as respostas completadas pelo assistente de IA ou relatórios.
                    </p>
                    <select
                      value={audioSettings.ttsModel}
                      onChange={(e) => onUpdateAudioSettings({ ttsModel: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
                    >
                      <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash Lite (Padrão do Sistema)</option>
                      <option value="gemini-3.1-flash-tts-preview">Gemini 3.1 Flash TTS Preview (Alta Fidelidade)</option>
                      <option value="gemini-3.1-flash-tts">Gemini 3.1 Flash TTS</option>
                      <option value="gemini-2.5-flash-tts">Gemini 2.5 Flash TTS</option>
                      <option value="browser-native">SpeechSynthesis Nativo (Instantâneo - Resposta imediata sem rede)</option>
                    </select>

                    <div className="mt-2">
                      <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                        Instruções Absolutas do Narrador
                      </label>
                      <textarea
                        value={audioSettings.ttsInstructions || ''}
                        onChange={(e) => onUpdateAudioSettings({ ttsInstructions: e.target.value })}
                        placeholder="Ex: Fale pausadamente, adote tom amigável e profissional, leia acrônimos letra por letra."
                        rows={2}
                        className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                      />
                      <p className="text-[10px] text-zinc-500 mt-0.5">
                        Enviadas no topo de cada requisição de narração como regras absolutas.
                      </p>
                    </div>

                    {audioSettings.ttsModel !== 'browser-native' && (
                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <div>
                          <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                            Voz Neural Gemini
                          </label>
                          <select
                            value={audioSettings.ttsVoice}
                            onChange={(e) => onUpdateAudioSettings({ ttsVoice: e.target.value })}
                            className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 font-mono"
                          >
                            {['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'].map((v) => (
                              <option key={v} value={v}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                            Velocidade de Fala
                          </label>
                          <select
                            value={audioSettings.ttsSpeed || 1.0}
                            onChange={(e) => onUpdateAudioSettings({ ttsSpeed: parseFloat(e.target.value) })}
                            className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
                          >
                            <option value="0.75">Lento (0.75x)</option>
                            <option value="1.0">Normal (1.0x)</option>
                            <option value="1.2">Rápido (1.2x)</option>
                            <option value="1.5">Muito Rápido (1.5x)</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {audioSettings.ttsModel !== 'browser-native' && (
                      <div className="text-[10px] bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-300 p-2.5 rounded-lg flex gap-1.5 leading-normal">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <div>
                          <strong>Nota sobre Latência:</strong> A voz neural premium da API Gemini gera áudio com entonação humana ultra-realista, mas possui um pequeno tempo de processamento de rede para ser gerado. Se preferir fala imediata (atraso zero), altere o modelo acima para <strong>SpeechSynthesis Nativo</strong>.
                        </div>
                      </div>
                    )}

                    <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5">
                      <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={audioSettings.autoPlayTts}
                          onChange={(e) => onUpdateAudioSettings({ autoPlayTts: e.target.checked })}
                          className="rounded border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500"
                        />
                        <span>Reproduzir narração automaticamente ao concluir respostas</span>
                      </label>

                      <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={audioSettings.filterCodeInTts}
                          onChange={(e) => onUpdateAudioSettings({ filterCodeInTts: e.target.checked })}
                          className="rounded border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500"
                        />
                        <span>Omitir blocos de código extensos durante a leitura falada</span>
                      </label>
                    </div>
                  </div>
                </div>

                <hr className="border-zinc-200 dark:border-zinc-800" />

                {/* Seção 3: Outras Opções Gráficas */}
                <div className="space-y-3">
                  <h5 className="text-xs font-bold uppercase font-mono tracking-wider text-zinc-700 dark:text-zinc-300">
                    Opções Gráficas Adicionais
                  </h5>
                  <div className="p-4 bg-zinc-50/50 dark:bg-zinc-800/30 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/80 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 block">Efeitos Visuais e Transições</span>
                        <span className="text-[10px] text-zinc-500 block">Controla as animações de mudança de página e carregamento do terminal</span>
                      </div>
                      <select
                        defaultValue="normal"
                        className="px-3 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
                      >
                        <option value="normal">Animações Suaves (Padrão)</option>
                        <option value="compact">Reduzido (Para menor uso de CPU)</option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-zinc-200 dark:border-zinc-800">
                      <div>
                        <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 block">Densidade de Informação do Layout</span>
                        <span className="text-[10px] text-zinc-500 block">Ajusta o espaçamento interno das listas de arquivos e logs</span>
                      </div>
                      <select
                        defaultValue="comfort"
                        className="px-3 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
                      >
                        <option value="comfort">Confortável (Espaçamento amplo)</option>
                        <option value="compact">Compacto (Maximiza espaço em tela)</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 10. EMPACOTAMENTO E MATRIZ DE VALIDAÇÃO */}
            {activeTab === 'packaging' && (
              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Empacotamento Standalone para Ubuntu Linux & Matriz de Validação
                  </h4>
                  <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                    Gera pacote .deb e tarball independente para instalação direta em qualquer Ubuntu Linux.
                  </p>
                </div>

                {/* Build Package Button */}
                <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-800/30 flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 block">
                      Gerar Pacote de Distribuição (.deb & standalone tarball)
                    </span>
                    <span className="text-[11px] text-zinc-500">
                      Inclui binário wrapper /usr/bin/gemini-gui, atalho desktop e instalador autônomo.
                    </span>
                  </div>
                  <button
                    onClick={handleBuildPackage}
                    disabled={isBuildingPackage}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs transition"
                  >
                    <Package className="w-4 h-4" />
                    <span>{isBuildingPackage ? 'Compilando...' : 'Gerar Pacote Ubuntu'}</span>
                  </button>
                </div>

                {packagingOutput && (
                  <div className="p-4 rounded-xl border border-emerald-500/40 bg-emerald-50/30 dark:bg-emerald-950/20 text-xs space-y-2">
                    <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-semibold">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{packagingOutput.message}</span>
                    </div>
                    <ul className="list-disc list-inside text-zinc-600 dark:text-zinc-400 font-mono text-[11px]">
                      {packagingOutput.files.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                    <div className="mt-2 text-zinc-700 dark:text-zinc-300 font-semibold">
                      Instruções: {packagingOutput.instructions}
                    </div>
                  </div>
                )}

                {/* Validation Matrix Table */}
                <div>
                  <h5 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
                    Matriz de Validação e Distinção Obrigatória de Estados
                  </h5>
                  <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-zinc-100 dark:bg-zinc-800/80 text-zinc-500 font-semibold text-[11px] uppercase border-b border-zinc-200 dark:border-zinc-800">
                        <tr>
                          <th className="p-3">Recurso / Componente</th>
                          <th className="p-3">Categoria</th>
                          <th className="p-3">Estado Formal</th>
                          <th className="p-3">Evidência / Observação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                        {matrix.map((row, idx) => (
                          <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                            <td className="p-3 font-medium text-zinc-800 dark:text-zinc-200">{row.item}</td>
                            <td className="p-3 font-mono text-[11px] text-zinc-500">{row.category}</td>
                            <td className="p-3">
                              <span
                                className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded ${
                                  row.status === 'TESTED'
                                    ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                                    : row.status === 'CONFIGURED'
                                    ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                                    : row.status === 'VALIDATED'
                                    ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
                                    : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400'
                                }`}
                              >
                                {row.status}
                              </span>
                            </td>
                            <td className="p-3 text-[11px] text-zinc-500 leading-relaxed">
                              {row.evidence}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
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
