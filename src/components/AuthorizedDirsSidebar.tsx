import React, { useState } from 'react';
import {
  FolderCheck,
  FolderPlus,
  Trash2,
  X,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Copy,
  Check,
} from 'lucide-react';
import { AuthorizedDir } from '../types.js';

interface AuthorizedDirsSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  authorizedDirs: AuthorizedDir[];
  onAddDir: (path: string) => Promise<{ success: boolean; message: string }>;
  onRemoveDir: (path: string) => Promise<{ success: boolean }>;
}

export const AuthorizedDirsSidebar: React.FC<AuthorizedDirsSidebarProps> = ({
  onClose,
  authorizedDirs,
  onAddDir,
  onRemoveDir,
}) => {
  const [newDirPath, setNewDirPath] = useState('');
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDirPath.trim()) return;

    setIsSubmitting(true);
    setStatusMessage(null);
    try {
      const res = await onAddDir(newDirPath.trim());
      if (res.success) {
        setStatusMessage({ text: res.message, isError: false });
        setNewDirPath('');
      } else {
        setStatusMessage({ text: res.message, isError: true });
      }
    } catch (err: any) {
      setStatusMessage({ text: err.message, isError: true });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemove = async (path: string) => {
    if (confirm(`Remover autorização para o diretório:\n${path}?`)) {
      await onRemoveDir(path);
    }
  };

  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 2000);
  };

  return (
    <div className="h-full w-full flex flex-col bg-[#0c0c0e]/98 text-zinc-100 select-text overflow-hidden">
      {/* Header */}
      <div className="h-10 px-2.5 border-b border-emerald-500/20 flex items-center justify-between shrink-0 bg-zinc-950/90 gap-1.5 overflow-hidden">
        <div className="flex items-center gap-1.5 min-w-0">
          <FolderCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-[11px] font-mono font-bold uppercase tracking-tight text-emerald-400 truncate">
            DIRETÓRIOS AUTORIZADOS
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-mono text-[9.5px] font-semibold">
            {authorizedDirs.length} dirs
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

      {/* Sandboxing Info Banner */}
      <div className="p-2.5 bg-emerald-950/20 border-b border-emerald-900/30 text-[11px] text-zinc-300 flex items-start gap-2 leading-relaxed shrink-0">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-emerald-300">Sandbox de Diretórios:</span> Restringe caminhos repassados via flag{' '}
          <code className="px-1 py-0.2 rounded bg-zinc-900 border border-zinc-800 font-mono text-[10px] text-emerald-400">
            --include-directories
          </code>
          .
        </div>
      </div>

      {/* Add Directory Form */}
      <div className="p-2 border-b border-zinc-800/80 bg-zinc-950/60 shrink-0">
        <form onSubmit={handleAdd} className="space-y-1.5">
          <div className="text-[10.5px] font-semibold text-zinc-300 flex items-center gap-1">
            <FolderPlus className="w-3 h-3 text-emerald-400" />
            <span>Adicionar Diretório Local</span>
          </div>

          <div className="flex gap-1.5">
            <input
              type="text"
              value={newDirPath}
              onChange={(e) => setNewDirPath(e.target.value)}
              placeholder="/home/usuario/projetos/meu-app"
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-emerald-500/50 font-mono truncate"
            />
            <button
              type="submit"
              disabled={isSubmitting || !newDirPath.trim()}
              className="px-2.5 py-1 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 transition cursor-pointer shrink-0 flex items-center gap-1"
            >
              <span>Adicionar</span>
            </button>
          </div>

          {statusMessage && (
            <div
              className={`text-[10.5px] p-1.5 rounded flex items-center gap-1.5 ${
                statusMessage.isError
                  ? 'bg-rose-950/50 text-rose-300 border border-rose-800/50'
                  : 'bg-emerald-950/50 text-emerald-300 border border-emerald-800/50'
              }`}
            >
              {statusMessage.isError ? (
                <AlertTriangle className="w-3 h-3 shrink-0" />
              ) : (
                <CheckCircle2 className="w-3 h-3 shrink-0" />
              )}
              <span className="truncate">{statusMessage.text}</span>
            </div>
          )}
        </form>
      </div>

      {/* List of Authorized Directories */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        <div className="text-[10px] uppercase font-mono font-bold text-zinc-500 tracking-wider px-1">
          Diretórios Autorizados ({authorizedDirs.length})
        </div>

        {authorizedDirs.length === 0 ? (
          <div className="py-8 text-center text-zinc-500 text-xs">
            Nenhum diretório autorizado configurado.
          </div>
        ) : (
          authorizedDirs.map((dir) => (
            <div
              key={dir.path}
              className="p-2 rounded-lg border border-zinc-800/80 bg-zinc-900/60 hover:border-zinc-700/80 transition flex flex-col gap-1.5"
            >
              <div className="flex items-start justify-between gap-1.5">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs font-semibold text-zinc-200 break-all leading-tight">
                    {dir.path}
                  </div>

                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    {dir.exists ? (
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/40">
                        Existente
                      </span>
                    ) : (
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-rose-950/60 text-rose-400 border border-rose-800/40">
                        Inacessível
                      </span>
                    )}
                    {dir.isWritable && (
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-blue-950/60 text-blue-400 border border-blue-800/40">
                        Gravável
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleCopyPath(dir.path)}
                    className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition cursor-pointer"
                    title="Copiar caminho"
                  >
                    {copiedPath === dir.path ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>

                  <button
                    onClick={() => handleRemove(dir.path)}
                    disabled={authorizedDirs.length <= 1}
                    title={
                      authorizedDirs.length <= 1
                        ? 'Mantenha ao menos 1 diretório autorizado'
                        : 'Remover autorização'
                    }
                    className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 disabled:opacity-30 transition cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
