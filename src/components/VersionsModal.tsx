import React, { useState, useEffect } from 'react';
import {
  X,
  History,
  RotateCcw,
  GitCompare,
  Trash2,
  CheckCircle2,
  AlertCircle,
  FileCode,
  Loader2,
  Calendar,
  Layers,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';
import { AppVersionItem, VersionDiffItem } from '../types.js';

interface VersionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
  workspaceDir?: string;
  onVersionRestored?: () => void;
}

export const VersionsModal: React.FC<VersionsModalProps> = ({
  isOpen,
  onClose,
  projectId,
  workspaceDir,
  onVersionRestored,
}) => {
  const [versions, setVersions] = useState<AppVersionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [selectedVersionDiffs, setSelectedVersionDiffs] = useState<{
    versionId: string;
    diffs: VersionDiffItem[];
  } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchVersions = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (projectId) params.set('projectId', projectId);
      if (workspaceDir) params.set('workspaceDir', workspaceDir);

      const res = await fetch(`/api/versions?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setVersions(data);
      }
    } catch (err: any) {
      console.error('Falha ao carregar versões:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchVersions();
      setSelectedVersionDiffs(null);
      setFeedback(null);
    }
  }, [isOpen, projectId, workspaceDir]);

  if (!isOpen) return null;

  const handleRestore = async (id: string, versionNum: number) => {
    if (!confirm(`Deseja restaurar a versão v${versionNum}? Um backup de segurança do estado atual será criado automaticamente.`)) {
      return;
    }

    try {
      setRestoringId(id);
      setFeedback(null);
      const res = await fetch(`/api/versions/${id}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceDir }),
      });

      const data = await res.json();
      if (data.success) {
        setFeedback({ type: 'success', message: data.message });
        await fetchVersions();
        if (onVersionRestored) onVersionRestored();
      } else {
        setFeedback({ type: 'error', message: data.message || 'Falha ao restaurar versão' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Erro na requisição' });
    } finally {
      setRestoringId(null);
    }
  };

  const handleCompare = async (id: string) => {
    try {
      setDiffLoading(true);
      const params = new URLSearchParams();
      if (workspaceDir) params.set('workspaceDir', workspaceDir);

      const res = await fetch(`/api/versions/${id}/diff?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedVersionDiffs({ versionId: id, diffs: data.diffs || [] });
      }
    } catch (err: any) {
      console.error('Erro ao comparar versão:', err);
    } finally {
      setDiffLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este snapshot de versão?')) return;
    try {
      const res = await fetch(`/api/versions/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setVersions((prev) => prev.filter((v) => v.id !== id));
        if (selectedVersionDiffs?.versionId === id) {
          setSelectedVersionDiffs(null);
        }
      }
    } catch (err: any) {
      console.error('Erro ao excluir versão:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 select-text">
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl w-full max-w-4xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between shrink-0 bg-zinc-900/60">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-semibold text-zinc-100">
              App Versions & Snapshots de Arquivos
            </h2>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-950/60 text-blue-300 border border-blue-800/50">
              {versions.length} versões registradas
            </span>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div
            className={`px-4 py-2 text-xs flex items-center gap-2 border-b shrink-0 ${
              feedback.type === 'success'
                ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
        )}

        {/* Body Split */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Versions List */}
          <div className="w-full md:w-1/2 border-r border-zinc-800/80 overflow-y-auto p-3 space-y-2.5">
            {loading ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2 text-zinc-400 text-xs">
                <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                <span>Carregando snapshots...</span>
              </div>
            ) : versions.length === 0 ? (
              <div className="py-12 text-center text-zinc-500 text-xs">
                <p>Nenhum snapshot de arquivo registrado ainda.</p>
                <p className="text-[11px] mt-1 text-zinc-600">
                  Snapshots são criados automaticamente sempre que o agente executa e altera arquivos.
                </p>
              </div>
            ) : (
              versions.map((ver) => (
                <div
                  key={ver.id}
                  className={`p-2.5 rounded-lg border transition ${
                    selectedVersionDiffs?.versionId === ver.id
                      ? 'bg-blue-950/20 border-blue-500/50'
                      : 'bg-zinc-900/60 border-zinc-800/70 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-blue-400 font-mono">
                        v{ver.versionNumber}
                      </span>
                      {ver.isBackup && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-800/50">
                          Backup Auto
                        </span>
                      )}
                      <span className="text-[10px] text-zinc-500 flex items-center gap-1">
                        <Calendar className="w-2.5 h-2.5" />
                        {new Date(ver.createdAt).toLocaleString([], {
                          month: 'short',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleCompare(ver.id)}
                        disabled={diffLoading}
                        className="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700 transition cursor-pointer flex items-center gap-1"
                        title="Ver diferenças em relação ao estado atual"
                      >
                        <GitCompare className="w-3 h-3" />
                        <span>Diff</span>
                      </button>

                      <button
                        onClick={() => handleRestore(ver.id, ver.versionNumber)}
                        disabled={restoringId === ver.id}
                        className="px-2 py-0.5 rounded text-[10px] font-medium bg-blue-600/30 text-blue-300 hover:bg-blue-600/50 transition cursor-pointer flex items-center gap-1 border border-blue-500/40"
                        title="Restaurar estes arquivos"
                      >
                        {restoringId === ver.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RotateCcw className="w-3 h-3" />
                        )}
                        <span>Restaurar</span>
                      </button>

                      <button
                        onClick={() => handleDelete(ver.id)}
                        className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 transition cursor-pointer"
                        title="Excluir snapshot"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  <p className="text-[11px] text-zinc-300 mt-1 line-clamp-2 leading-relaxed">
                    {ver.prompt}
                  </p>

                  <div className="mt-2 pt-1.5 border-t border-zinc-800/60 flex items-center justify-between text-[10px] text-zinc-500">
                    <span className="flex items-center gap-1">
                      <FileCode className="w-3 h-3 text-zinc-400" />
                      {ver.changedFiles.length} arquivos alterados
                    </span>
                    <span className="font-mono">{ver.model || ver.agentName}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Diffs & Inspection View */}
          <div className="w-full md:w-1/2 overflow-y-auto p-3 bg-zinc-950 flex flex-col font-mono text-[11px]">
            {diffLoading ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-zinc-400 text-xs">
                <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                <span>Calculando diffs...</span>
              </div>
            ) : selectedVersionDiffs ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                  <span className="text-xs font-sans font-semibold text-zinc-200">
                    Comparação de Arquivos com Atual
                  </span>
                  <span className="text-[10px] text-zinc-400">
                    {selectedVersionDiffs.diffs.length} arquivos comparados
                  </span>
                </div>

                {selectedVersionDiffs.diffs.length === 0 ? (
                  <p className="text-zinc-500 text-center py-8">
                    Nenhuma divergência detectada entre este snapshot e o arquivo atual no disco.
                  </p>
                ) : (
                  selectedVersionDiffs.diffs.map((diff, i) => (
                    <div key={i} className="rounded border border-zinc-800/80 bg-zinc-900/60 overflow-hidden">
                      <div className="px-2.5 py-1 bg-zinc-900 border-b border-zinc-800/80 flex items-center justify-between">
                        <span className="font-sans font-medium text-zinc-300 text-[10.5px]">
                          {diff.filePath}
                        </span>
                        <span
                          className={`text-[9px] px-1.5 py-0.2 rounded uppercase font-bold ${
                            diff.status === 'added'
                              ? 'bg-emerald-950 text-emerald-400'
                              : diff.status === 'deleted'
                              ? 'bg-rose-950 text-rose-400'
                              : 'bg-amber-950 text-amber-400'
                          }`}
                        >
                          {diff.status}
                        </span>
                      </div>

                      <div className="p-2 overflow-x-auto max-h-60 text-[10px] leading-tight">
                        <pre className="whitespace-pre-wrap text-zinc-300">
                          {diff.versionContent ? diff.versionContent.slice(0, 1500) : '(arquivo vazio no snapshot)'}
                          {diff.versionContent && diff.versionContent.length > 1500 && '\n... [restante omitido para visualização compacta]'}
                        </pre>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500 font-sans text-xs">
                <GitCompare className="w-8 h-8 text-zinc-700 mb-2" />
                <p>Selecione "Diff" em qualquer versão para inspecionar as alterações contra os arquivos atuais.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
