import path from 'node:path';
import fs from 'node:fs';
import { GoogleGenAI } from '@google/genai';
import { getGuiGeminiDir } from './paths-service.js';
import { loadAgents } from './agents-service.js';

export interface MemoryVersionEntry {
  version: number;
  content: string;
  timestamp: string;
  author: 'user' | 'agent';
  description?: string;
}

export interface MemoryAgentConfig {
  name: string;
  model: string;
  agentId?: string;
  systemInstructions: string;
  temperature?: number;
}

export interface SharedMemoryItem {
  id: string;
  name: string;
  description: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  projectId?: string;
  sessionId?: string;
  scope?: 'project' | 'session' | 'global';
  agentConfig?: MemoryAgentConfig;
  versions: MemoryVersionEntry[];
}

const getMemoriesFile = () => path.join(getGuiGeminiDir(), 'memories.json');

export const DEFAULT_MEMORY_AGENT_INSTRUCTIONS = `Você é o Agente da Memória (Agente Recluso).
Sua função ÚNICA e EXCLUSIVA é manter, organizar, estruturar e refatorar o conteúdo da Memória Compartilhada.
REGRAS RÍGIDAS DE ISOLAMENTO:
1. Você opera de forma 100% reclusa: NÃO possui acesso à web, terminal, arquivos ou comandos externos.
2. Seu escopo de trabalho e contexto é ESTREITAMENTE o texto fornecido da janela de memória.
3. Responda APENAS com o texto final atualizado e formatado da memória, sem introduções, cumprimentos ou explicações fora do documento.
4. Preserve as diretrizes, decisões técnicas e a sintaxe dos marcadores de pipeline (○ pendente, → em andamento, ✓ concluído, ✕ falhou).`;

export function loadMemories(projectId?: string, sessionId?: string): SharedMemoryItem[] {
  const file = getMemoriesFile();
  let list: SharedMemoryItem[] = [];

  if (!fs.existsSync(file)) {
    const defaultMemory: SharedMemoryItem = {
      id: 'mem_default',
      name: 'Contexto Operacional Principal',
      description: 'Pipeline de trabalho e registros de decisões técnicas',
      content: `FLUXO DE TRABALHO\n✓ 1. Inicialização do ambiente\n→ 2. Otimização de interfaces e semântica\n○ 3. Validação de integrações de terminal\n\nDEBUG & NOTAS TÉCNICAS\nNenhum erro bloqueante registrado.`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scope: 'global',
      agentConfig: {
        name: 'Agente da Memória',
        model: 'gemini-2.5-flash',
        agentId: 'principal',
        systemInstructions: DEFAULT_MEMORY_AGENT_INSTRUCTIONS,
        temperature: 0.2,
      },
      versions: [
        {
          version: 1,
          content: `FLUXO DE TRABALHO\n✓ 1. Inicialização do ambiente\n→ 2. Otimização de interfaces e semântica\n○ 3. Validação de integrações de terminal\n\nDEBUG & NOTAS TÉCNICAS\nNenhum erro bloqueante registrado.`,
          timestamp: new Date().toISOString(),
          author: 'user',
          description: 'Criação inicial da memória',
        },
      ],
    };
    list = [defaultMemory];
    saveMemories(list);
  } else {
    try {
      const raw = fs.readFileSync(file, 'utf-8');
      list = JSON.parse(raw);
    } catch (err) {
      console.error('Erro ao ler memories.json:', err);
      list = [];
    }
  }

  return list;
}

export function saveMemories(memories: SharedMemoryItem[]): void {
  const file = getMemoriesFile();
  try {
    fs.writeFileSync(file, JSON.stringify(memories, null, 2), 'utf-8');
  } catch (err) {
    console.error('Erro ao salvar memories.json:', err);
  }
}

export function getMemory(id: string): SharedMemoryItem | null {
  const memories = loadMemories();
  return memories.find((m) => m.id === id) || null;
}

/**
 * Obtém ou cria a memória efetiva correspondente ao escopo do usuário:
 * - Se projectId fornecido: retorna a memória compartilhada do projeto (compartilhada entre todos os chats desse projeto)
 * - Se sessionId fornecido (sem projectId): retorna a memória isolada para esta conversa
 * - Fallback: memória global
 */
