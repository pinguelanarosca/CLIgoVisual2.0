import React, { useState, useEffect } from 'react';
import { Brain, ShieldCheck, Save, Loader2, CheckCircle2, Sparkles } from 'lucide-react';
import { MemoryAgentConfig, SharedMemoryItem } from '../../types.js';
import { fetchJsonSafely } from '../../utils/apiUtils.js';

export const MemoryAgentSettingsSection: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [memories, setMemories] = useState<SharedMemoryItem[]>([]);
  const [selectedMemId, setSelectedMemId] = useState<string>('');
  const [config, setConfig] = useState<MemoryAgentConfig>({
    name: 'Agente da Memória',
    model: 'gemini-2.5-flash',
    systemInstructions: `Você é o Agente da Memória (Agente Recluso).\nSua função ÚNICA e EXCLUSIVA é manter, organizar, resumir e refatorar o conteúdo da Memória Compartilhada.\nREGRAS RÍGIDAS:\n1. Não possui acesso a ferramentas externas ou arquivos do projeto.\n2. Seu escopo é estritamente o texto recebido.\n3. Mantenha marcadores de pipeline (○, →, ✓, ✕) preservados.`,
    temperature: 0.2,
  });
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    fetchMemories();
  }, []);

  const fetchMemories = async () => {
    try {
      setLoading(true);
      const data = await fetchJsonSafely<SharedMemoryItem[]>('/api/memories', undefined, []);
      if (data && Array.isArray(data)) {
        setMemories(data);
        if (data.length > 0) {
          setSelectedMemId(data[0].id);
          if (data[0].agentConfig) {
            setConfig(data[0].agentConfig);
          }
        }
      }
    } catch (err) {
      console.error('Falha ao obter memórias:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectMem = (id: string) => {
    setSelectedMemId(id);
    const target = memories.find((m) => m.id === id);
    if (target?.agentConfig) {
      setConfig(target.agentConfig);
    }
  };

  const handleSave = async () => {
    if (!selectedMemId) return;
    try {
      setSaving(true);
      const res = await fetch(`/api/memories/${selectedMemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentConfig: config }),
      });
      if (res.ok) {
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 2500);
      }
    } catch (err) {
      console.error('Falha ao salvar configuração do Agente da Memória:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 max-w-3xl text-xs">
      <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
        <div>
          <h4 className="text-sm font-semibold text-zinc-100 flex items-center gap-1.5">
            <Brain className="w-4 h-4 text-purple-400" />
            Configuração do Agente da Memória (Agente Recluso)
          </h4>
          <p className="text-[11px] text-zinc-400 mt-0.5">
            Agente autônomo e isolado dedicado exclusivamente à organização do contexto compartilhado.
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || loading}
          className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-medium rounded-lg transition cursor-pointer flex items-center gap-1.5"
        >
          {saving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : savedSuccess ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          <span>{savedSuccess ? 'Salvo' : 'Salvar Ajustes'}</span>
        </button>
      </div>

      {/* Security Isolation Notice */}
      <div className="p-2.5 rounded-lg bg-purple-950/20 border border-purple-800/40 flex items-start gap-2 text-purple-200">
        <ShieldCheck className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
        <div className="text-[11px] leading-relaxed">
          <strong>Isolamento de Segurança Garantido:</strong> Este agente NÃO possui acesso a ferramentas externas, MCPs, execução de comandos bash ou modificação de arquivos de projeto. Toda atuação é restrita à formatação e refatoração do texto da Memória Compartilhada.
        </div>
      </div>

      {/* Target Memory Select */}
      {memories.length > 1 && (
        <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1">
          <label className="text-[11px] text-zinc-400 font-medium">Memória Alvo:</label>
          <select
            value={selectedMemId}
            onChange={(e) => handleSelectMem(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 text-xs text-zinc-200 outline-hidden"
          >
            {memories.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} (v{m.versions.length})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Form Fields */}
      <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-zinc-400 font-medium block mb-1">
              Nome do Agente
            </label>
            <input
              type="text"
              value={config.name}
              onChange={(e) => setConfig({ ...config, name: e.target.value })}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 text-xs outline-hidden focus:border-purple-500/60"
            />
          </div>

          <div>
            <label className="text-[11px] text-zinc-400 font-medium block mb-1">
              Modelo Gemini
            </label>
            <select
              value={config.model}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-200 text-xs outline-hidden focus:border-purple-500/60"
            >
              <option value="gemini-2.5-flash">Gemini 2.5 Flash (Recomendado)</option>
              <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (Ultrarrápido)</option>
              <option value="gemini-2.5-pro">Gemini 2.5 Pro (Raciocínio Complexo)</option>
            </select>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] text-zinc-400 font-medium">
              Temperatura ({config.temperature ?? 0.2})
            </label>
            <span className="text-[10px] text-zinc-500">Determinístico / Preciso</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={config.temperature ?? 0.2}
            onChange={(e) => setConfig({ ...config, temperature: parseFloat(e.target.value) })}
            className="w-full accent-purple-500 cursor-pointer"
          />
        </div>

        <div>
          <label className="text-[11px] text-zinc-400 font-medium block mb-1">
            System Instructions (Diretrizes Operacionais)
          </label>
          <textarea
            rows={6}
            value={config.systemInstructions}
            onChange={(e) => setConfig({ ...config, systemInstructions: e.target.value })}
            className="w-full bg-zinc-950 border border-zinc-800 rounded p-2.5 text-zinc-200 text-xs font-mono outline-hidden focus:border-purple-500/60 leading-relaxed resize-y"
          />
        </div>
      </div>
    </div>
  );
};
