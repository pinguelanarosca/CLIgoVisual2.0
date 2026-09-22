import path from 'node:path';
import fs from 'node:fs';
import { GoogleGenAI } from '@google/genai';
import { getGuiDataDir } from './paths-service.js';
import { SharedMemoryItem, SharedMemoryVersion, MemoryAgentConfig } from '../src/types.js';
import { sysLog } from './logger-service.js';

function getMemoriesFilePath(): string {
  return path.join(getGuiDataDir(), 'shared_memories.json');
}

function getMemoryAgentConfigPath(): string {
  return path.join(getGuiDataDir(), 'memory_agent_config.json');
}

export function loadMemoryAgentConfig(): MemoryAgentConfig {
  const configPath = getMemoryAgentConfigPath();
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(raw);
    } catch {}
  }

  return {
    name: 'Agente da Memória',
    model: 'gemini-3.5-flash-lite',
    temperature: 0.3,
    instructions:
      'Você é o Agente da Memória do Gemini CLI GUI. Você é estritamente isolado e NÃO possui ferramentas, acesso ao sistema de arquivos nem comandos de terminal. Sua função única é organizar, estruturar, limpar, padronizar, resumir e refatorar o texto da memória viva compartilhada de acordo com as instruções do usuário.',
    statusGrade: 'CONFIGURED',
  };
}

export function saveMemoryAgentConfig(config: MemoryAgentConfig): void {
  const configPath = getMemoryAgentConfigPath();
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    sysLog.info('CONFIG', 'Configuração do Agente da Memória salva com sucesso.');
  } catch (err: any) {
    sysLog.error('CONFIG', `Erro ao salvar configuração do Agente da Memória: ${err?.message}`);
  }
}

const DEFAULT_INITIAL_CONTENT = `# FLUXO DE TRABALHO
○ 1. Mapeamento e alinhamento de requisitos
○ 2. Execução das modificações técnicas
○ 3. Validação de lint, testes e integridade

# REGISTRO DE TENTATIVAS & DIAGNÓSTICO
Problema:
Nenhum problema crítico ativo registrado.

Tentativas realizadas:
- Nenhuma abordagem falha registrada até o momento.

Soluções confirmadas:
- Arquitetura base inicial validada.

# NOTAS & DECISÕES TÉCNICAS
- Evitar repetir abordagens marcadas como falhas.
`;

function getSeedMemories(): SharedMemoryItem[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'mem_default_general',
      name: 'Memória Operacional Geral',
      description: 'Estado compartilhado entre humano e agentes para pipelines, decisões e prevenção de falhas repetidas.',
      content: DEFAULT_INITIAL_CONTENT,
      createdAt: now,
      updatedAt: now,
      versions: [
        {
          id: 'v1_init',
          versionNumber: 1,
          content: DEFAULT_INITIAL_CONTENT,
          timestamp: now,
          author: 'user',
          summary: 'Criação inicial da memória operacional',
        },
      ],
    },
  ];
}

export function loadAllMemories(): SharedMemoryItem[] {
  const filePath = getMemoriesFilePath();
  if (!fs.existsSync(filePath)) {
    const seeded = getSeedMemories();
    saveAllMemories(seeded);
    return seeded;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      const seeded = getSeedMemories();
      saveAllMemories(seeded);
      return seeded;
    }
    return parsed;
  } catch (err: any) {
    sysLog.warn('SYSTEM', `Erro ao ler shared_memories.json: ${err?.message}`);
    return getSeedMemories();
  }
}

export function saveAllMemories(memories: SharedMemoryItem[]): void {
  const filePath = getMemoriesFilePath();
  try {
    fs.writeFileSync(filePath, JSON.stringify(memories, null, 2), 'utf-8');
  } catch (err: any) {
    sysLog.error('SYSTEM', `Erro ao salvar shared_memories.json: ${err?.message}`);
  }
}

export function getMemories(projectId?: string): SharedMemoryItem[] {
  const memories = loadAllMemories();
  if (projectId) {
    return memories.filter((m) => !m.projectId || m.projectId === projectId);
  }
  return memories;
}

export function getMemoryById(id: string): SharedMemoryItem | undefined {
  const memories = loadAllMemories();
  return memories.find((m) => m.id === id);
}

