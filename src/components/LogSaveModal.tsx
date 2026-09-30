import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Download,
  Save,
  Copy,
  Check,
  FileText,
  FileCode,
  FileSpreadsheet,
  HardDrive,
  RefreshCw,
  FolderCheck,
  Sliders,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { SystemLogEntry, SystemLogLevel } from '../types.js';
import {
  LogExportFormat,
  LogExportScope,
  filterLogsByScope,
  formatLogsForExport,
  downloadLogsAsFile,
} from '../utils/logExportUtils.js';
import { fetchJsonSafely } from '../utils/apiUtils.js';

interface SavedLogFileItem {
  name: string;
  path: string;
  sizeBytes: number;
  updatedAt: string;
}

interface LogSaveModalProps {
  isOpen: boolean;
  onClose: () => void;
  allLogs: SystemLogEntry[];
  filteredLogs: SystemLogEntry[];
  currentFilterLevel?: SystemLogLevel | 'ALL';
  currentSearchQuery?: string;
}

export const LogSaveModal: React.FC<LogSaveModalProps> = ({
  isOpen,
  onClose,
  allLogs,
  filteredLogs,
  currentFilterLevel = 'ALL',
  currentSearchQuery = '',
}) => {
  const [activeTab, setActiveTab] = useState<'export' | 'server_files'>('export');
  const [format, setFormat] = useState<LogExportFormat>('log');
  const [scope, setScope] = useState<LogExportScope>('all');
  const [includeDetails, setIncludeDetails] = useState<boolean>(true);
  const [customFilename, setCustomFilename] = useState<string>('');

  // Status feedback
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isSavingToServer, setIsSavingToServer] = useState<boolean>(false);
  const [serverSaveMessage, setServerSaveMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Server saved files
  const [savedFiles, setSavedFiles] = useState<SavedLogFileItem[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(false);

  // Load server files
  const loadSavedFiles = async () => {
    setIsLoadingFiles(true);
    try {
      const data = await fetchJsonSafely<{ success: boolean; files: SavedLogFileItem[] }>(
        '/api/logs/saved-files'
      );
      if (data && Array.isArray(data.files)) {
        setSavedFiles(data.files);
      }
    } catch (err) {
      console.error('Falha ao carregar lista de arquivos de log do servidor:', err);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  useEffect(() => {
    if (isOpen && activeTab === 'server_files') {
      loadSavedFiles();
    }
  }, [isOpen, activeTab]);

  // Compute targeted logs
  const targetedLogs = useMemo(() => {
    return filterLogsByScope(allLogs, filteredLogs, scope);
  }, [allLogs, filteredLogs, scope]);

  // Preview formatted text
  const formattedPreview = useMemo(() => {
    const previewSample = targetedLogs.slice(0, 5);
    return formatLogsForExport(previewSample, format, {
      includeDetails,
      customFilename,
    }).content;
  }, [targetedLogs, format, includeDetails, customFilename]);

  if (!isOpen) return null;

  // Direct download
  const handleDownload = () => {
    const result = formatLogsForExport(targetedLogs, format, {
      includeDetails,
      customFilename,
    });
    downloadLogsAsFile(result.content, result.filename, result.mimeType);
  };

  // Copy to clipboard
  const handleCopy = () => {
    const result = formatLogsForExport(targetedLogs, format, {
      includeDetails,
      customFilename,
    });
    navigator.clipboard.writeText(result.content);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  // Save to host server disk
  const handleSaveToServer = async () => {
    setIsSavingToServer(true);
    setServerSaveMessage(null);
    try {
      const res = await fetch('/api/logs/save-to-disk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          level: scope === 'errors_warnings' ? 'error' : currentFilterLevel,
          search: scope === 'filtered' ? currentSearchQuery : undefined,
          customFilename: customFilename.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data && data.success) {
        setServerSaveMessage({
          type: 'success',
          text: `Salvo com sucesso no servidor! Arquivo: ${data.filename} (${(data.sizeBytes / 1024).toFixed(1)} KB, ${data.totalLogsSaved} logs)`,
        });
        loadSavedFiles();
      } else {
        setServerSaveMessage({
          type: 'error',
          text: data?.error || 'Erro ao gravar snapshot no disco do servidor.',
        });
      }
    } catch (err: any) {
      setServerSaveMessage({
        type: 'error',
        text: err?.message || 'Falha na comunicação com o servidor.',
      });
    } finally {
      setIsSavingToServer(false);
    }
  };

  const errorWarningCount = allLogs.filter((l) => l.level === 'error' || l.level === 'warn').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/70 backdrop-blur-xs select-text animate-in fade-in duration-150">
      <div className="w-full max-w-xl bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden text-zinc-100 font-sans">
        {/* Header */}
        <div className="px-4 py-3 border-b border-zinc-800/80 flex items-center justify-between bg-zinc-900/60">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Save className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs sm:text-sm font-semibold text-zinc-100">
                Opções para Salvar Logs
              </h2>
              <p className="text-[10px] text-zinc-400 font-mono">
                Exporte, baixe ou grave snapshots no disco do sistema
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition cursor-pointer"
            title="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center border-b border-zinc-800 bg-zinc-900/30 px-4 gap-2 pt-2">
          <button
            type="button"
            onClick={() => setActiveTab('export')}
            className={`pb-2 px-2 text-[11px] font-medium transition border-b-2 cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'export'
                ? 'border-emerald-500 text-emerald-400 font-semibold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportar & Baixar</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('server_files')}
            className={`pb-2 px-2 text-[11px] font-medium transition border-b-2 cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'server_files'
                ? 'border-emerald-500 text-emerald-400 font-semibold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5" />
            <span>Arquivos Salvos no Servidor</span>
            {savedFiles.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[9px] font-mono bg-zinc-800 text-zinc-300">
                {savedFiles.length}
              </span>
            )}
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-[11px]">
          {activeTab === 'export' ? (
            <>
              {/* Formato Selection Cards */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1">
                  <Sliders className="w-3 h-3 text-zinc-500" />
                  <span>1. Formato do Arquivo</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormat('log')}
                    className={`p-2.5 rounded-lg border text-left transition cursor-pointer flex flex-col justify-between ${
                      format === 'log'
                        ? 'bg-emerald-950/40 border-emerald-500/80 text-emerald-300 ring-1 ring-emerald-500/50'
                        : 'bg-zinc-900/50 border-zinc-800/80 hover:bg-zinc-900 text-zinc-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <FileText className="w-4 h-4 text-emerald-400" />
                      <span className="text-[9px] font-mono uppercase font-bold text-zinc-400">.LOG</span>
                    </div>
                    <div className="font-semibold text-[11px]">Texto (.log)</div>
                    <div className="text-[9.5px] text-zinc-400">Padrão legível de console</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormat('json')}
                    className={`p-2.5 rounded-lg border text-left transition cursor-pointer flex flex-col justify-between ${
                      format === 'json'
                        ? 'bg-blue-950/40 border-blue-500/80 text-blue-300 ring-1 ring-blue-500/50'
                        : 'bg-zinc-900/50 border-zinc-800/80 hover:bg-zinc-900 text-zinc-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <FileCode className="w-4 h-4 text-blue-400" />
                      <span className="text-[9px] font-mono uppercase font-bold text-zinc-400">.JSON</span>
                    </div>
                    <div className="font-semibold text-[11px]">JSON Estruturado</div>
                    <div className="text-[9.5px] text-zinc-400">Metadados completos e payloads</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormat('csv')}
                    className={`p-2.5 rounded-lg border text-left transition cursor-pointer flex flex-col justify-between ${
                      format === 'csv'
                        ? 'bg-amber-950/40 border-amber-500/80 text-amber-300 ring-1 ring-amber-500/50'
                        : 'bg-zinc-900/50 border-zinc-800/80 hover:bg-zinc-900 text-zinc-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <FileSpreadsheet className="w-4 h-4 text-amber-400" />
                      <span className="text-[9px] font-mono uppercase font-bold text-zinc-400">.CSV</span>
                    </div>
                    <div className="font-semibold text-[11px]">Planilha (.csv)</div>
                    <div className="text-[9.5px] text-zinc-400">Excel e Google Sheets</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormat('md')}
                    className={`p-2.5 rounded-lg border text-left transition cursor-pointer flex flex-col justify-between ${
                      format === 'md'
                        ? 'bg-purple-950/40 border-purple-500/80 text-purple-300 ring-1 ring-purple-500/50'
                        : 'bg-zinc-900/50 border-zinc-800/80 hover:bg-zinc-900 text-zinc-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <FileText className="w-4 h-4 text-purple-400" />
                      <span className="text-[9px] font-mono uppercase font-bold text-zinc-400">.MD</span>
                    </div>
                    <div className="font-semibold text-[11px]">Markdown (.md)</div>
                    <div className="text-[9.5px] text-zinc-400">Relatório com tabelas</div>
                  </button>
                </div>
              </div>

              {/* Escopo Selection */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center justify-between">
                  <span>2. Escopo dos Logs a Salvar</span>
                  <span className="text-zinc-500 font-mono text-[9px]">
                    Selecionados: {targetedLogs.length} logs
                  </span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setScope('all')}
                    className={`px-3 py-2 rounded-lg border text-left transition cursor-pointer ${
                      scope === 'all'
                        ? 'bg-zinc-900 border-emerald-500 text-zinc-100 font-semibold'
                        : 'bg-zinc-900/40 border-zinc-800/80 hover:bg-zinc-900 text-zinc-400'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px]">Todos os Logs</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-emerald-400">
                        {allLogs.length}
                      </span>
                    </div>
                    <div className="text-[9.5px] text-zinc-500 mt-0.5">Buffer completo em memória</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setScope('filtered')}
                    className={`px-3 py-2 rounded-lg border text-left transition cursor-pointer ${
                      scope === 'filtered'
                        ? 'bg-zinc-900 border-emerald-500 text-zinc-100 font-semibold'
                        : 'bg-zinc-900/40 border-zinc-800/80 hover:bg-zinc-900 text-zinc-400'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px]">Logs Filtrados</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-blue-400">
                        {filteredLogs.length}
                      </span>
                    </div>
                    <div className="text-[9.5px] text-zinc-500 mt-0.5">Respeita pesquisa e nível</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setScope('errors_warnings')}
                    className={`px-3 py-2 rounded-lg border text-left transition cursor-pointer ${
                      scope === 'errors_warnings'
                        ? 'bg-zinc-900 border-emerald-500 text-zinc-100 font-semibold'
                        : 'bg-zinc-900/40 border-zinc-800/80 hover:bg-zinc-900 text-zinc-400'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px]">Erros & Avisos</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-rose-400">
                        {errorWarningCount}
                      </span>
                    </div>
                    <div className="text-[9.5px] text-zinc-500 mt-0.5">Apenas eventos críticos</div>
                  </button>
                </div>
              </div>

              {/* Opções Avançadas */}
              <div className="space-y-2 p-3 rounded-lg bg-zinc-900/40 border border-zinc-800">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    3. Configurações Adicionais
                  </label>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1 space-y-1">
                    <label className="text-[10px] text-zinc-400 font-medium">
                      Nome Personalizado do Arquivo (Opcional):
                    </label>
                    <input
                      type="text"
                      value={customFilename}
                      onChange={(e) => setCustomFilename(e.target.value)}
                      placeholder={`gemini_gui_logs_${new Date().toISOString().slice(0, 10)}.${format}`}
                      className="w-full px-2 py-1 text-[10px] font-mono rounded bg-zinc-950 border border-zinc-800 text-zinc-200 outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-4">
                    <label className="flex items-center gap-2 cursor-pointer text-[10px] text-zinc-300">
                      <input
                        type="checkbox"
                        checked={includeDetails}
                        onChange={(e) => setIncludeDetails(e.target.checked)}
                        className="rounded border-zinc-700 text-emerald-600 focus:ring-0 cursor-pointer"
                      />
                      <span>Incluir payloads / detalhes JSON</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Prévia dos Dados */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-zinc-500">
                  <span className="font-semibold uppercase tracking-wider">Prévia da Saída:</span>
                  <span className="font-mono">Mostrando amostra inicial</span>
                </div>
                <pre className="p-2 rounded bg-zinc-950 border border-zinc-800 text-[9.5px] font-mono text-zinc-300 max-h-24 overflow-x-auto whitespace-pre overflow-y-hidden">
                  {formattedPreview}
                </pre>
              </div>

              {/* Server save status message */}
              {serverSaveMessage && (
                <div
                  className={`p-2.5 rounded-lg border text-[10.5px] flex items-start gap-2 ${
                    serverSaveMessage.type === 'success'
                      ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
                      : 'bg-rose-950/40 border-rose-800/80 text-rose-300'
                  }`}
                >
                  {serverSaveMessage.type === 'success' ? (
                    <FolderCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  )}
                  <span className="flex-1 break-all leading-relaxed">{serverSaveMessage.text}</span>
                </div>
              )}
            </>
          ) : (
            /* Tab 2: Server Saved Snapshots */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-semibold text-zinc-200">
                    Snapshots Armazenados no Servidor
                  </h3>
                  <p className="text-[10px] text-zinc-400">
                    Arquivos gerados e salvos localmente na pasta <code className="text-amber-300 font-mono">./logs</code> do servidor.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadSavedFiles}
                  disabled={isLoadingFiles}
                  className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[10px] text-zinc-300 flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoadingFiles ? 'animate-spin' : ''}`} />
                  <span>Atualizar</span>
                </button>
              </div>

              {savedFiles.length === 0 ? (
                <div className="py-8 text-center text-zinc-500 space-y-1">
                  <HardDrive className="w-6 h-6 mx-auto opacity-40 text-zinc-600 mb-2" />
                  <p>Nenhum snapshot salvo no servidor ainda.</p>
                  <p className="text-[10px] text-zinc-600">
                    Use a aba &quot;Exportar & Baixar&quot; e clique em &quot;Salvar no Servidor&quot; para criar um.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-zinc-800/60 rounded-lg border border-zinc-800 bg-zinc-900/30 overflow-hidden max-h-64 overflow-y-auto">
                  {savedFiles.map((file) => (
                    <div
                      key={file.path}
                      className="p-2.5 flex items-center justify-between hover:bg-zinc-900/70 transition"
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="font-mono font-bold text-zinc-200 truncate text-[10.5px]">
                          {file.name}
                        </div>
                        <div className="text-[9.5px] text-zinc-500 flex items-center gap-2 mt-0.5">
                          <span>{(file.sizeBytes / 1024).toFixed(1)} KB</span>
                          <span>•</span>
                          <span>{new Date(file.updatedAt).toLocaleString('pt-BR')}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <a
                          href={`/api/logs/export?format=${file.name.split('.').pop() || 'txt'}`}
                          download={file.name}
                          className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px] font-mono flex items-center gap-1 cursor-pointer"
                        >
                          <Download className="w-3 h-3 text-emerald-400" />
                          <span>Baixar</span>
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-4 py-3 border-t border-zinc-800/80 bg-zinc-900/60 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
            <Info className="w-3.5 h-3.5 text-zinc-500" />
            <span>Destino: Baixar localmente ou gravar no disco do servidor.</span>
          </div>

          <div className="flex items-center gap-2">
            {activeTab === 'export' && (
              <>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-2.5 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-[10.5px] font-medium transition cursor-pointer flex items-center gap-1.5"
                  title="Copiar logs formatados para a área de transferência"
                >
                  {isCopied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copiado!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copiar</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleSaveToServer}
                  disabled={isSavingToServer || targetedLogs.length === 0}
                  className="px-2.5 py-1.5 rounded-lg border border-blue-800/80 bg-blue-950/60 hover:bg-blue-900/80 text-blue-300 text-[10.5px] font-medium transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  title="Salvar snapshot permanentemente na pasta ./logs do servidor"
                >
                  <HardDrive className={`w-3.5 h-3.5 text-blue-400 ${isSavingToServer ? 'animate-pulse' : ''}`} />
                  <span>{isSavingToServer ? 'Gravando...' : 'Salvar no Servidor'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={targetedLogs.length === 0}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10.5px] font-semibold transition cursor-pointer flex items-center gap-1.5 shadow-md disabled:opacity-50"
                  title="Baixar arquivo imediatamente no navegador"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Baixar Arquivo</span>
                </button>
              </>
            )}

            {activeTab === 'server_files' && (
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10.5px] font-medium transition cursor-pointer"
              >
                Fechar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
