import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AgentConfig } from '../src/types.js';
import { sysLog } from './logger-service.js';
import { getGuiDataDir } from './paths-service.js';
import { buildEffectiveSystemPrompt } from '../src/utils/systemPromptUtils.js';

export { buildEffectiveSystemPrompt };

const DEFAULT_AGENTS: AgentConfig[] = [
  {
    id: 'principal',
    name: 'principal',
    displayName: 'Principal / Orchestrator',
    role: 'Principal/Orchestrator: coordenação, roteamento e consolidação.',
    model: 'gemini-3.5-flash-lite',
    backupAgentId: 'worker',
    description: 'Coordenação geral, decomposição de tarefas complexas, roteamento e delegação estruturada para agentes especializados (investigator, architect, auditor, tester, worker) e consolidação dos resultados.',
    baseInstructions: `Você é o Principal Orchestrator do Gemini CLI.
Sua função primária:
- Coordenação de fluxos de trabalho e decomposição de tarefas complexas.
- Delegação estruturada e roteamento ativo para os subagentes especializados disponíveis:
  * investigator: Use para investigação profunda de código, busca de bugs, rastreamento de causas raízes e diagnóstico técnico com evidências.
  * architect: Use para decisões de design de software, modularidade, contratos de API e integridade estrutural.
  * auditor: Use para auditoria de segurança, revisão rigorosa de código, detecção de regressões e conformidade de qualidade.
  * tester: Use para criação de testes automatizados, execução de suítes de validação e análise de falhas.
  * worker: Use para geração de boilerplate, transformações repetitivas em massa e refatorações diretas.
- Ao coordenar, formule subtarefas com contexto claro, arquivos envolvidos e critérios de sucesso.
- Consolide e revise os resultados produzidos antes de apresentar a solução final ao usuário.`,
    systemInstructions: '',
    overrideBasePrompt: false,
    enabled: true,
    kind: 'local',
    tools: ['*'],
    temperature: 0.2,
    maxTurns: 30,
    statusGrade: 'CONFIGURED',
  },
  {
    id: 'investigator',
    name: 'investigator',
    displayName: 'Investigator',
    role: 'Investigator: investigação, pesquisa e diagnóstico.',
    model: 'gemini-3.7-flash',
    backupAgentId: 'architect',
    description: 'Agente especializado em investigação profunda de código, busca e rastreamento de bugs, pesquisa em fontes e diagnóstico técnico empírico com evidências.',
    baseInstructions: `Você é o Investigator do Gemini CLI.
Sua função primária:
- Investigação, pesquisa de contexto e diagnóstico técnico minucioso.
- Rastreamento de dependências e causas raízes com evidências empíricas.
- Nunca emitir diagnóstico sem validação concreta e referências precisas aos arquivos analisados.`,
    systemInstructions: '',
    overrideBasePrompt: false,
    enabled: true,
    kind: 'local',
    tools: ['*'],
    temperature: 0.1,
    maxTurns: 25,
    statusGrade: 'CONFIGURED',
  },
  {
    id: 'architect',
    name: 'architect',
    displayName: 'Architect',
    role: 'Architect: decisões arquiteturais e estruturais.',
    model: 'gemini-3.6-flash',
    backupAgentId: 'investigator',
    description: 'Agente especializado em design de sistemas, arquitetura de software, modularidade, desacoplamento, contratos de interfaces e integridade estrutural.',
    baseInstructions: `Você é o Architect do Gemini CLI.
Sua função primária:
- Tomada de decisões arquiteturais e estruturais para o projeto.
- Garantir coerência de padrões, modularidade e desacoplamento.
- Avaliar trade-offs de engenharia e prevenir débito técnico.`,
    systemInstructions: '',
    overrideBasePrompt: false,
    enabled: true,
    kind: 'local',
    tools: ['*'],
    temperature: 0.2,
    maxTurns: 20,
    statusGrade: 'CONFIGURED',
  },
  {
    id: 'auditor',
    name: 'auditor',
    displayName: 'Auditor',
    role: 'Auditor: revisão crítica e identificação de problemas.',
    model: 'gemini-3.8-flash',
    backupAgentId: 'architect',
    description: 'Agente especializado em revisão crítica rigorosa de código, auditoria de segurança, detecção de regressões, conformidade e análise de vulnerabilidades.',
    baseInstructions: `Você é o Auditor do Gemini CLI.
Sua função primária:
- Revisão crítica de alterações e código proposto.
- Identificação de problemas de segurança, performance e regressão.
- Priorização por impacto com apresentação de evidências claras.`,
    systemInstructions: '',
    overrideBasePrompt: false,
    enabled: true,
    kind: 'local',
    tools: ['*'],
    temperature: 0.1,
    maxTurns: 20,
    statusGrade: 'CONFIGURED',
  },
  {
    id: 'tester',
    name: 'tester',
    displayName: 'Tester',
    role: 'Tester: testes e validação.',
    model: 'gemini-3-flash',
    backupAgentId: 'worker',
    description: 'Agente especializado em criação e execução de testes automatizados (unitários, integração e e2e), validação comportamental e análise de falhas.',
    baseInstructions: `Você é o Tester do Gemini CLI.
Sua função primária:
- Identificação do comportamento esperado e criação de testes automatizados robustos.
- Execução de testes no ambiente real e análise sistemática de falhas.
- Não declarar validação sem evidência concreta de execução bem-sucedida.`,
    systemInstructions: '',
    overrideBasePrompt: false,
    enabled: true,
    kind: 'local',
    tools: ['*'],
    temperature: 0.2,
    maxTurns: 25,
    statusGrade: 'CONFIGURED',
  },
  {
    id: 'worker',
    name: 'worker',
    displayName: 'Worker',
    role: 'Worker: tarefas repetitivas e de alto volume.',
    model: 'gemini-3.1-flash-lite',
    backupAgentId: 'principal',
    description: 'Agente especializado em tarefas de alto volume, geração de código boilerplate, refatorações diretas, transformações em lote e implementação de rotina.',
    baseInstructions: `Você é o Worker do Gemini CLI.
Sua função primária:
- Execução rápida e precisa de tarefas repetitivas e de alto volume.
- Aplicação de regras definidas pelos agentes de coordenação.
- Foco em produtividade, velocidade e consistência.`,
    systemInstructions: '',
    overrideBasePrompt: false,
    enabled: true,
    kind: 'local',
    tools: ['*'],
    temperature: 0.2,
    maxTurns: 30,
    statusGrade: 'CONFIGURED',
  },
];

