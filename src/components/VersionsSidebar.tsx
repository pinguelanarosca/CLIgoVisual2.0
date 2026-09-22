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
  ChevronDown,
  ChevronRight,
  Eye,
} from 'lucide-react';
import { AppVersionItem, VersionDiffItem, ProjectItem, AuthorizedDir } from '../types.js';

interface VersionsSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activeProject?: ProjectItem | null;
  authorizedDirs?: AuthorizedDir[];
  onVersionRestored?: () => void;
}

export const VersionsSidebar: React.FC<VersionsSidebarProps> = ({
  isOpen,
  onClose,
  activeProject,
  authorizedDirs = [],
  onVersionRestored,
}) => {
  const [versions, setVersions] = useState<AppVersionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);
  const [versionDiffs, setVersionDiffs] = useState<Record<string, VersionDiffItem[]>>({});
  const [diffLoadingId, setDiffLoadingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const workspaceDir = activeProject?.associatedDirs[0] || authorizedDirs[0]?.path || '';

  const fetchVersions = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (activeProject?.id) params.set('projectId', activeProject.id);
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
      setFeedback(null);
    }
  }, [isOpen, activeProject?.id, workspaceDir]);

  if (!isOpen) return null;

  const handleRestore = async (id: string, versionNum: number) => {
    if (
      !confirm(
        `Deseja restaurar a versão v${versionNum}? Um backup de segurança do estado atual será criado automaticamente.`
      )
    ) {
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

  const toggleDiff = async (id: string) => {
    if (expandedVersionId === id) {
      setExpandedVersionId(null);
      return;
    }

    setExpandedVersionId(id);
    if (!versionDiffs[id]) {
      try {
        setDiffLoadingId(id);
        const params = new URLSearchParams();
        if (workspaceDir) params.set('workspaceDir', workspaceDir);

        const res = await fetch(`/api/versions/${id}/diff?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setVersionDiffs((prev) => ({ ...prev, [id]: data.diffs || [] }));
        }
      } catch (err: any) {
        console.error('Erro ao comparar versão:', err);
      } finally {
        setDiffLoadingId(null);
      }
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este snapshot de versão?')) return;
    try {
      const res = await fetch(`/api/versions/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setVersions((prev) => prev.filter((v) => v.id !== id));
        if (expandedVersionId === id) {
          setExpandedVersionId(null);
        }
      }
    } catch (err: any) {
      console.error('Erro ao excluir versão:', err);
    }
  };

  return (
    <div className="h-full w-full flex flex-col bg-[#0c0c0e]/98 text-zinc-100 select-text overflow-hidden">
      {/* Header */}
      <div className="h-10 px-2.5 border-b border-blue-500/20 flex items-center justify-between shrink-0 bg-zinc-950/90 gap-1.5 overflow-hidden">
        <div className="flex items-center gap-1.5 min-w-0">
          <History className="w-4 h-4 text-blue-400 shrink-0" />
          <span className="text-[11px] font-mono font-bold uppercase tracking-tight text-blue-400 truncate">
            SNAPSHOTS & VERSÕES
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="px-1.5 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-400 font-mono text-[9.5px] font-semibold">
            {versions.length} vers.
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

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`px-3 py-1.5 text-xs flex items-center gap-2 border-b shrink-0 ${
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
          <span className="truncate">{feedback.message}</span>
        </div>
      )}

      {/* Body List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 font-sans text-xs leading-snug">
        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2 text-zinc-400 text-xs">
            <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
            <span>Carregando snapshots...</span>
          </div>
        ) : versions.length === 0 ? (
          <div className="py-12 text-center text-zinc-500 text-xs">
            <p>Nenhum snapshot de arquivo registrado ainda.</p>
            <p className="text-[11px] mt-1 text-zinc-600">
              Snapshots são criados automaticamente sempre que o agente altera arquivos no workspace.
            </p>
          </div>
        ) : (
          versions.map((ver) => {
            const isExpanded = expandedVersionId === ver.id;
            const diffs = versionDiffs[ver.id];
            const isDiffLoading = diffLoadingId === ver.id;

            return (
              <div
                key={ver.id}
                className="rounded-lg border border-zinc-800/80 bg-zinc-900/60 overflow-hidden transition"
              >
                {/* Version Card Header */}
                <div className="p-2 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-xs font-bold text-blue-400 font-mono">
                        v{ver.versionNumber}
                      </span>
                      {ver.isBackup && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-amber-950/60 text-amber-300 border border-amber-800/50">
                          Backup
                        </span>
                      )}
                      <span className="text-[9.5px] text-zinc-500 flex items-center gap-1 truncate">
                        <Calendar className="w-2.5 h-2.5 shrink-0" />
                        {new Date(ver.createdAt).toLocaleString([], {
                          month: 'short',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => toggleDiff(ver.id)}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition cursor-pointer flex items-center gap-0.5 border ${
                          isExpanded
                            ? 'bg-blue-600/30 text-blue-300 border-blue-500/50'
                            : 'bg-zinc-800 text-zinc-300 border-zinc-700/60 hover:bg-zinc-700'
                        }`}
                        title="Inspecionar alterações comparando com o disco"
                      >
                        <GitCompare className="w-3 h-3" />
                        <span>{isExpanded ? 'Ocultar' : 'Diff'}</span>
                      </button>

                      <button
                        onClick={() => handleRestore(ver.id, ver.versionNumber)}
                        disabled={restoringId === ver.id}
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-600/30 text-blue-300 hover:bg-blue-600/50 transition cursor-pointer flex items-center gap-0.5 border border-blue-500/40"
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

                  <p className="text-[11px] text-zinc-300 line-clamp-2 leading-relaxed">
                    {ver.prompt || 'Execução automatizada do workspace'}
                  </p>

                  <div className="flex items-center justify-between text-[10px] text-zinc-500 pt-0.5 border-t border-zinc-800/40">
                    <span className="flex items-center gap-1">
                      <FileCode className="w-3 h-3 text-zinc-400" />
                      {ver.changedFiles.length} arquivos
                    </span>
                    <span className="font-mono text-zinc-400 truncate max-w-[120px]">
                      {ver.model || ver.agentName || 'gemini'}
                    </span>
                  </div>
                </div>

                {/* Collapsible Diff Details */}
                {isExpanded && (
                  <div className="border-t border-zinc-800 bg-zinc-950 p-2 text-[10.5px] font-mono space-y-2">
                    {isDiffLoading ? (
                      <div className="py-4 flex items-center justify-center gap-2 text-zinc-400 text-xs">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                        <span>Calculando diffs com o estado atual...</span>
                      </div>
                    ) : diffs && diffs.length > 0 ? (
                      diffs.map((diff, idx) => (
                        <div
                          key={idx}
                          className="rounded border border-zinc-800/80 bg-zinc-900/60 overflow-hidden"
                        >
                          <div className="px-2 py-1 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
                            <span className="font-sans text-zinc-300 text-[10.5px] truncate">
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
                          <div className="p-2 overflow-x-auto max-h-48 text-[10px] leading-tight">
                            <pre className="whitespace-pre-wrap text-zinc-300">
                              {diff.versionContent
                                ? diff.versionContent.slice(0, 1200)
                                : '(arquivo vazio no snapshot)'}
                              {diff.versionContent &&
                                diff.versionContent.length > 1200 &&
                                '\n... [conteúdo restante truncado para visualização]'}
                            </pre>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-zinc-500 text-center py-2">
                        Nenhuma divergência detectada entre este snapshot e o arquivo atual no disco.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
