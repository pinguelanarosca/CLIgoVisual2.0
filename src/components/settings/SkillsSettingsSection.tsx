import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { SkillConfig } from '../../types.js';

interface SkillsSettingsSectionProps {
  skills: SkillConfig[];
  onSaveSkill: (skill: SkillConfig) => Promise<void>;
  onDeleteSkill: (name: string) => Promise<void>;
}

export const SkillsSettingsSection: React.FC<SkillsSettingsSectionProps> = ({
  skills,
  onSaveSkill,
}) => {
  const [editingSkill, setEditingSkill] = useState<SkillConfig | null>(null);
  const [isNewSkill, setIsNewSkill] = useState(false);

  return (
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
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
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
                  className="px-2.5 py-1 text-xs rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 cursor-pointer hover:bg-zinc-300 dark:hover:bg-zinc-600 transition"
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
              <h4 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                {isNewSkill ? 'Criar Nova Skill' : `Editar Skill: ${editingSkill.name}`}
              </h4>
              <button onClick={() => setEditingSkill(null)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer">
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
                  className="w-full px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 font-mono text-zinc-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-zinc-500 mb-1">Descrição</label>
                <input
                  type="text"
                  value={editingSkill.description}
                  onChange={(e) => setEditingSkill({ ...editingSkill, description: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-zinc-500 mb-1">Conteúdo do Procedimento (SKILL.md)</label>
                <textarea
                  rows={6}
                  value={editingSkill.content}
                  onChange={(e) => setEditingSkill({ ...editingSkill, content: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 font-mono text-xs text-zinc-900 dark:text-zinc-100"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditingSkill(null)} className="px-3 py-1.5 text-xs text-zinc-500 cursor-pointer">
                Cancelar
              </button>
              <button
                onClick={async () => {
                  await onSaveSkill(editingSkill);
                  setEditingSkill(null);
                }}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white cursor-pointer hover:bg-blue-700 transition"
              >
                Salvar Skill
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