export function getOrCreateEffectiveMemory(params: {
  projectId?: string;
  projectName?: string;
  sessionId?: string;
  sessionTitle?: string;
}): SharedMemoryItem {
  const memories = loadMemories();
  const now = new Date().toISOString();

  // 1. Escopo de Projeto
  if (params.projectId) {
    const existing = memories.find((m) => m.projectId === params.projectId);
    if (existing) return existing;

    const projName = params.projectName || 'Projeto';
    const newProjMem: SharedMemoryItem = {
      id: `mem_proj_${params.projectId}`,
      name: `Memória - ${projName}`,
      description: `Memória persistente compartilhada entre todos os chats do projeto "${projName}"`,
      projectId: params.projectId,
      scope: 'project',
      content: `FLUXO DE TRABALHO DO PROJETO\n○ 1. Mapeamento dos requisitos\n○ 2. Implementação das tarefas\n○ 3. Testes e validação\n\nDECISÕES TÉCNICAS & DEBUG\n- Contexto persistente compartilhado entre todas as conversas do projeto.`,
      createdAt: now,
      updatedAt: now,
      agentConfig: {
        name: 'Agente da Memória',
        model: 'gemini-2.5-flash',
        agentId: 'principal',
        systemInstructions: DEFAULT_MEMORY_AGENT_INSTRUCTIONS,
        temperature: 0.2,
      },
      versions: [
        {
          version: 1,
          content: `FLUXO DE TRABALHO DO PROJETO\n○ 1. Mapeamento dos requisitos\n○ 2. Implementação das tarefas\n○ 3. Testes e validação\n\nDECISÕES TÉCNICAS & DEBUG\n- Contexto persistente compartilhado entre todas as conversas do projeto.`,
          timestamp: now,
          author: 'user',
          description: 'Inicialização da memória compartilhada do projeto',
        },
      ],
    };
    memories.push(newProjMem);
    saveMemories(memories);
    return newProjMem;
  }

  // 2. Escopo de Sessão / Conversa Isolada
  if (params.sessionId) {
    const existing = memories.find((m) => m.sessionId === params.sessionId);
    if (existing) return existing;

    const title = params.sessionTitle || 'Conversa';
    const newSessMem: SharedMemoryItem = {
      id: `mem_sess_${params.sessionId}`,
      name: `Memória - ${title}`,
      description: `Memória isolada desta conversa`,
      sessionId: params.sessionId,
      scope: 'session',
      content: `FLUXO DESTA CONVERSA\n○ 1. Definir objetivo\n○ 2. Executar ações\n\nREGISTROS & PIPELINE\n- Memória isolada para esta sessão.`,
      createdAt: now,
      updatedAt: now,
      agentConfig: {
        name: 'Agente da Memória',
        model: 'gemini-2.5-flash',
        agentId: 'worker',
        systemInstructions: DEFAULT_MEMORY_AGENT_INSTRUCTIONS,
        temperature: 0.2,
      },
      versions: [
        {
          version: 1,
          content: `FLUXO DESTA CONVERSA\n○ 1. Definir objetivo\n○ 2. Executar ações\n\nREGISTROS & PIPELINE\n- Memória isolada para esta sessão.`,
          timestamp: now,
          author: 'user',
          description: 'Inicialização da memória isolada da conversa',
        },
      ],
    };
    memories.push(newSessMem);
    saveMemories(memories);
    return newSessMem;
  }

  // 3. Fallback: primeira memória existente ou default
  return memories[0] || createMemory({ name: 'Memória Global' });
}

export function createMemory(params: {
  name: string;
  description?: string;
  content?: string;
  projectId?: string;
  sessionId?: string;
  scope?: 'project' | 'session' | 'global';
  agentConfig?: MemoryAgentConfig;
}): SharedMemoryItem {
  const memories = loadMemories();
  const id = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const initialContent = params.content || 'FLUXO DE TRABALHO\n○ 1. Tarefa inicial\n\nNOTAS\n...';
  const now = new Date().toISOString();

  const newMemory: SharedMemoryItem = {
    id,
    name: params.name || 'Nova Memória',
    description: params.description || '',
    content: initialContent,
    createdAt: now,
    updatedAt: now,
    projectId: params.projectId,
    sessionId: params.sessionId,
    scope: params.scope || (params.projectId ? 'project' : params.sessionId ? 'session' : 'global'),
    agentConfig: params.agentConfig || {
      name: 'Agente da Memória',
      model: 'gemini-2.5-flash',
      agentId: 'principal',
      systemInstructions: DEFAULT_MEMORY_AGENT_INSTRUCTIONS,
      temperature: 0.2,
    },
    versions: [
      {
        version: 1,
        content: initialContent,
        timestamp: now,
        author: 'user',
        description: 'Criação inicial',
      },
    ],
  };

  memories.push(newMemory);
  saveMemories(memories);
  return newMemory;
}

export function updateMemoryContent(
  id: string,
  newContent: string,
  author: 'user' | 'agent' = 'user',
  description?: string
): SharedMemoryItem | null {
  const memories = loadMemories();
  const mem = memories.find((m) => m.id === id);
  if (!mem) return null;

  if (mem.content.trim() === newContent.trim()) {
    return mem;
  }

  const nextVersionNum = (mem.versions?.length || 0) + 1;
  const now = new Date().toISOString();

  mem.content = newContent;
  mem.updatedAt = now;
  if (!mem.versions) mem.versions = [];
  mem.versions.unshift({
    version: nextVersionNum,
    content: newContent,
    timestamp: now,
    author,
    description: description || (author === 'agent' ? 'Refatoração pelo Agente Recluso' : 'Edição manual do usuário'),
  });

  saveMemories(memories);
  return mem;
}