export function getAgentsDirectory(customDir?: string): string {
  const base = customDir || getGuiDataDir();
  return path.join(base, '.gemini', 'agents');
}

function getMetadataPath(targetDir?: string): string {
  return path.join(getAgentsDirectory(targetDir), '.metadata.json');
}

function loadMetadata(targetDir?: string): Record<string, any> {
  const metaPath = getMetadataPath(targetDir);
  if (fs.existsSync(metaPath)) {
    try {
      return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

function saveMetadata(metadata: Record<string, any>, targetDir?: string) {
  const metaPath = getMetadataPath(targetDir);
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf8');
}

export function ensureAgentsSeeded(targetDir?: string): AgentConfig[] {
  const agentsDir = getAgentsDirectory(targetDir);
  if (!fs.existsSync(agentsDir)) {
    fs.mkdirSync(agentsDir, { recursive: true });
  }

  // Run migration on any existing agent markdown files to ensure strict schema compliance
  migrateExistingAgents(targetDir);

  const metadata = loadMetadata(targetDir);

  // Ensure each default agent exists on disk
  for (const defaultAgent of DEFAULT_AGENTS) {
    const agentFilePath = path.join(agentsDir, `${defaultAgent.name}.md`);
    if (!fs.existsSync(agentFilePath)) {
      saveAgentToFile(defaultAgent, targetDir);
    } else if (!metadata[defaultAgent.name]) {
      // If file exists but metadata is missing, we need to save to populate metadata
      saveAgentToFile(defaultAgent, targetDir);
    }
  }

  // Ensure common aliases exist on disk so subagent invocations like codebase_investigator resolve
  const defaultAliases: Record<string, string[]> = {
    investigator: ['codebase_investigator', 'code_investigator', 'investigator_agent'],
    principal: ['orquestrador', 'orchestrator', 'principal_orchestrator'],
    architect: ['software_architect', 'architect_agent'],
    auditor: ['security_auditor', 'auditor_agent'],
    tester: ['qa_tester', 'tester_agent'],
    worker: ['code_worker', 'worker_agent'],
  };

  for (const defaultAgent of DEFAULT_AGENTS) {
    const aliases = defaultAliases[defaultAgent.name] || [];
    for (const aliasName of aliases) {
      const aliasFilePath = path.join(agentsDir, `${aliasName}.md`);
      if (!fs.existsSync(aliasFilePath)) {
        saveAgentToFile({ ...defaultAgent, name: aliasName }, targetDir);
      }
    }
  }
  
  syncAgentsToSettings(targetDir);

  return loadAgents(targetDir);
}

/**
 * Realiza a migração automática de todos os arquivos de agentes .gemini/agents/*.md:
 * - Remove campos proprietários do frontmatter (como backup_agent, top_p, top_k, thinking, etc.)
 *   que violam o schema estrito do Gemini CLI.
 * - Preserva temperature e max_turns (suportados oficialmente pelo schema nativo).
 * - Preserva todos os metadados estendidos em .metadata.json e sincroniza com modelConfigs do settings.json.
 */
export function migrateExistingAgents(targetDir?: string): { migratedCount: number; agents: string[] } {
  const agentsDir = getAgentsDirectory(targetDir);
  if (!fs.existsSync(agentsDir)) {
    return { migratedCount: 0, agents: [] };
  }

  const metadata = loadMetadata(targetDir);
  const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
  let migratedCount = 0;
  const migratedAgents: string[] = [];

  for (const file of files) {
    const filePath = path.join(agentsDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const agentName = file.replace(/\.md$/, '');
      const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
      
      if (!match) continue;

      const fm = match[1];
      const body = match[2].trim();
      const rawFields: Record<string, string> = {};

      for (const line of fm.split('\n')) {
        const sep = line.indexOf(':');
        if (sep > 0) {
          const key = line.slice(0, sep).trim();
          let val = line.slice(sep + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          rawFields[key] = val;
        }
      }

      // Schema nativo do Gemini CLI só aceita estritamente: name, model, description, kind, tools, temperature, max_turns
      const officialKeys = new Set(['name', 'model', 'description', 'kind', 'tools', 'temperature', 'max_turns']);
      const hasUnrecognizedKeys = Object.keys(rawFields).some(k => !officialKeys.has(k));

      // Extrair e preservar metadados da GUI
      const agentMeta = metadata[agentName] || {};
      
      if (rawFields['backup_agent'] || rawFields['backup_agent_id']) {
        agentMeta.backupAgentId = rawFields['backup_agent'] || rawFields['backup_agent_id'];
      }
      if (rawFields['top_p'] !== undefined && agentMeta.topP === undefined) {
        agentMeta.topP = parseFloat(rawFields['top_p']);
      }
      if (rawFields['top_k'] !== undefined && agentMeta.topK === undefined) {
        agentMeta.topK = parseInt(rawFields['top_k'], 10);
      }
      if (rawFields['max_output_tokens'] !== undefined && agentMeta.maxOutputTokens === undefined) {
        agentMeta.maxOutputTokens = parseInt(rawFields['max_output_tokens'], 10);
      }
      if (rawFields['thinking'] !== undefined && agentMeta.thinking === undefined) {
        agentMeta.thinking = rawFields['thinking'] === 'true';
      }
      if (rawFields['conceptual_profile'] && !agentMeta.conceptualProfile) {
        agentMeta.conceptualProfile = rawFields['conceptual_profile'];
      }
      if (rawFields['display_name'] && !agentMeta.displayName) {
        agentMeta.displayName = rawFields['display_name'];
      }
      if (rawFields['role'] && !agentMeta.role) {
        agentMeta.role = rawFields['role'];
      }

      metadata[agentName] = agentMeta;

      // Se houver qualquer campo não reconhecido ou formatação antiga, reescrever no schema oficial
      if (hasUnrecognizedKeys) {
        const name = rawFields['name'] || agentName;
        const model = rawFields['model'] || agentMeta.model || 'gemini-3.5-flash-lite';
        const description = rawFields['description'] !== undefined ? rawFields['description'] : (agentMeta.description || '');
        const kind = rawFields['kind'] || agentMeta.kind || 'local';
        let toolsStr = '["*"]';
        if (rawFields['tools']) {
          toolsStr = rawFields['tools'];
        } else if (agentMeta.tools) {
          toolsStr = JSON.stringify(agentMeta.tools);
        }

        const cleanFmLines = [
          '---',
          `name: ${name}`,
          `model: ${model}`,
          `description: "${description.replace(/"/g, '\\"')}"`,
          `kind: ${kind}`,
          `tools: ${toolsStr}`,
        ];

        if (rawFields['temperature'] !== undefined) {
          cleanFmLines.push(`temperature: ${rawFields['temperature']}`);
        } else if (agentMeta.temperature !== undefined) {
          cleanFmLines.push(`temperature: ${agentMeta.temperature}`);
        }

        if (rawFields['max_turns'] !== undefined) {
          cleanFmLines.push(`max_turns: ${rawFields['max_turns']}`);
        } else if (agentMeta.maxTurns !== undefined) {
          cleanFmLines.push(`max_turns: ${agentMeta.maxTurns}`);
        }

        cleanFmLines.push('---');
        cleanFmLines.push('');
        cleanFmLines.push(body);

        fs.writeFileSync(filePath, cleanFmLines.join('\n'), 'utf8');
        migratedCount++;
        migratedAgents.push(agentName);
      }
    } catch (err) {
      console.error(`Erro ao migrar agente ${file}:`, err);
    }
  }

  saveMetadata(metadata, targetDir);
  return { migratedCount, agents: migratedAgents };
}

export const ALIAS_TO_PRIMARY: Record<string, string> = {
  codebase_investigator: 'investigator',
  code_investigator: 'investigator',
  investigator_agent: 'investigator',
  orquestrador: 'principal',
  orchestrator: 'principal',
  principal_orchestrator: 'principal',
  software_architect: 'architect',
  architect_agent: 'architect',
  security_auditor: 'auditor',
  auditor_agent: 'auditor',
  qa_tester: 'tester',
  tester_agent: 'tester',
  code_worker: 'worker',
  worker_agent: 'worker',
};

export function loadAgents(targetDir?: string): AgentConfig[] {
  const agentsDir = getAgentsDirectory(targetDir);
  if (!fs.existsSync(agentsDir)) {
    fs.mkdirSync(agentsDir, { recursive: true });
  }

  // Auto-migração transparente de schemas legados
  migrateExistingAgents(targetDir);

  const metadata = loadMetadata(targetDir);
  const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
  const loadedMap = new Map<string, AgentConfig>();

  for (const file of files) {
    const agentName = file.replace(/\.md$/, '');
    // Ignore alias files when loading the UI agent list so duplicate cards are not displayed
    if (ALIAS_TO_PRIMARY[agentName]) {
      continue;
    }

    const filePath = path.join(agentsDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const agentMeta = metadata[agentName] || {};
      const parsed = parseAgentMarkdown(content, agentName, agentMeta);
      if (parsed) {
        // Respect the selected model without artificial restrictions
        if (!parsed.model) {
          parsed.model = 'gemini-3.5-flash-lite';
        }
        loadedMap.set(parsed.name, parsed);
      }
    } catch {
      // Continue loading others
    }
  }

  // Make sure all default agents are present and have their base instructions
  for (const defaultAgent of DEFAULT_AGENTS) {
    const existing = loadedMap.get(defaultAgent.name);
    if (!existing) {
      saveAgentToFile(defaultAgent, targetDir);
      loadedMap.set(defaultAgent.name, defaultAgent);
    } else if (!existing.baseInstructions && defaultAgent.baseInstructions) {
      // Restore base instructions if they were lost during migration
      existing.baseInstructions = defaultAgent.baseInstructions;
      saveAgentToFile(existing, targetDir);
    }
  }

  return Array.from(loadedMap.values());
}

export function saveAgentToFile(agent: AgentConfig, targetDir?: string) {
  const agentsDir = getAgentsDirectory(targetDir);
  if (!fs.existsSync(agentsDir)) {
    fs.mkdirSync(agentsDir, { recursive: true });
  }

  const effectivePrompt = buildEffectiveSystemPrompt(
    agent.baseInstructions,
    agent.systemInstructions,
    agent.overrideBasePrompt
  );

  // Schema nativo do Gemini CLI: name, model, description, kind, tools, temperature, max_turns
  const fmLines = [
    '---',
    `name: ${agent.name}`,
    `model: ${agent.model || 'gemini-3.5-flash-lite'}`,
    `description: "${(agent.description || '').replace(/"/g, '\\"')}"`,
    `kind: ${agent.kind || 'local'}`,
    `tools: ${JSON.stringify(agent.tools || ['*'])}`,
  ];

  if (typeof agent.temperature === 'number') {
    fmLines.push(`temperature: ${agent.temperature}`);
  }
  if (typeof agent.maxTurns === 'number') {
    fmLines.push(`max_turns: ${agent.maxTurns}`);
  }

  fmLines.push('---');
  fmLines.push('');
  fmLines.push(effectivePrompt.trim());

  const filePath = path.join(agentsDir, `${agent.name}.md`);
  fs.writeFileSync(filePath, fmLines.join('\n'), 'utf8');

  // Salvar metadados estendidos da GUI em .metadata.json (para não poluir o schema nativo do CLI)
  const metadata = loadMetadata(targetDir);
  metadata[agent.name] = {
    displayName: agent.displayName,
    role: agent.role,
    baseInstructions: agent.baseInstructions,
    systemInstructions: agent.systemInstructions,
    overrideBasePrompt: agent.overrideBasePrompt,
    temperature: agent.temperature,
    topP: agent.topP,
    topK: agent.topK,
    maxOutputTokens: agent.maxOutputTokens,
    thinking: agent.thinking,
    conceptualProfile: agent.conceptualProfile,
    maxTurns: agent.maxTurns,
    kind: agent.kind,
    tools: agent.tools,
    backupAgentId: agent.backupAgentId,
    enabled: agent.enabled !== false,
  };
  saveMetadata(metadata, targetDir);

  // Sincronizar configurações do modelo no settings.json do Gemini CLI
  syncAgentsToSettings(targetDir, agent.name, agent);

  // Se o agente salvo for um dos 6 agentes primários, sincronizar seus arquivos de alias no disco para o CLI
  const defaultAliases: Record<string, string[]> = {
    investigator: ['codebase_investigator', 'code_investigator', 'investigator_agent'],
    principal: ['orquestrador', 'orchestrator', 'principal_orchestrator'],
    architect: ['software_architect', 'architect_agent'],
    auditor: ['security_auditor', 'auditor_agent'],
    tester: ['qa_tester', 'tester_agent'],
    worker: ['code_worker', 'worker_agent'],
  };

  const aliases = defaultAliases[agent.name];
  if (aliases && aliases.length > 0) {
    for (const aliasName of aliases) {
      const aliasFilePath = path.join(agentsDir, `${aliasName}.md`);
      const aliasFmLines = [
        '---',
        `name: ${aliasName}`,
        `model: ${agent.model || 'gemini-3.5-flash-lite'}`,
        `description: "${(agent.description || '').replace(/"/g, '\\"')}"`,
        `kind: ${agent.kind || 'local'}`,
        `tools: ${JSON.stringify(agent.tools || ['*'])}`,
      ];
      if (typeof agent.temperature === 'number') aliasFmLines.push(`temperature: ${agent.temperature}`);
      if (typeof agent.maxTurns === 'number') aliasFmLines.push(`max_turns: ${agent.maxTurns}`);
      aliasFmLines.push('---', '', effectivePrompt.trim());
      fs.writeFileSync(aliasFilePath, aliasFmLines.join('\n'), 'utf8');
      syncAgentsToSettings(targetDir, aliasName, { ...agent, name: aliasName });
    }
  }
}

export function deleteAgent(name: string, targetDir?: string): boolean {
  const filePath = path.join(getAgentsDirectory(targetDir), `${name}.md`);
  let removed = false;
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    removed = true;
  }
  const metadata = loadMetadata(targetDir);
  if (metadata[name]) {
    delete metadata[name];
    saveMetadata(metadata, targetDir);
    removed = true;
  }
  if (removed) {
    syncAgentsToSettings(targetDir);
  }
  return removed;
}

function parseAgentMarkdown(content: string, fallbackName: string, metadata: any = {}): AgentConfig | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return null;
  }

  const fm = match[1];
  const body = match[2].trim();
  const fields: Record<string, string> = {};

  for (const line of fm.split('\n')) {
    const sep = line.indexOf(':');
    if (sep > 0) {
      const key = line.slice(0, sep).trim();
      let val = line.slice(sep + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      fields[key] = val;
    }
  }

  const name = fields['name'] || fallbackName;
  let tools = ['*'];
  if (fields['tools']) {
    try {
      tools = JSON.parse(fields['tools']);
    } catch {
      tools = ['*'];
    }
  }

  const hasBaseMeta = typeof metadata.baseInstructions === 'string';
  const hasSysMeta = typeof metadata.systemInstructions === 'string';

  const baseInstructions = hasBaseMeta
    ? metadata.baseInstructions
    : (metadata.overrideBasePrompt ? '' : body);

  let systemInstructions = hasSysMeta
    ? metadata.systemInstructions
    : (metadata.overrideBasePrompt ? body : '');

  // Deduplicação defensiva na origem: se o override for idêntico às instruções base, limpar override
  if (systemInstructions && baseInstructions && systemInstructions.trim() === baseInstructions.trim()) {
    systemInstructions = '';
  }

  return {
    id: name,
    name,
    displayName: metadata.displayName || fields['display_name'] || name,
    role: `${metadata.displayName || fields['display_name'] || name}: ${fields['description'] || ''}`,
    model: fields['model'] || 'gemini-3.5-flash-lite',
    backupAgentId: metadata.backupAgentId || fields['backup_agent'] || fields['backup_agent_id'] || undefined,
    description: fields['description'] || '',
    baseInstructions,
    systemInstructions,
    overrideBasePrompt: metadata.overrideBasePrompt === true,
    enabled: metadata.enabled !== false,
    kind: (metadata.kind as any) || 'local',
    tools,
    temperature: metadata.temperature ?? (fields['temperature'] ? parseFloat(fields['temperature']) : 0.2),
    topP: metadata.topP ?? (fields['top_p'] ? parseFloat(fields['top_p']) : 0.95),
    topK: metadata.topK ?? (fields['top_k'] ? parseInt(fields['top_k'], 10) : 40),
    maxOutputTokens: metadata.maxOutputTokens ?? (fields['max_output_tokens'] ? parseInt(fields['max_output_tokens'], 10) : undefined),
    thinking: metadata.thinking === true || fields['thinking'] === 'true',
    conceptualProfile: metadata.conceptualProfile || fields['conceptual_profile'] || '',
    maxTurns: metadata.maxTurns ?? (fields['max_turns'] ? parseInt(fields['max_turns'], 10) : 25),
    statusGrade: 'CONFIGURED',
  };
}

export function resetAllAgentsToDefault(targetDir?: string): AgentConfig[] {
  const agentsDir = getAgentsDirectory(targetDir);
  if (fs.existsSync(agentsDir)) {
    fs.rmSync(agentsDir, { recursive: true, force: true });
  }
  fs.mkdirSync(agentsDir, { recursive: true });
  for (const agent of DEFAULT_AGENTS) {
    saveAgentToFile(agent, targetDir);
  }
  syncAgentsToSettings(targetDir);
  return loadAgents(targetDir);
}

export function syncAgentsToSettings(
  targetDir?: string,
  activeAgentName?: string,
  activeConfig?: Partial<AgentConfig>
) {
  try {
    const base = targetDir || getGuiDataDir();
    const settingsPath = path.join(base, '.gemini', 'settings.json');
    let settings: any = {};
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      } catch {
        settings = {};
      }
    }

    if (!settings.mcpServers) settings.mcpServers = {};
    if (!settings.modelConfigs) settings.modelConfigs = {};
    if (!settings.modelConfigs.customAliases) settings.modelConfigs.customAliases = {};
    if (!settings.modelConfigs.overrides) settings.modelConfigs.overrides = [];

    // Carregar todos os agentes para compor as configurações
    const allAgents = loadAgents(targetDir);
    const metadata = loadMetadata(targetDir);

    // Mapear parâmetros por agente e por modelo
    const agentConfigsByName = new Map<string, any>();
    for (const ag of allAgents) {
      agentConfigsByName.set(ag.name, ag);
    }
    for (const [name, meta] of Object.entries(metadata)) {
      const existing = agentConfigsByName.get(name) || { name, model: 'gemini-3.5-flash-lite' };
      agentConfigsByName.set(name, { ...existing, ...meta });
    }

    if (activeAgentName && activeConfig) {
      const existing = agentConfigsByName.get(activeAgentName) || { name: activeAgentName, model: activeConfig.model || 'gemini-3.5-flash-lite' };
      agentConfigsByName.set(activeAgentName, { ...existing, ...activeConfig });
    }

    const primaryAgentName = activeAgentName || 'principal';
    const primaryAgent = agentConfigsByName.get(primaryAgentName) || agentConfigsByName.get('principal') || allAgents[0];

    // Reconstruir customAliases e overrides
    const newAliases: Record<string, any> = {};
    const newOverrides: any[] = [];

    const buildGenConfig = (cfg: any) => {
      const genConfig: any = {};
      if (typeof cfg.temperature === 'number') genConfig.temperature = cfg.temperature;
      if (typeof cfg.topP === 'number') genConfig.topP = cfg.topP;
      if (typeof cfg.topK === 'number') genConfig.topK = cfg.topK;
      if (typeof cfg.maxOutputTokens === 'number') genConfig.maxOutputTokens = cfg.maxOutputTokens;
      const isThinking = cfg.thinking !== false;
      if (isThinking) {
        const modelLower = (cfg.model || '').toLowerCase();
        const isThinkingSupported = 
          modelLower.includes('pro') || 
          modelLower.includes('thinking') || 
          modelLower.includes('gemini-3.7') || 
          modelLower.includes('gemini-3.8');

        if (isThinkingSupported) {
          const thinkingLevel = (cfg.thinkingLevel === 'low' || cfg.thinkingLevel === 'high' || cfg.thinkingLevel === 'medium')
            ? cfg.thinkingLevel
            : 'medium';
          const isGemini3 = modelLower.includes('gemini-3');
          if (isGemini3) {
            genConfig.thinkingConfig = {
              includeThoughts: true,
              thinkingLevel: thinkingLevel,
            };
          } else {
            genConfig.thinkingConfig = {
              includeThoughts: true,
              thinkingBudget: -1,
            };
          }
        }
      }
      return genConfig;
    };

    // 1. Configuração do agente ativo / principal para o escopo core e modelo padrão
    if (primaryAgent) {
      const primaryGenConfig = buildGenConfig(primaryAgent);
      const primaryModel = primaryAgent.model || 'gemini-3.5-flash-lite';

      newAliases[primaryAgent.name] = {
        modelConfig: {
          model: primaryModel,
          generateContentConfig: primaryGenConfig,
        },
      };
      newAliases[primaryModel] = {
        modelConfig: {
          model: primaryModel,
          generateContentConfig: primaryGenConfig,
        },
      };

      // Match core - always use the ultra-fast gemini-3.5-flash-lite with no thinking Config for instant routing/tool selection
      newOverrides.push({
        match: { overrideScope: 'core' },
        modelConfig: {
          model: 'gemini-3.5-flash-lite',
          generateContentConfig: {
            temperature: 0.2,
            topP: 0.95,
            topK: 40,
          },
        },
      });

      // Match model
      newOverrides.push({
        match: { model: primaryModel },
        modelConfig: {
          model: primaryModel,
          generateContentConfig: primaryGenConfig,
        },
      });

      // Match model + core - always route core scope to the fast gemini-3.5-flash-lite
      newOverrides.push({
        match: { model: primaryModel, overrideScope: 'core' },
        modelConfig: {
          model: 'gemini-3.5-flash-lite',
          generateContentConfig: {
            temperature: 0.2,
            topP: 0.95,
            topK: 40,
          },
        },
      });
    }

    // 2. Configuração de todos os demais agentes
    for (const [name, agentData] of agentConfigsByName.entries()) {
      const genConfig = buildGenConfig(agentData);
      const agentModel = agentData.model || 'gemini-3.5-flash-lite';

      newAliases[name] = {
        modelConfig: {
          model: agentModel,
          generateContentConfig: genConfig,
        },
      };

      if (!newAliases[agentModel]) {
        newAliases[agentModel] = {
          modelConfig: {
            model: agentModel,
            generateContentConfig: genConfig,
          },
        };
      }

      newOverrides.push({
        match: { overrideScope: name },
        modelConfig: {
          model: agentModel,
          generateContentConfig: genConfig,
        },
      });

      if (agentData.id && agentData.id !== name) {
        newOverrides.push({
          match: { overrideScope: agentData.id },
          modelConfig: {
            model: agentModel,
            generateContentConfig: genConfig,
          },
        });
      }
    }

    settings.modelConfigs.customAliases = newAliases;
    settings.modelConfigs.overrides = newOverrides;

    // Preservar e registrar policyPaths se existirem políticas
    const policiesDir = path.join(base, '.gemini', 'policies');
    if (fs.existsSync(policiesDir)) {
      const pFiles = fs.readdirSync(policiesDir).filter(f => f.endsWith('.toml')).map(f => path.join(policiesDir, f));
      const polPaths = [policiesDir, ...pFiles];
      settings.policyPaths = Array.from(new Set([...(settings.policyPaths || []), ...polPaths]));
      settings.adminPolicyPaths = Array.from(new Set([...(settings.adminPolicyPaths || []), ...polPaths]));
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

    // Sincronizar também no diretório de dados da GUI se base for um workspace específico
    if (path.resolve(base) !== path.resolve(getGuiDataDir())) {
      try {
        const guiGeminiDir = path.join(getGuiDataDir(), '.gemini');
        if (!fs.existsSync(guiGeminiDir)) {
          fs.mkdirSync(guiGeminiDir, { recursive: true });
        }
        const guiSettings = path.join(guiGeminiDir, 'settings.json');
        fs.writeFileSync(guiSettings, JSON.stringify(settings, null, 2), 'utf8');
      } catch {
        // Ignorar se houver restrição
      }
    }

    sysLog.info('AGENT', `Configurações de modelos e agentes sincronizadas com sucesso no settings.json.`);
  } catch (err) {
    sysLog.error('AGENT', `Erro ao sincronizar agents com settings.json: ${err}`);
  }
}

export function overwriteAgents(agents: AgentConfig[], targetDir?: string): AgentConfig[] {
  const agentsDir = getAgentsDirectory(targetDir);
  if (fs.existsSync(agentsDir)) {
    fs.rmSync(agentsDir, { recursive: true, force: true });
  }
  fs.mkdirSync(agentsDir, { recursive: true });
  for (const agent of agents) {
    saveAgentToFile(agent, targetDir);
  }
  syncAgentsToSettings(targetDir);
  return loadAgents(targetDir);
}