export function createMemory(params: {
  name: string;
  description?: string;
  content?: string;
  projectId?: string;
  associatedAgentId?: string;
}): SharedMemoryItem {
  const memories = loadAllMemories();
  const now = new Date().toISOString();
  const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const content = params.content || DEFAULT_INITIAL_CONTENT;

  const newMemory: SharedMemoryItem = {
    id,
    name: params.name || 'Nova Memória',
    description: params.description || '',
    content,
    projectId: params.projectId,
    associatedAgentId: params.associatedAgentId,
    createdAt: now,
    updatedAt: now,
    versions: [
      {
        id: `ver_1_${Date.now()}`,
        versionNumber: 1,
        content,
        timestamp: now,
        author: 'user',
        summary: 'Criação inicial da memória',
      },
    ],
  };

  memories.unshift(newMemory);
  saveAllMemories(memories);
  sysLog.info('SYSTEM', `Nova memória compartilhada criada: ${newMemory.name} (${newMemory.id})`);
  return newMemory;
}

export function updateMemoryContent(
  id: string,
  newContent: string,
  author: 'user' | 'agent' | 'memory-agent' = 'user',
  summary?: string
): SharedMemoryItem | null {
  const memories = loadAllMemories();
  const target = memories.find((m) => m.id === id);
  if (!target) return null;

  // Se não houve alteração real, não cria versão!
  if (target.content.trim() === newContent.trim()) {
    return target;
  }

  const now = new Date().toISOString();
  const currentVersions = target.versions || [];
  const nextVerNumber = currentVersions.length > 0
    ? Math.max(...currentVersions.map((v) => v.versionNumber || 0)) + 1
    : 1;

  const newVersion: SharedMemoryVersion = {
    id: `ver_${nextVerNumber}_${Date.now()}`,
    versionNumber: nextVerNumber,
    content: newContent,
    timestamp: now,
    author,
    summary: summary || (author === 'user' ? 'Edição manual do usuário' : author === 'memory-agent' ? 'Refatoração pelo Agente da Memória' : 'Atualização pelo Agente Operacional'),
  };

  target.content = newContent;
  target.updatedAt = now;
  target.versions = [...currentVersions, newVersion];

  saveAllMemories(memories);
  sysLog.info('SYSTEM', `Memória ${target.id} atualizada (v${nextVerNumber}) por ${author}`);
  return target;
}

export function restoreMemoryVersion(memoryId: string, versionId: string): SharedMemoryItem | null {
  const memories = loadAllMemories();
  const target = memories.find((m) => m.id === memoryId);
  if (!target) return null;

  const versionToRestore = target.versions?.find((v) => v.id === versionId);
  if (!versionToRestore) return null;

  // Restaurar cria uma NOVA versão usando o conteúdo restaurado, SEM apagar o histórico!
  return updateMemoryContent(
    memoryId,
    versionToRestore.content,
    'user',
    `Restauração da versão v${versionToRestore.versionNumber} (${versionToRestore.id})`
  );
}

export function deleteMemory(id: string): boolean {
  const memories = loadAllMemories();
  const filtered = memories.filter((m) => m.id !== id);
  if (filtered.length === memories.length) return false;

  saveAllMemories(filtered);
  sysLog.info('SYSTEM', `Memória removida: ${id}`);
  return true;
}

/**
 * Agente da Memória: isolado, sem ferramentas externas.
 * Apenas recebe o conteúdo atual e a instrução dada pelo usuário para refatorar o texto.
 */
export async function refactorMemoryWithAgent(params: {
  memoryId: string;
  instruction: string;
  customContent?: string;
}): Promise<{ success: boolean; memory?: SharedMemoryItem; error?: string }> {
  const { memoryId, instruction, customContent } = params;
  const memory = getMemoryById(memoryId);
  if (!memory) {
    return { success: false, error: 'Memória não encontrada' };
  }

  const agentConfig = loadMemoryAgentConfig();
  const contentToRefactor = customContent ?? memory.content;

  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return { success: false, error: 'Chave de API do Gemini não configurada para o Agente da Memória.' };
    }

    const ai = new GoogleGenAI({ apiKey });
    const systemPrompt = `${agentConfig.instructions}

REGRAS RÍGIDAS DE ISOLAMENTO:
1. Você NÃO tem acesso a ferramentas de sistema, comandos de terminal ou arquivos externos.
2. Seu único objetivo é refatorar, organizar, limpar, sumarizar ou atualizar a memória compartilhada enviada abaixo.
3. Preserve a integridade das etapas de pipeline (○, →, ✓, ✕) e dos registros de tentativas e falhas.
4. NUNCA invente ferramentas nem simule comandos. Responda SOMENTE com o texto estruturado da memória resultante, sem introdução ou cumprimentos.`;

    const userPrompt = `INSTRUÇÃO DE REFATORAÇÃO:
${instruction}

CONTEÚDO ATUAL DA MEMÓRIA:
${contentToRefactor}

Retorne exclusivamente o conteúdo final atualizado da memória:`;

    const modelToUse = agentConfig.model || 'gemini-3.5-flash-lite';
    const response = await ai.models.generateContent({
      model: modelToUse,
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        temperature: agentConfig.temperature ?? 0.3,
      },
    });

    const resultText = response.text?.trim();
    if (!resultText) {
      return { success: false, error: 'Resposta vazia retornada pelo modelo.' };
    }

    // Salvar como nova versão com autor 'memory-agent'
    const updated = updateMemoryContent(
      memoryId,
      resultText,
      'memory-agent',
      `Agente da Memória: "${instruction.slice(0, 40)}..."`
    );

    return { success: true, memory: updated || undefined };
  } catch (err: any) {
    sysLog.error('AGENT', `Erro na execução do Agente da Memória: ${err?.message}`);
    return { success: false, error: err?.message || 'Falha ao processar com o Agente da Memória.' };
  }
}

