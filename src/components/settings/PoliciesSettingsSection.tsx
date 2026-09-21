import React, { useState } from 'react';
import { ShieldCheck, Plus, Code2, Trash2, X } from 'lucide-react';
import { PolicyConfig } from '../../types.js';

interface PoliciesSettingsSectionProps {
  policies: PolicyConfig[];
  onSavePolicy: (policy: PolicyConfig, originalFilename?: string) => Promise<void>;
  onDeletePolicy: (filename: string) => Promise<void>;
}

export const PoliciesSettingsSection: React.FC<PoliciesSettingsSectionProps> = ({
  policies,
  onSavePolicy,
  onDeletePolicy,
}) => {
  const [editingPolicy, setEditingPolicy] = useState<PolicyConfig | null>(null);
  const [originalFilename, setOriginalFilename] = useState<string | null>(null);
  const [isNewPolicy, setIsNewPolicy] = useState(false);

  return (
    <div className="space-y-6 animate-in slide-in-from-right duration-300">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            Motor de Políticas (Policy Engine)
          </h4>
          <p className="text-xs text-zinc-500 mt-1">
            Defina regras de segurança e governança para ferramentas em <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded font-mono">.gemini/policies/*.toml</code>
          </p>
        </div>
        <button
          onClick={() => {
            setEditingPolicy({ filename: 'nova-politica.toml', content: '[[rule]]\ntoolName = "*"\ndecision = "ask_user"\npriority = 100\n' });
            setOriginalFilename(null);
            setIsNewPolicy(true);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition shadow-sm cursor-pointer"
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
                    className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 transition cursor-pointer"
                    title="Editar Política"
                  >
                    <Code2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={async () => {
                      if (confirm(`Deseja realmente remover a política "${policy.filename}"?`)) {
                        await onDeletePolicy(policy.filename);
                      }
                    }}
                    className="p-1.5 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/30 text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 transition cursor-pointer"
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
              <button onClick={() => setEditingPolicy(null)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition cursor-pointer">
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
                    <Code2 className="w-10 h-10 text-zinc-400" />
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
                className="px-4 py-2 text-xs font-semibold text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                disabled={!editingPolicy.filename || !editingPolicy.filename.endsWith('.toml')}
                onClick={async () => {
                  await onSavePolicy(editingPolicy, originalFilename || undefined);
                  setEditingPolicy(null);
                }}
                className="px-6 py-2 text-xs font-bold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition shadow-md cursor-pointer"
              >
                Salvar Política
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
