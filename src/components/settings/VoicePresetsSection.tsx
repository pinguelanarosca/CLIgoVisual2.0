import React, { useState } from 'react';
import { Mic, Volume2, Save, Trash2, Plus, Volume1 } from 'lucide-react';
import { AudioSettings, VoicePreset } from '../../types.js';

interface VoicePresetsSectionProps {
  audioSettings: AudioSettings;
  onUpdateAudioSettings: (updates: Partial<AudioSettings>) => void;
}

export const VoicePresetsSection: React.FC<VoicePresetsSectionProps> = ({
  audioSettings,
  onUpdateAudioSettings,
}) => {
  const [newPresetName, setNewPresetName] = useState('');
  const [newPresetVoice, setNewPresetVoice] = useState('Kore');
  const [newPresetInstructions, setNewPresetInstructions] = useState('');

  const handleSavePreset = () => {
    if (!newPresetName.trim()) return;
    const newPreset: VoicePreset = {
      id: Date.now().toString(),
      name: newPresetName,
      voiceName: newPresetVoice,
      customInstructions: newPresetInstructions,
    };
    onUpdateAudioSettings({
      savedVoicePresets: [...audioSettings.savedVoicePresets, newPreset],
    });
    setNewPresetName('');
    setNewPresetInstructions('');
  };

  const handleDeletePreset = (id: string) => {
    onUpdateAudioSettings({
      savedVoicePresets: audioSettings.savedVoicePresets.filter((p) => p.id !== id),
    });
  };

  const applyPreset = (preset: VoicePreset) => {
    onUpdateAudioSettings({
      ttsVoice: preset.voiceName,
      ttsInstructions: preset.customInstructions,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
          <Mic className="w-4 h-4 text-emerald-500" />
          Modulação de Voz do Narrador
        </h4>
        <p className="text-xs text-zinc-500 mt-1">
          Crie e salve presets de voz personalizados combinando modelos prontos e instruções específicas.
        </p>
      </div>

      {/* New Preset Creator */}
      <div className="p-4 bg-zinc-50/50 dark:bg-zinc-800/30 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/80 space-y-3">
        <h5 className="text-xs font-bold text-zinc-800 dark:text-zinc-200">Criar Novo Preset</h5>
        <div className="grid grid-cols-2 gap-3">
          <input
            type="text"
            value={newPresetName}
            onChange={(e) => setNewPresetName(e.target.value)}
            placeholder="Nome do Preset (ex: Narrador Profundo)"
            className="col-span-2 w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500 transition"
          />
          <select
            value={newPresetVoice}
            onChange={(e) => setNewPresetVoice(e.target.value)}
            className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 font-mono"
          >
            {['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <button
            onClick={handleSavePreset}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Salvar Preset
          </button>
        </div>
        <textarea
          value={newPresetInstructions}
          onChange={(e) => setNewPresetInstructions(e.target.value)}
          placeholder="Modulação (ex: fale devagar, com tom grave e calmo)"
          rows={2}
          className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
        />
      </div>

      {/* Saved Presets List */}
      <div className="space-y-3">
        <h5 className="text-xs font-bold text-zinc-800 dark:text-zinc-200">Presets Salvos</h5>
        {audioSettings.savedVoicePresets.length === 0 ? (
          <p className="text-xs text-zinc-500 italic">Nenhum preset salvo.</p>
        ) : (
          audioSettings.savedVoicePresets.map((preset) => (
            <div
              key={preset.id}
              className="flex items-center justify-between p-3 bg-white dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700"
            >
              <div className="flex items-center gap-3">
                <Volume1 className="w-4 h-4 text-zinc-400" />
                <div>
                  <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{preset.name}</div>
                  <div className="text-[10px] text-zinc-500">{preset.voiceName} • {preset.customInstructions.substring(0, 30)}...</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => applyPreset(preset)}
                  className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold hover:bg-emerald-500/20 transition cursor-pointer"
                >
                  Aplicar
                </button>
                <button
                  onClick={() => handleDeletePreset(preset.id)}
                  className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 transition cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
