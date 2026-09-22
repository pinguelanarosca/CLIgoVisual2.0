import React, { useState, useEffect } from 'react';
import {
  History,
  X,
  RotateCcw,
  FileCode,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Trash2,
  Eye,
  GitBranch,
  ShieldCheck,
  Clock,
  Sparkles,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { AppVersionItem, AppVersionDiff, AppVersionRestoreResult } from '../types.js';

interface VersionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceDir?: string;
  projectId?: string;
  onNotification?: (msg: string, type: 'info' | 'success' | 'error') => void;
}

export const VersionsModal: React.FC<VersionsModalProps> = ({
  isOpen,
  onClose,
  workspaceDir,
  projectId,
  onNotification,
}) => {
  const [versions, setVersions] = useState<AppVersionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<AppVersionItem | null>(null);
  const [diffs, setDiffs] = useState<AppVersionDiff[]>([]);
  const [loadingDiffs, setLoadingDiffs] = useState(false);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [confirmRestoreVersion, setConfirmRestoreVersion] = useState<AppVersionItem | null>(null);
  const [manualPrompt, setManualPrompt] = useState('');
  const [creatingManual, setCreatingManual] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);

  const fetchVersions = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (projectId) query.set('projectId', projectId);
      if (workspaceDir) query.set('workspaceDir', workspaceDir);

      const res = await fetch(`/api/versions?${query.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setVersions(Array.isArray(data) ? data : []);
      }
    } catch {
      onNotification?.('Falha ao carregar versões do app.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchVersions();
      setSelectedVersion(null);
      setDiffs([]);
    }
  }, [isOpen, projectId, workspaceDir]);

  const handleSelectVersion = async (v: AppVersionItem) => {
    setSelectedVersion(v);
    setLoadingDiffs(true);
    setExpandedFile(null);
    try {
      const res = await fetch(`/api/versions/${v.id}/diff`);
      if (res.ok) {
        const data = await res.json();
        setDiffs(Array.isArray(data) ? data : []);
        if (data.length > 0) {
          setExpandedFile(data[0].path);
        }
      }
    } catch {
      onNotification?.('Erro ao calcular diffs da versão.', 'error');
    } finally {
      setLoadingDiffs(false);
    }
  };

  const handleCreateManualVersion = async () => {
    if (creatingManual) return;
    setCreatingManual(true);
    try {
      const res = await fetch('/api/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: manualPrompt.trim() || 'Snapshot manual criado pelo usuário',
          workspaceDir: workspaceDir || undefined,
          projectId: projectId || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        onNotification?.(`Versão #${data.version.versionNumber} criada com sucesso!`, 'success');
        setManualPrompt('');
        setShowManualForm(false);
        fetchVersions();
      } else {
        onNotification?.(data.message || 'Nenhuma alteração real detectada para versionar.', 'info');
      }
    } catch {
      onNotification?.('Erro ao criar snapshot manual.', 'error');
    } finally {
      setCreatingManual(false);
    }
  };

  const handleRestoreVersion = async (v: AppVersionItem) => {
    setRestoringId(v.id);
    try {
      const res = await fetch(`/api/versions/${v.id}/restore`, {
        method: 'POST',
      });
      const result: AppVersionRestoreResult = await res.json();
      if (res.ok && result.success) {
        onNotification?.(
          `Versão restaurada com sucesso! Backup de segurança automático criado (${result.backupVersionId || 'ok'}).`,
          'success'
        );
        setConfirmRestoreVersion(null);
        fetchVersions();
      } else {
        onNotification?.(result.message || 'Falha ao restaurar versão.', 'error');
      }
    } catch {
      onNotification?.('Erro na requisição de restauração.', 'error');
    } finally {
      setRestoringId(null);
    }
  };

  const handleDeleteVersion = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Deseja realmente excluir esta versão e seus arquivos do snapshot?')) return;
    try {
      const res = await fetch(`/api/versions/${id}`, { method: 'DELETE' });
      if (res.ok) {
        onNotification?.('Versão excluída.', 'info');
        if (selectedVersion?.id === id) {
          setSelectedVersion(null);
          setDiffs([]);
        }
        fetchVersions();
      }
    } catch {
      onNotification?.('Erro ao excluir versão.', 'error');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="w-full max-w-5xl h-[88vh] bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl flex flex-col overflow-hidden text-zinc-100">
        {/* Header */}
        <div className="h-14 px-5 border-b border-zinc-800 flex items-center justify-between shrink-0 bg-zinc-900/90">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <History className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-white tracking-tight">App Versions</h2>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-indigo-300 border border-indigo-500/20">
                  {versions.length} {versions.length === 1 ? 'snapshot' : 'snapshots'}
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Histórico incremental de código desacoplado do chat • Backup automático antes de restaurações
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowManualForm(!showManualForm)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition cursor-pointer shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Criar Snapshot Manual</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Manual Snapshot Form Bar */}
        {showManualForm && (
          <div className="px-5 py-3 bg-zinc-800/60 border-b border-zinc-800 flex items-center gap-3 shrink-0 animate-in slide-in-from-top-2">
            <input
              type="text"
              placeholder="Descreva o que foi alterado ou o motivo deste snapshot (opcional)..."
              value={manualPrompt}
              onChange={(e) => setManualPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateManualVersion()}
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-hidden focus:border-indigo-500"
            />
            <button
              onClick={handleCreateManualVersion}
              disabled={creatingManual}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition cursor-pointer"
            >
              {creatingManual ? 'Detectando alterações...' : 'Salvar Versão'}
            </button>
          </div>
        )}

        {/* Content Body: 2 Columns */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Versions Timeline */}
          <div className="w-80 sm:w-96 border-r border-zinc-800 flex flex-col shrink-0 bg-zinc-950/40">
            <div className="p-3 border-b border-zinc-800/80 flex items-center justify-between text-xs text-zinc-400">
              <span>Linha do Tempo de Código</span>
              <button
                onClick={fetchVersions}
                className="text-[11px] text-indigo-400 hover:underline cursor-pointer"
              >
                Atualizar
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loading && versions.length === 0 ? (
                <div className="py-12 text-center text-xs text-zinc-500">Carregando versões...</div>
              ) : versions.length === 0 ? (
                <div className="py-12 text-center text-xs text-zinc-500 px-4">
                  <GitBranch className="w-8 h-8 mx-auto text-zinc-600 mb-2 opacity-50" />
                  Nenhum snapshot registrado ainda. Versões são criadas automaticamente sempre que execuções modificam arquivos reais, ou você pode criar manualmente acima.
                </div>
              ) : (
                versions.map((v) => {
                  const isSelected = selectedVersion?.id === v.id;
                  const dateStr = new Date(v.timestamp).toLocaleString([], {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  });

                  return (
                    <div
                      key={v.id}
                      onClick={() => handleSelectVersion(v)}
                      className={`p-3 rounded-lg border transition cursor-pointer relative group ${
                        isSelected
                          ? 'bg-indigo-950/30 border-indigo-500/50 shadow-xs'
                          : 'bg-zinc-900/80 border-zinc-800/80 hover:bg-zinc-800/60 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-1.5">
                          {v.isBackup ? (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                              <ShieldCheck className="w-2.5 h-2.5" /> Backup Auto
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">
                              #{v.versionNumber}
                            </span>
                          )}
                          <span className="text-[11px] text-zinc-400 flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5 text-zinc-500" /> {dateStr}
                          </span>
                        </div>

                        <button
                          onClick={(e) => handleDeleteVersion(v.id, e)}
                          title="Excluir snapshot"
                          className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-rose-400 rounded transition cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>

                      <p className="text-xs text-zinc-200 line-clamp-2 leading-relaxed mb-2 font-medium">
                        {v.prompt}
                      </p>

                      <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-1 border-t border-zinc-800/50">
                        <span className="flex items-center gap-1">
                          <FileCode className="w-3 h-3 text-zinc-500" />
                          {v.changedFiles.length} {v.changedFiles.length === 1 ? 'arquivo' : 'arquivos'}
                        </span>
                        {v.agentName && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400">
                            {v.agentName}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: Version Details & Diff Viewer */}
          <div className="flex-1 flex flex-col overflow-hidden bg-zinc-900/40">
            {selectedVersion ? (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Version Action Toolbar */}
                <div className="p-4 border-b border-zinc-800 bg-zinc-900/60 flex items-center justify-between shrink-0">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-white">
                        {selectedVersion.isBackup
                          ? `Backup Automático (${selectedVersion.id})`
                          : `Versão #${selectedVersion.versionNumber}`}
                      </h3>
                      <span className="text-[11px] text-zinc-400 font-mono">
                        {new Date(selectedVersion.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-300 mt-1 max-w-xl">
                      {selectedVersion.prompt}
                    </p>
                  </div>

                  <button
                    onClick={() => setConfirmRestoreVersion(selectedVersion)}
                    disabled={restoringId === selectedVersion.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-xs transition cursor-pointer"
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${restoringId === selectedVersion.id ? 'animate-spin' : ''}`} />
                    <span>Restaurar Esta Versão</span>
                  </button>
                </div>

                {/* Diff Viewer Area */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <div className="text-xs font-medium text-zinc-400 flex items-center justify-between">
                    <span>Arquivos alterados no snapshot ({selectedVersion.changedFiles.length})</span>
                    <span className="text-[11px] text-zinc-500">Clique para alternar visualização do diff</span>
                  </div>

                  {loadingDiffs ? (
                    <div className="py-12 text-center text-xs text-zinc-500">Carregando diferenças...</div>
                  ) : diffs.length === 0 ? (
                    <div className="py-8 text-center text-xs text-zinc-500">
                      Nenhum diff encontrado ou arquivos idênticos ao workspace atual.
                    </div>
                  ) : (
                    diffs.map((d) => {
                      const isExpanded = expandedFile === d.path;
                      return (
                        <div
                          key={d.path}
                          className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950/70"
                        >
                          <div
                            onClick={() => setExpandedFile(isExpanded ? null : d.path)}
                            className="px-3 py-2 bg-zinc-900/90 border-b border-zinc-800 flex items-center justify-between cursor-pointer hover:bg-zinc-800/80 transition"
                          >
                            <div className="flex items-center gap-2">
                              {isExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                              )}
                              <span className="text-xs font-mono font-medium text-zinc-200">
                                {d.path}
                              </span>
                            </div>
                            <span
                              className={`text-[10px] font-mono px-1.5 py-0.5 rounded uppercase ${
                                d.status === 'added'
                                  ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-800/40'
                                  : d.status === 'deleted'
                                  ? 'bg-rose-950/40 text-rose-400 border border-rose-800/40'
                                  : 'bg-blue-950/40 text-blue-400 border border-blue-800/40'
                              }`}
                            >
                              {d.status}
                            </span>
                          </div>

                          {isExpanded && (
                            <pre className="p-3 text-[11px] font-mono text-zinc-300 overflow-x-auto bg-zinc-950 whitespace-pre leading-relaxed select-text">
                              {d.diff.split('\n').map((line, idx) => {
                                const isAdd = line.startsWith('+') && !line.startsWith('+++');
                                const isSub = line.startsWith('-') && !line.startsWith('---');
                                return (
                                  <div
                                    key={idx}
                                    className={`${
                                      isAdd
                                        ? 'bg-emerald-950/30 text-emerald-300'
                                        : isSub
                                        ? 'bg-rose-950/30 text-rose-300'
                                        : 'text-zinc-400'
                                    }`}
                                  >
                                    {line}
                                  </div>
                                );
                              })}
                            </pre>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-zinc-500">
                <History className="w-12 h-12 text-zinc-700 mb-3" />
                <h4 className="text-sm font-medium text-zinc-300 mb-1">Nenhuma versão selecionada</h4>
                <p className="text-xs max-w-sm text-zinc-400">
                  Selecione um snapshot na coluna à esquerda para inspecionar os arquivos alterados, comparar diffs e restaurar o estado do código.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Restore Confirmation Dialog */}
        {confirmRestoreVersion && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in">
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 max-w-md w-full shadow-2xl text-zinc-100">
              <div className="flex items-center gap-2.5 text-amber-400 mb-3">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <h4 className="text-sm font-semibold">Confirmar Restauração de Código</h4>
              </div>

              <p className="text-xs text-zinc-300 leading-relaxed mb-4">
                Você está prestes a restaurar a{' '}
                <strong className="text-white">
                  Versão #{confirmRestoreVersion.versionNumber}
                </strong>
                . Os {confirmRestoreVersion.changedFiles.length} arquivos deste snapshot serão restaurados para o diretório de trabalho.
              </p>

              <div className="p-3 bg-zinc-800/80 rounded-lg text-[11px] text-zinc-300 border border-zinc-700 mb-5 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-emerald-300">Proteção Ativa contra Sobrescrita:</strong> Um backup automático do estado atual dos arquivos será criado antes da restauração, permitindo desfazer se necessário.
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setConfirmRestoreVersion(null)}
                  className="px-3.5 py-1.5 text-xs text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleRestoreVersion(confirmRestoreVersion)}
                  disabled={restoringId !== null}
                  className="px-4 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition cursor-pointer shadow-xs"
                >
                  Confirmar e Restaurar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
