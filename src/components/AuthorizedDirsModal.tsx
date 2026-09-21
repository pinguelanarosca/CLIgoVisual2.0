import React, { useState } from 'react';
import {
  FolderCheck,
  FolderPlus,
  Trash2,
  X,
  AlertTriangle,
  CheckCircle2,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import { AuthorizedDir } from '../types.js';

interface AuthorizedDirsModalProps {
  isOpen: boolean;
  onClose: () => void;
  authorizedDirs: AuthorizedDir[];
  onAddDir: (path: string) => Promise<{ success: boolean; message: string }>;
  onRemoveDir: (path: string) => Promise<{ success: boolean }>;
}

export const AuthorizedDirsModal: React.FC<AuthorizedDirsModalProps> = ({
  isOpen,
  onClose,
  authorizedDirs,
  onAddDir,
  onRemoveDir,
}) => {
  const [newDirPath, setNewDirPath] = useState('');
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
              <FolderCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm">
                Diretórios Autorizados
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Restringir acesso do Gemini CLI aos diretórios explicitamente aprovados
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Informative Warning Banner */}
        <div className="px-6 py-3 bg-blue-50/50 dark:bg-blue-950/20 border-b border-blue-100 dark:border-blue-900/30 text-xs text-zinc-600 dark:text-zinc-300 flex items-start gap-2.5 leading-relaxed">
          <ShieldCheck className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
          <div>
            <strong className="font-semibold text-zinc-800 dark:text-zinc-200">
              Modelo de Segurança em Camadas:
            </strong>{' '}
            A GUI restringe os caminhos repassados ao processo via flag{' '}
            <code className="px-1 py-0.5 rounded bg-blue-100/60 dark:bg-blue-900/60 font-mono text-[11px]">
              --include-directories
            </code>
            . As operações ocorrem no filesystem real do Ubuntu respeitando as permissões do usuário logado.
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Add form */}
          <form onSubmit={handleAdd} className="space-y-2">
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Adicionar Novo Diretório Local
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newDirPath}
                onChange={(e) => setNewDirPath(e.target.value)}
                placeholder="/home/usuario/projetos/meu-app"
                className="flex-1 px-3 py-2 text-xs rounded-xl bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                disabled={isSubmitting || !newDirPath.trim()}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40 transition shadow-sm"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                <span>Autorizar</span>
              </button>
            </div>
            {statusMessage && (
              <div
                className={`text-xs p-2.5 rounded-lg flex items-center gap-2 ${
                  statusMessage.isError
                    ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400'
                    : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {statusMessage.isError ? (
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                )}
                <span>{statusMessage.text}</span>
              </div>
            )}
          </form>

          {/* List of currently authorized directories */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3">
              Diretórios Atualmente Autorizados ({authorizedDirs.length})
            </h4>

            <div className="space-y-2">
              {authorizedDirs.map((dir) => (
                <div
                  key={dir.path}
                  className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 flex items-center justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                        {dir.path}
                      </span>
                      {dir.exists ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400">
                          Existente
                        </span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-400">
                          Inacessível
                        </span>
                      )}
                      {dir.isWritable && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400">
                          Gravável
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => handleRemove(dir.path)}
                    disabled={authorizedDirs.length <= 1}
                    title={
                      authorizedDirs.length <= 1
                        ? 'É necessário manter ao menos um diretório autorizado'
                        : 'Remover autorização'
                    }
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-30 transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium rounded-xl bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
