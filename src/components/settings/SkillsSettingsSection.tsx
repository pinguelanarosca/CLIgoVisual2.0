import React, { useState } from 'react';
import { Plus, X, Sparkles, ChevronDown, ChevronRight, Edit2 } from 'lucide-react';
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
  const [expandedSkillName, setExpandedSkillName] = useState<string | null>(null);

  return (
    <div className="space-y-3 max-w-3xl">
      <div className="flex items-center justify-between pb-1 border-b border-zinc-200/80 dark:border-zinc-800/80">
        <div>
          <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-blue-500" />
            <span>Skills do Gemini CLI (.gemini/skills/*/SKILL.md)</span>
          </h4>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Fluxos e instruções padronizadas para acionamento especializado.
          </p>
        </div>
        <button
          type="button"
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
          className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 cursor-pointer shadow-2xs"
        >
          <Plus className="w-3 h-3" />
          <span>Nova Skill</span>
        </button>
      </div>

      <div className="space-y-1.5">
        {skills.map((skill) => {
          const isExpanded = expandedSkillName === skill.name;
          return (
            <div
              key={skill.name}
              className="rounded-md border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-900/40 hover:border-zinc-300 dark:hover:border-zinc-700 transition overflow-hidden"
            >
              <div className="p-2 flex items-center justify-between gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setExpandedSkillName(isExpanded ? null : skill.name)}
                  className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer group"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-200 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-200 shrink-0" />
                  )}
                  <span className="font-mono font-bold text-[11px] text-blue-600 dark:text-blue-400 shrink-0">
                    {skill.name}
                  </span>
                  <span className="text-[11px] text-zinc-500 truncate">
                    — {skill.description}
                  </span>
                </button>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingSkill({ ...skill });
                      setIsNewSkill(false);
                    }}
                    className="px-2 py-0.5 text-[10px] font-medium rounded bg-zinc-200/80 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition cursor-pointer flex items-center gap-1"
                  >
                    <Edit2 className="w-2.5 h-2.5" />
                    <span>Editar</span>
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="px-2 pb-2 pt-0">
                  <div className="p-2 rounded bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800/80 text-[10px] font-mono text-zinc-600 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto select-text">
                    {skill.content}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Edit Skill Modal */}
      {editingSkill && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl w-full max-w-lg p-5 space-y-3 shadow-xl text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-200 dark:border-zinc-800">
              <h4 className="font-semibold text-xs text-zinc-900 dark:text-zinc-100">
                {isNewSkill ? 'Criar Nova Skill' : `Editar Skill: ${editingSkill.name}`}
              </h4>
              <button
                type="button"
                onClick={() => setEditingSkill(null)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-[11px]">
              <div>
                <label className="block text-zinc-500 mb-0.5">Nome da Skill</label>
                <input
                  type="text"
                  disabled={!isNewSkill}
                  value={editingSkill.name}
                  onChange={(e) => setEditingSkill({ ...editingSkill, name: e.target.value })}
                  className="w-full px-2.5 py-1 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 font-mono text-zinc-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-zinc-500 mb-0.5">Descrição</label>
                <input
                  type="text"
                  value={editingSkill.description}
                  onChange={(e) => setEditingSkill({ ...editingSkill, description: e.target.value })}
                  className="w-full px-2.5 py-1 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-zinc-500 mb-0.5">Conteúdo do Procedimento (SKILL.md)</label>
                <textarea
                  rows={6}
                  value={editingSkill.content}
                  onChange={(e) => setEditingSkill({ ...editingSkill, content: e.target.value })}
                  className="w-full px-2.5 py-1.5 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 font-mono text-[10px] text-zinc-900 dark:text-zinc-100"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setEditingSkill(null)}
                className="px-2.5 py-1 text-zinc-500 cursor-pointer text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  await onSaveSkill(editingSkill);
                  setEditingSkill(null);
                }}
                className="px-3 py-1 text-xs font-semibold rounded bg-blue-600 text-white cursor-pointer hover:bg-blue-700 transition"
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
