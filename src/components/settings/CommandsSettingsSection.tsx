import React, { useState } from 'react';
import { X } from 'lucide-react';
import { CommandConfig } from '../../types.js';

interface CommandsSettingsSectionProps {
  commands: CommandConfig[];
  onSaveCommand: (cmd: CommandConfig) => Promise<void>;
  onDeleteCommand: (name: string) => Promise<void>;
}

export const CommandsSettingsSection: React.FC<CommandsSettingsSectionProps> = ({
  commands,
  onSaveCommand,
}) => {
  const [editingCommand, setEditingCommand] = useState<CommandConfig | null>(null);

  return (
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
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 font-mono">
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
                className="px-2.5 py-1 text-xs rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 cursor-pointer hover:bg-zinc-300 dark:hover:bg-zinc-600 transition"
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
              <h4 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">Editar Comando: {editingCommand.name}</h4>
              <button onClick={() => setEditingCommand(null)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer">
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
                  className="w-full px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-zinc-500 mb-1">Template de Prompt Operacional</label>
                <textarea
                  rows={6}
                  value={editingCommand.promptTemplate}
                  onChange={(e) => setEditingCommand({ ...editingCommand, promptTemplate: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 font-mono text-xs text-zinc-900 dark:text-zinc-100"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditingCommand(null)} className="px-3 py-1.5 text-xs text-zinc-500 cursor-pointer">
                Cancelar
              </button>
              <button
                onClick={async () => {
                  await onSaveCommand(editingCommand);
                  setEditingCommand(null);
                }}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white cursor-pointer hover:bg-blue-700 transition"
              >
                Salvar Comando
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