export function updateMemoryMetadata(
  id: string,
  updates: Partial<Pick<SharedMemoryItem, 'name' | 'description' | 'agentConfig' | 'projectId' | 'sessionId' | 'scope'>>
): SharedMemoryItem | null {
  const memories = loadMemories();
  const mem = memories.find((m) => m.id === id);
  if (!mem) return null;

  if (updates.name !== undefined) mem.name = updates.name;
  if (updates.description !== undefined) mem.description = updates.description;
  if (updates.projectId !== undefined) mem.projectId = updates.projectId;
  if (updates.sessionId !== undefined) mem.sessionId = updates.sessionId;
  if (updates.scope !== undefined) mem.scope = updates.scope;
  if (updates.agentConfig !== undefined) {
    mem.agentConfig = { ...mem.agentConfig, ...updates.agentConfig } as any;
  }

  mem.updatedAt = new Date().toISOString();
  saveMemories(memories);
  return mem;
}

export function restoreMemoryVersion(id: string, versionNumber: number): SharedMemoryItem | null {
  const memories = loadMemories();
  const mem = memories.find((m) => m.id === id);
  if (!mem) return null;

  const targetVersion = mem.versions?.find((v) => v.version === versionNumber);
  if (!targetVersion) return null;

  return updateMemoryContent(
    id,
    targetVersion.content,
    'user',
    `Restauração da versão v${versionNumber}`
  );
}

export function deleteMemory(id: string): boolean {
  const memories = loadMemories();
  const filtered = memories.filter((m) => m.id !== id);
  if (filtered.length === memories.length) return false;
  saveMemories(filtered);
  return true;
}

/**
 * Agente da Memória (Agente Recluso):
 * Opera estritamente dentro do contexto desta janela de memória.
 * Não possui acesso à web nem ferramentas de SO.
 */
export async function refactorMemoryWithAgent(
  id: string,
  userInstruction: string,
  selectedAgentId?: string,
  customModel?: string
): Promise<{ success: boolean; memory?: SharedMemoryItem; error?: string }> {
  const mem = getMemory(id);
  if (!mem) {
    return { success: false, error: 'Memória não encontrada' };
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      error: 'GEMINI_API_KEY não configurada no ambiente para o Agente da Memória.',
    };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    // Resolver modelo baseado no agente selecionado se fornecido
    let targetModel = customModel || mem.agentConfig?.model || 'gemini-2.5-flash';
    let agentDisplayName = 'Agente Recluso';

    if (selectedAgentId) {
      const allAgents = loadAgents();
      const matched = allAgents.find((a) => a.id === selectedAgentId || a.name === selectedAgentId);
      if (matched) {
        if (matched.model) targetModel = matched.model;
        agentDisplayName = matched.displayName || matched.name;
      }
    }

    const systemPrompt = mem.agentConfig?.systemInstructions || DEFAULT_MEMORY_AGENT_INSTRUCTIONS;
    const prompt = `[CONTEXTO DA MEMÓRIA COMPARTILHADA]\n${mem.content}\n\n[INSTRUÇÃO DO USUÁRIO PARA O AGENTE RECLUSO]\n${userInstruction}\n\nRetorne exclusivamente o conteúdo completo, refatorado e atualizado da memória mantendo o padrão técnico:`;

    const response = await ai.models.generateContent({
      model: targetModel,
      contents: prompt,
      config: {
        systemInstruction: systemPrompt,
        temperature: mem.agentConfig?.temperature ?? 0.2,
      },
    });

    const refactoredContent = response.text?.trim();
    if (!refactoredContent) {
      return { success: false, error: 'Nenhuma resposta retornada pelo modelo.' };
    }

    // Se o agente selecionado mudou, atualizar a configuração da memória
    if (selectedAgentId && mem.agentConfig?.agentId !== selectedAgentId) {
      updateMemoryMetadata(id, {
        agentConfig: {
          ...mem.agentConfig,
          name: agentDisplayName,
          agentId: selectedAgentId,
          model: targetModel,
          systemInstructions: systemPrompt,
        },
      });
    }

    const updated = updateMemoryContent(
      id,
      refactoredContent,
      'agent',
      `${agentDisplayName}: ${userInstruction.slice(0, 50)}`
    );

    return { success: true, memory: updated || undefined };
  } catch (err: any) {
    console.error('Erro ao processar instrução com Agente da Memória:', err);
    return { success: false, error: err.message || 'Falha ao acionar Agente da Memória' };
  }
}