/**
 * Atualiza o status de uma etapa do fluxo de trabalho na memória (○, →, ✓, ✕).
 * Pode ser chamado tanto pelo Agente Operacional quanto pelo Usuário.
 */
export function updateWorkflowStepState(
  memoryId: string,
  stepPattern: string | number,
  newState: '○' | '→' | '✓' | '✕',
  reason?: string
): SharedMemoryItem | null {
  const memory = getMemoryById(memoryId);
  if (!memory) return null;

  const lines = memory.content.split('\n');
  let modified = false;

  const updatedLines = lines.map((line) => {
    // Procura por formato como "○ 1. Fazer X" ou "✓ 2. Fazer Y"
    const match = line.match(/^([○→✓✕])\s+(\d+)\.\s+(.*)$/);
    if (match) {
      const stepNum = parseInt(match[2], 10);
      const stepText = match[3];

      let isTarget = false;
      if (typeof stepPattern === 'number') {
        isTarget = stepNum === stepPattern;
      } else {
        isTarget = line.toLowerCase().includes(stepPattern.toLowerCase()) || stepNum.toString() === stepPattern;
      }

      if (isTarget) {
        modified = true;
        let newLine = `${newState} ${stepNum}. ${stepText}`;
        if (newState === '✕' && reason) {
          newLine += ` (FALHOU: ${reason})`;
        }
        return newLine;
      }
    }
    return line;
  });

  if (!modified) {
    return memory;
  }

  return updateMemoryContent(
    memoryId,
    updatedLines.join('\n'),
    'agent',
    `Etapa ${stepPattern} atualizada para ${newState}`
  );
}

/**
 * Registra uma tentativa e resultado no diagnóstico da memória compartilhada.
 * Utilizado pelo Agente Operacional para documentar abordagens e evitar repetição.
 */
export function recordOperationalAttempt(
  memoryId: string,
  params: {
    target: string;
    attemptDescription: string;
    result: 'SUCESSO' | 'FALHOU' | 'PARCIAL';
    reasonOrConfirmation?: string;
    affectedFiles?: string[];
  }
): SharedMemoryItem | null {
  const memory = getMemoryById(memoryId);
  if (!memory) return null;

  const { target, attemptDescription, result, reasonOrConfirmation, affectedFiles } = params;
  const isFailure = result === 'FALHOU';

  const entry = `
[${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}] ${target}
Tentativa: ${attemptDescription}
Resultado: ${result}
${reasonOrConfirmation ? `Detalhe: ${reasonOrConfirmation}` : ''}
${affectedFiles && affectedFiles.length > 0 ? `Arquivos: ${affectedFiles.join(', ')}` : ''}
${isFailure ? 'ATENÇÃO: Abordagem comprovadamente falha. Não repetir em futuras execuções.' : ''}
`;

  let newContent = memory.content;
  if (newContent.includes('# REGISTRO DE TENTATIVAS & DIAGNÓSTICO')) {
    newContent = newContent.replace(
      '# REGISTRO DE TENTATIVAS & DIAGNÓSTICO',
      `# REGISTRO DE TENTATIVAS & DIAGNÓSTICO\n${entry}`
    );
  } else {
    newContent += `\n\n# REGISTRO DE TENTATIVAS & DIAGNÓSTICO\n${entry}`;
  }

  return updateMemoryContent(
    memoryId,
    newContent,
    'agent',
    `Tentativa registrada (${result}) em ${target}`
  );
}
