import React, { useState, useRef } from 'react';
import {
  Database,
  Download,
  Upload,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Bot,
  MessageSquare,
  Sparkles,
  Terminal,
  Server,
  Shield,
  FolderGit2,
  Settings,
  CheckSquare,
  Square,
  Loader2,
  AlertCircle,
  X,
  Info,
  Layers,
} from 'lucide-react';
import {
  BackupExportData,
  BackupSectionOptions,
  RestoreBackupResult,
  FactoryResetResult,
} from '../types';

interface BackupAndResetSectionProps {
  onRefreshGlobalStatus?: () => void;
}

const DEFAULT_EXPORT_SECTIONS: BackupSectionOptions = {
  generalSettings: true,
  agents: true,
  chatHistory: true,
  skills: true,
  commands: true,
  mcpServers: true,
  policies: true,
  projects: true,
  authorizedDirs: true,
};

export const BackupAndResetSection: React.FC<BackupAndResetSectionProps> = ({
  onRefreshGlobalStatus,
}) => {
  // Export state
  const [exportSections, setExportSections] = useState<BackupSectionOptions>(DEFAULT_EXPORT_SECTIONS);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  // Restore state
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [parsedBackupData, setParsedBackupData] = useState<BackupExportData | null>(null);
  const [restoreSections, setRestoreSections] = useState<BackupSectionOptions>(DEFAULT_EXPORT_SECTIONS);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<RestoreBackupResult | null>(null);
  const [isRestoreConfirmOpen, setIsRestoreConfirmOpen] = useState(false);
  const [restoreFileError, setRestoreFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Factory Reset state
  const [isFactoryResetModalOpen, setIsFactoryResetModalOpen] = useState(false);
  const [factoryResetConfirmInput, setFactoryResetConfirmInput] = useState('');
  const [isResettingFactory, setIsResettingFactory] = useState(false);
  const [factoryResetResult, setFactoryResetResult] = useState<FactoryResetResult | null>(null);

  // --- BACKUP EXPORT HANDLER ---
  const handleExportBackup = async () => {
    setIsExporting(true);
    setExportMessage(null);
    try {
      const activeSections = Object.entries(exportSections)
        .filter(([_, val]) => val)
        .map(([key]) => key);

      if (activeSections.length === 0) {
        setExportMessage('⚠️ Selecione pelo menos uma opção para exportar.');
        setIsExporting(false);
        return;
      }

      const res = await fetch(`/api/system/backup/export?sections=${encodeURIComponent(activeSections.join(','))}`);
      if (!res.ok) {
        throw new Error(`Falha ao exportar backup (Status ${res.status})`);
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.download = `gemini-gui-backup-${timestamp}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setExportMessage('✅ Arquivo de backup exportado e baixado com sucesso!');
      setTimeout(() => setExportMessage(null), 6000);
    } catch (err: any) {
      setExportMessage(`❌ Erro na exportação: ${err.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleSelectAllExport = (select: boolean) => {
    setExportSections({
      generalSettings: select,
      agents: select,
      chatHistory: select,
      skills: select,
      commands: select,
      mcpServers: select,
      policies: select,
      projects: select,
      authorizedDirs: select,
    });
  };

  // --- BACKUP RESTORE HANDLERS ---
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processSelectedFile(file);
  };

  const processSelectedFile = (file: File) => {
    setRestoreFile(file);
    setRestoreFileError(null);
    setRestoreResult(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const data = JSON.parse(text) as BackupExportData;

        if (!data || typeof data !== 'object') {
          throw new Error('O conteúdo do arquivo não é um objeto JSON válido.');
        }

        setParsedBackupData(data);

        // Pre-configure checkboxes based on what's available in the file
        setRestoreSections({
          generalSettings: !!data.generalSettings,
          agents: Array.isArray(data.agents) && data.agents.length > 0,
          chatHistory: Array.isArray(data.sessions) && data.sessions.length > 0,
          skills: Array.isArray(data.skills) && data.skills.length > 0,
          commands: Array.isArray(data.commands) && data.commands.length > 0,
          mcpServers: Array.isArray(data.mcpServers) && data.mcpServers.length > 0,
          policies: Array.isArray(data.policies) && data.policies.length > 0,
          projects: Array.isArray(data.projects) && data.projects.length > 0,
          authorizedDirs: Array.isArray(data.authorizedDirs) && data.authorizedDirs.length > 0,
        });
      } catch (err: any) {
        setRestoreFileError(`Arquivo inválido: ${err.message}`);
        setParsedBackupData(null);
      }
    };
    reader.onerror = () => {
      setRestoreFileError('Erro ao ler arquivo.');
      setParsedBackupData(null);
    };
    reader.readAsText(file);
  };

  const handleRestoreSubmit = async () => {
    if (!parsedBackupData) return;
    setIsRestoring(true);
    setRestoreResult(null);
    setIsRestoreConfirmOpen(false);

    try {
      const res = await fetch('/api/system/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backupData: parsedBackupData,
          selectedSections: restoreSections,
        }),
      });

      const data = (await res.json()) as RestoreBackupResult;
      setRestoreResult(data);

      if (data.success) {
        if (onRefreshGlobalStatus) {
          onRefreshGlobalStatus();
        }
      }
    } catch (err: any) {
      setRestoreResult({
        success: false,
        message: `Falha na requisição de restauração: ${err.message}`,
        restoredSections: [],
      });
    } finally {
      setIsRestoring(false);
    }
  };

  // --- FACTORY RESET HANDLER ---
  const handleFactoryResetSubmit = async () => {
    setIsResettingFactory(true);
    setFactoryResetResult(null);
    try {
      const res = await fetch('/api/system/reset-factory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = (await res.json()) as FactoryResetResult;
      setFactoryResetResult(data);
      if (data.success) {
        setIsFactoryResetModalOpen(false);
        setFactoryResetConfirmInput('');
        if (onRefreshGlobalStatus) {
          onRefreshGlobalStatus();
        }
      }
    } catch (err: any) {
      setFactoryResetResult({
        success: false,
        message: `Falha ao restaurar padrões de fábrica: ${err.message}`,
      });
    } finally {
      setIsResettingFactory(false);
    }
  };

  const sectionsCount = Object.values(exportSections).filter(Boolean).length;

  return (
    <div className="space-y-6">
      {/* SECTION HEADER */}
      <div className="flex items-center justify-between pb-2 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Database className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span>Backup, Restauração e Padrões de Fábrica</span>
          </h4>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Exporte suas configurações e histórico de chat, restaure backups para sobrescrever configurações ou redefina para os padrões de fábrica.
          </p>
        </div>
      </div>

      {/* 1. BACKUP EXPORT CARD */}
      <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/90 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Criar Backup do Sistema (Exportar JSON)
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => handleSelectAllExport(true)}
              className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            >
              Selecionar Todos
            </button>
            <span className="text-zinc-300 dark:text-zinc-700">|</span>
            <button
              type="button"
              onClick={() => handleSelectAllExport(false)}
              className="text-zinc-500 dark:text-zinc-400 hover:underline cursor-pointer"
            >
              Desmarcar Todos
            </button>
          </div>
        </div>

        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          Escolha quais partes e dados você deseja incluir no arquivo de backup:
        </p>

        {/* Checkbox Options Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
          {/* General Settings */}
          <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/40 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/70 transition cursor-pointer">
            <input
              type="checkbox"
              checked={exportSections.generalSettings}
              onChange={(e) =>
                setExportSections({ ...exportSections, generalSettings: e.target.checked })
              }
              className="mt-0.5 rounded text-blue-600 focus:ring-0"
            />
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                <Settings className="w-3.5 h-3.5 text-zinc-500" />
                Configurações Gerais
              </span>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                Preferências de modelos e ambiente
              </p>
            </div>
          </label>

          {/* Agents */}
          <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/40 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/70 transition cursor-pointer">
            <input
              type="checkbox"
              checked={exportSections.agents}
              onChange={(e) =>
                setExportSections({ ...exportSections, agents: e.target.checked })
              }
              className="mt-0.5 rounded text-blue-600 focus:ring-0"
            />
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                <Bot className="w-3.5 h-3.5 text-indigo-500" />
                Agentes e Personas
              </span>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                Instruções, prompts e parâmetros
              </p>
            </div>
          </label>

          {/* Chat History */}
          <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/40 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/70 transition cursor-pointer">
            <input
              type="checkbox"
              checked={exportSections.chatHistory}
              onChange={(e) =>
                setExportSections({ ...exportSections, chatHistory: e.target.checked })
              }
              className="mt-0.5 rounded text-blue-600 focus:ring-0"
            />
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-emerald-500" />
                Histórico de Conversas
              </span>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                Todas as sessões e mensagens do chat
              </p>
            </div>
          </label>

          {/* Skills */}
          <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/40 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/70 transition cursor-pointer">
            <input
              type="checkbox"
              checked={exportSections.skills}
              onChange={(e) =>
                setExportSections({ ...exportSections, skills: e.target.checked })
              }
              className="mt-0.5 rounded text-blue-600 focus:ring-0"
            />
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                Skills e Fluxos
              </span>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                Habilidades ativas e customizadas
              </p>
            </div>
          </label>

          {/* Commands */}
          <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/40 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/70 transition cursor-pointer">
            <input
              type="checkbox"
              checked={exportSections.commands}
              onChange={(e) =>
                setExportSections({ ...exportSections, commands: e.target.checked })
              }
              className="mt-0.5 rounded text-blue-600 focus:ring-0"
            />
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-purple-500" />
                Comandos / Slash
              </span>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                Atalhos rápidos (/debug, /review)
              </p>
            </div>
          </label>

          {/* MCP Servers */}
          <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/40 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/70 transition cursor-pointer">
            <input
              type="checkbox"
              checked={exportSections.mcpServers}
              onChange={(e) =>
                setExportSections({ ...exportSections, mcpServers: e.target.checked })
              }
              className="mt-0.5 rounded text-blue-600 focus:ring-0"
            />
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-blue-500" />
                Servidores MCP
              </span>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                Conectores Model Context Protocol
              </p>
            </div>
          </label>

          {/* Policies */}
          <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/40 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/70 transition cursor-pointer">
            <input
              type="checkbox"
              checked={exportSections.policies}
              onChange={(e) =>
                setExportSections({ ...exportSections, policies: e.target.checked })
              }
              className="mt-0.5 rounded text-blue-600 focus:ring-0"
            />
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-rose-500" />
                Políticas de Segurança
              </span>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                Regras e restrições de ferramentas
              </p>
            </div>
          </label>

          {/* Projects & Workspaces */}
          <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/40 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/70 transition cursor-pointer">
            <input
              type="checkbox"
              checked={exportSections.projects}
              onChange={(e) =>
                setExportSections({ ...exportSections, projects: e.target.checked })
              }
              className="mt-0.5 rounded text-blue-600 focus:ring-0"
            />
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                <FolderGit2 className="w-3.5 h-3.5 text-cyan-500" />
                Projetos e Workspaces
              </span>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                Estrutura de projetos registrados
              </p>
            </div>
          </label>

          {/* Authorized Directories */}
          <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/40 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/70 transition cursor-pointer">
            <input
              type="checkbox"
              checked={exportSections.authorizedDirs}
              onChange={(e) =>
                setExportSections({ ...exportSections, authorizedDirs: e.target.checked })
              }
              className="mt-0.5 rounded text-blue-600 focus:ring-0"
            />
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-emerald-500" />
                Diretórios Autorizados
              </span>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                Pastas locais com permissão de acesso
              </p>
            </div>
          </label>
        </div>

        {/* Action Button & Feedback */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={handleExportBackup}
            disabled={isExporting || sectionsCount === 0}
            className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer shadow-xs"
          >
            {isExporting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>Baixar Backup ({sectionsCount} selecionados)</span>
          </button>

          {exportMessage && (
            <span
              className={`text-xs font-medium ${
                exportMessage.startsWith('✅')
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {exportMessage}
            </span>
          )}
        </div>
      </div>

      {/* 2. BACKUP RESTORE CARD */}
      <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/90 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Restaurar a partir de Arquivo de Backup (.json)
            </span>
          </div>
          {parsedBackupData && (
            <button
              type="button"
              onClick={() => {
                setParsedBackupData(null);
                setRestoreFile(null);
                setRestoreResult(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
              className="text-[11px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3 h-3" />
              <span>Limpar arquivo</span>
            </button>
          )}
        </div>

        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          Carregue um arquivo JSON de backup previamente exportado. Você poderá selecionar exatamente quais seções deseja sobrescrever.
        </p>

        {/* File Upload Selector */}
        <div className="flex items-center gap-3">
          <input
            type="file"
            ref={fileInputRef}
            accept=".json,application/json"
            onChange={handleFileChange}
            className="hidden"
            id="backup-file-upload-input"
          />
          <label
            htmlFor="backup-file-upload-input"
            className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700/60 text-zinc-700 dark:text-zinc-300 transition cursor-pointer shadow-xs"
          >
            <FileText className="w-3.5 h-3.5 text-blue-500" />
            <span>{restoreFile ? restoreFile.name : 'Selecionar Arquivo de Backup (.json)'}</span>
          </label>

          {restoreFile && (
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono">
              ({(restoreFile.size / 1024).toFixed(1)} KB)
            </span>
          )}
        </div>

        {restoreFileError && (
          <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{restoreFileError}</span>
          </div>
        )}

        {/* Preview of Backup Data & Checkboxes for selective restoration */}
        {parsedBackupData && (
          <div className="p-3.5 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/80 dark:border-zinc-700/80 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200/60 dark:border-zinc-700/60 pb-2">
              <div className="space-y-0.5">
                <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  Arquivo analisado com sucesso
                </span>
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                  Criado em: {new Date(parsedBackupData.createdAt).toLocaleString('pt-BR')} • Versão {parsedBackupData.version}
                </p>
              </div>

              <div className="flex items-center gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() =>
                    setRestoreSections({
                      generalSettings: !!parsedBackupData.generalSettings,
                      agents: !!parsedBackupData.agents?.length,
                      chatHistory: !!parsedBackupData.sessions?.length,
                      skills: !!parsedBackupData.skills?.length,
                      commands: !!parsedBackupData.commands?.length,
                      mcpServers: !!parsedBackupData.mcpServers?.length,
                      policies: !!parsedBackupData.policies?.length,
                      projects: !!parsedBackupData.projects?.length,
                      authorizedDirs: !!parsedBackupData.authorizedDirs?.length,
                    })
                  }
                  className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                >
                  Marcar Disponíveis
                </button>
                <span className="text-zinc-300 dark:text-zinc-700">|</span>
                <button
                  type="button"
                  onClick={() =>
                    setRestoreSections({
                      generalSettings: false,
                      agents: false,
                      chatHistory: false,
                      skills: false,
                      commands: false,
                      mcpServers: false,
                      policies: false,
                      projects: false,
                      authorizedDirs: false,
                    })
                  }
                  className="text-zinc-500 dark:text-zinc-400 hover:underline cursor-pointer"
                >
                  Desmarcar Todos
                </button>
              </div>
            </div>

            <p className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
              Selecione as partes que você deseja sobrescrever com este backup:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {/* General Settings */}
              {parsedBackupData.generalSettings && (
                <label className="flex items-center gap-2 p-2 rounded bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={restoreSections.generalSettings}
                    onChange={(e) =>
                      setRestoreSections({ ...restoreSections, generalSettings: e.target.checked })
                    }
                    className="rounded text-blue-600"
                  />
                  <span>Configurações Gerais</span>
                </label>
              )}

              {/* Agents */}
              {parsedBackupData.agents && parsedBackupData.agents.length > 0 && (
                <label className="flex items-center gap-2 p-2 rounded bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={restoreSections.agents}
                    onChange={(e) =>
                      setRestoreSections({ ...restoreSections, agents: e.target.checked })
                    }
                    className="rounded text-blue-600"
                  />
                  <span>Agentes ({parsedBackupData.agents.length})</span>
                </label>
              )}

              {/* Chat Sessions */}
              {parsedBackupData.sessions && parsedBackupData.sessions.length > 0 && (
                <label className="flex items-center gap-2 p-2 rounded bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={restoreSections.chatHistory}
                    onChange={(e) =>
                      setRestoreSections({ ...restoreSections, chatHistory: e.target.checked })
                    }
                    className="rounded text-blue-600"
                  />
                  <span>Histórico de Chats ({parsedBackupData.sessions.length})</span>
                </label>
              )}

              {/* Skills */}
              {parsedBackupData.skills && parsedBackupData.skills.length > 0 && (
                <label className="flex items-center gap-2 p-2 rounded bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={restoreSections.skills}
                    onChange={(e) =>
                      setRestoreSections({ ...restoreSections, skills: e.target.checked })
                    }
                    className="rounded text-blue-600"
                  />
                  <span>Skills ({parsedBackupData.skills.length})</span>
                </label>
              )}

              {/* Commands */}
              {parsedBackupData.commands && parsedBackupData.commands.length > 0 && (
                <label className="flex items-center gap-2 p-2 rounded bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={restoreSections.commands}
                    onChange={(e) =>
                      setRestoreSections({ ...restoreSections, commands: e.target.checked })
                    }
                    className="rounded text-blue-600"
                  />
                  <span>Comandos ({parsedBackupData.commands.length})</span>
                </label>
              )}

              {/* MCP Servers */}
              {parsedBackupData.mcpServers && parsedBackupData.mcpServers.length > 0 && (
                <label className="flex items-center gap-2 p-2 rounded bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={restoreSections.mcpServers}
                    onChange={(e) =>
                      setRestoreSections({ ...restoreSections, mcpServers: e.target.checked })
                    }
                    className="rounded text-blue-600"
                  />
                  <span>Servidores MCP ({parsedBackupData.mcpServers.length})</span>
                </label>
              )}

              {/* Policies */}
              {parsedBackupData.policies && parsedBackupData.policies.length > 0 && (
                <label className="flex items-center gap-2 p-2 rounded bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={restoreSections.policies}
                    onChange={(e) =>
                      setRestoreSections({ ...restoreSections, policies: e.target.checked })
                    }
                    className="rounded text-blue-600"
                  />
                  <span>Políticas ({parsedBackupData.policies.length})</span>
                </label>
              )}

              {/* Projects */}
              {parsedBackupData.projects && parsedBackupData.projects.length > 0 && (
                <label className="flex items-center gap-2 p-2 rounded bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={restoreSections.projects}
                    onChange={(e) =>
                      setRestoreSections({ ...restoreSections, projects: e.target.checked })
                    }
                    className="rounded text-blue-600"
                  />
                  <span>Projetos ({parsedBackupData.projects.length})</span>
                </label>
              )}

              {/* Authorized Dirs */}
              {parsedBackupData.authorizedDirs && parsedBackupData.authorizedDirs.length > 0 && (
                <label className="flex items-center gap-2 p-2 rounded bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={restoreSections.authorizedDirs}
                    onChange={(e) =>
                      setRestoreSections({ ...restoreSections, authorizedDirs: e.target.checked })
                    }
                    className="rounded text-blue-600"
                  />
                  <span>Diretórios ({parsedBackupData.authorizedDirs.length})</span>
                </label>
              )}
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => setIsRestoreConfirmOpen(true)}
                disabled={isRestoring || Object.values(restoreSections).filter(Boolean).length === 0}
                className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer shadow-xs"
              >
                {isRestoring ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="w-3.5 h-3.5" />
                )}
                <span>Restaurar e Sobrescrever Configurações</span>
              </button>
            </div>
          </div>
        )}

        {/* Restore Result Feedback */}
        {restoreResult && (
          <div
            className={`p-3.5 rounded-lg border text-xs space-y-1.5 ${
              restoreResult.success
                ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                : 'bg-rose-50 dark:bg-rose-950/20 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200'
            }`}
          >
            <div className="flex items-center gap-2 font-semibold">
              {restoreResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
              )}
              <span>{restoreResult.message}</span>
            </div>
            {restoreResult.restoredSections?.length > 0 && (
              <p className="text-[11px] opacity-90 pl-6">
                Seções atualizadas: {restoreResult.restoredSections.join(', ')}
              </p>
            )}
          </div>
        )}
      </div>

      {/* 3. FACTORY RESET CARD */}
      <div className="p-4 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20 shadow-xs space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
            <span className="text-xs font-semibold text-rose-900 dark:text-rose-200">
              Restaurar Padrões de Fábrica (Reset Geral)
            </span>
          </div>
        </div>

        <p className="text-[11px] text-rose-800/90 dark:text-rose-300/90 leading-relaxed">
          Esta ação redefinirá completamente todas as configurações para o estado original de fábrica:
        </p>

        <ul className="text-[11px] text-zinc-600 dark:text-zinc-400 space-y-1 pl-4 list-disc">
          <li>Restauração de todos os agentes para o conjunto padrão nativo.</li>
          <li>Restauração das skills nativas e comandos / slash padrão.</li>
          <li>Restauração das políticas de segurança e servidores MCP padrão.</li>
          <li>Limpeza de todo o histórico de conversas e sessões de chat.</li>
          <li>Redefinição dos logs de depuração do sistema.</li>
        </ul>

        <div className="pt-1">
          <button
            type="button"
            onClick={() => {
              setFactoryResetConfirmInput('');
              setIsFactoryResetModalOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white transition cursor-pointer shadow-xs"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restaurar Padrões de Fábrica</span>
          </button>
        </div>

        {factoryResetResult && (
          <div
            className={`p-3.5 rounded-lg border text-xs space-y-1 ${
              factoryResetResult.success
                ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                : 'bg-rose-100 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200'
            }`}
          >
            <div className="flex items-center gap-2 font-semibold">
              {factoryResetResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
              )}
              <span>{factoryResetResult.message}</span>
            </div>
          </div>
        )}
      </div>

      {/* CONFIRMATION MODAL: RESTORE BACKUP */}
      {isRestoreConfirmOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 shadow-xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h5 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Confirmar Restauração de Backup
                </h5>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Atenção: esta ação sobrescreverá as configurações atuais
                </p>
              </div>
            </div>

            <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
              As seções selecionadas da sua aplicação atual serão permanentemente sobrescritas pelos dados contidos no arquivo{' '}
              <strong className="font-mono text-zinc-900 dark:text-zinc-100">
                {restoreFile?.name}
              </strong>
              .
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setIsRestoreConfirmOpen(false)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleRestoreSubmit}
                disabled={isRestoring}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition cursor-pointer shadow-xs"
              >
                {isRestoring && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirmar e Sobrescrever</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRMATION MODAL: FACTORY RESET */}
      {isFactoryResetModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-xl border border-rose-300 dark:border-rose-900 p-5 shadow-xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400 shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h5 className="text-sm font-bold text-rose-600 dark:text-rose-400">
                  Restaurar Padrões de Fábrica
                </h5>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Ação irreversível de redefinição total
                </p>
              </div>
            </div>

            <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
              Você tem certeza de que deseja redefinir todas as configurações, agentes, comandos, skills e histórico de chat para os padrões originais de fábrica?
            </p>

            <div className="p-3 rounded-lg bg-rose-50/80 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-xs text-rose-800 dark:text-rose-300">
              Para confirmar, digite <strong className="font-mono text-rose-700 dark:text-rose-200">RESET</strong> no campo abaixo:
            </div>

            <input
              type="text"
              value={factoryResetConfirmInput}
              onChange={(e) => setFactoryResetConfirmInput(e.target.value.toUpperCase())}
              placeholder="Digite RESET"
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 outline-none focus:border-rose-500 transition uppercase"
            />

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setIsFactoryResetModalOpen(false)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleFactoryResetSubmit}
                disabled={factoryResetConfirmInput !== 'RESET' || isResettingFactory}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer shadow-xs"
              >
                {isResettingFactory && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Executar Reset de Fábrica</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
