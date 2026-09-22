import { VoiceAgent, VoiceDirectorConfig } from './voiceTypes.js';
import { FACTORY_VOICE_AGENTS } from './voicePresets.js';
import { compileDirectorPrompt } from './voiceDirector.js';

const STORAGE_KEY = 'gemini_voice_agents_v1';
const SYSTEM_DEFAULTS_KEY = 'gemini_voice_system_defaults_v1';

export interface SystemVoiceDefaults {
  ttsAgentId: string;
  sttAgentId: string;
}

// Load agents from localStorage with factory fallback
export function getSavedVoiceAgents(): VoiceAgent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Seed with factory defaults
      localStorage.setItem(STORAGE_KEY, JSON.stringify(FACTORY_VOICE_AGENTS));
      return FACTORY_VOICE_AGENTS;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return FACTORY_VOICE_AGENTS;
  } catch (e) {
    console.error('Erro ao ler agentes de voz salvos:', e);
    return FACTORY_VOICE_AGENTS;
  }
}

// Save agents list to localStorage
export function saveVoiceAgents(agents: VoiceAgent[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(agents));
  } catch (e) {
    console.error('Erro ao salvar agentes de voz:', e);
  }
}

// Get system defaults for TTS and STT
export function getSystemVoiceDefaults(): SystemVoiceDefaults {
  try {
    const raw = localStorage.getItem(SYSTEM_DEFAULTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.ttsAgentId && parsed.sttAgentId) {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Erro ao ler padrões de voz do sistema:', e);
  }
  // Default to factory narrator
  return {
    ttsAgentId: 'agent_narrador_oficial',
    sttAgentId: 'agent_narrador_oficial',
  };
}

// Save system defaults
export function saveSystemVoiceDefaults(defaults: SystemVoiceDefaults): void {
  try {
    localStorage.setItem(SYSTEM_DEFAULTS_KEY, JSON.stringify(defaults));
  } catch (e) {
    console.error('Erro ao salvar padrões de voz do sistema:', e);
  }
}

// Create new Voice Agent
export function createVoiceAgent(
  name: string,
  description: string,
  config: VoiceDirectorConfig,
  sttInstructions?: string,
  type: 'narrator' | 'transcriber' | 'hybrid' = 'narrator',
  customCompiledPrompt?: string
): VoiceAgent {
  const agents = getSavedVoiceAgents();
  const compiledPrompt = customCompiledPrompt !== undefined ? customCompiledPrompt : compileDirectorPrompt(config);

  const newAgent: VoiceAgent = {
    id: `agent_custom_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    name,
    description: description || 'Agente de voz personalizado criado via CDJ.',
    type,
    config,
    directorPrompt: compiledPrompt,
    sttInstructions,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  agents.unshift(newAgent);
  saveVoiceAgents(agents);
  return newAgent;
}

// Update existing Voice Agent
export function updateVoiceAgent(id: string, updates: Partial<VoiceAgent>): VoiceAgent | null {
  const agents = getSavedVoiceAgents();
  const idx = agents.findIndex((a) => a.id === id);
  if (idx === -1) return null;

  const current = agents[idx];
  const updatedConfig = updates.config ? { ...current.config, ...updates.config } : current.config;
  const compiledPrompt = updates.directorPrompt || compileDirectorPrompt(updatedConfig);

  const updatedAgent: VoiceAgent = {
    ...current,
    ...updates,
    config: updatedConfig,
    directorPrompt: compiledPrompt,
    updatedAt: Date.now(),
  };

  agents[idx] = updatedAgent;
  saveVoiceAgents(agents);
  return updatedAgent;
}

// Duplicate Voice Agent
export function duplicateVoiceAgent(id: string): VoiceAgent | null {
  const agents = getSavedVoiceAgents();
  const source = agents.find((a) => a.id === id);
  if (!source) return null;

  const duplicated: VoiceAgent = {
    ...source,
    id: `agent_copy_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    name: `${source.name} (Cópia)`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isSystemDefaultTts: false,
    isSystemDefaultStt: false,
  };

  agents.unshift(duplicated);
  saveVoiceAgents(agents);
  return duplicated;
}

// Delete Voice Agent
export function deleteVoiceAgent(id: string): boolean {
  let agents = getSavedVoiceAgents();
  const initialLength = agents.length;
  agents = agents.filter((a) => a.id !== id);

  if (agents.length !== initialLength) {
    saveVoiceAgents(agents);
    return true;
  }
  return false;
}

// Export Agents to JSON string
export function exportVoiceAgentsToJson(agentIds?: string[]): string {
  const agents = getSavedVoiceAgents();
  const listToExport = agentIds ? agents.filter((a) => agentIds.includes(a.id)) : agents;
  return JSON.stringify(listToExport, null, 2);
}

// Import Agents from JSON string
export function importVoiceAgentsFromJson(jsonStr: string): { importedCount: number; error?: string } {
  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) {
      return { importedCount: 0, error: 'O arquivo JSON deve conter um array de Agentes de Voz.' };
    }

    const agents = getSavedVoiceAgents();
    let importedCount = 0;

    for (const item of parsed) {
      if (item.name && item.config) {
        const importedAgent: VoiceAgent = {
          ...item,
          id: `agent_imp_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          name: item.name.startsWith('Importado') ? item.name : `${item.name} (Importado)`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          isSystemDefaultTts: false,
          isSystemDefaultStt: false,
        };
        agents.unshift(importedAgent);
        importedCount++;
      }
    }

    if (importedCount > 0) {
      saveVoiceAgents(agents);
    }
    return { importedCount };
  } catch (e: any) {
    return { importedCount: 0, error: `Falha ao importar agentes: ${e.message}` };
  }
}

// Set System Default TTS Agent
export function setSystemDefaultTtsAgent(agentId: string): void {
  const agents = getSavedVoiceAgents();
  const updated = agents.map((a) => ({
    ...a,
    isSystemDefaultTts: a.id === agentId,
  }));
  saveVoiceAgents(updated);

  const defaults = getSystemVoiceDefaults();
  defaults.ttsAgentId = agentId;
  saveSystemVoiceDefaults(defaults);
}

// Set System Default STT Agent
export function setSystemDefaultSttAgent(agentId: string): void {
  const agents = getSavedVoiceAgents();
  const updated = agents.map((a) => ({
    ...a,
    isSystemDefaultStt: a.id === agentId,
  }));
  saveVoiceAgents(updated);

  const defaults = getSystemVoiceDefaults();
  defaults.sttAgentId = agentId;
  saveSystemVoiceDefaults(defaults);
}
