import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { AgentConfig } from '../src/types.js';
import { sysLog } from './logger-service.js';
import { getGuiDataDir } from './paths-service.js';
import { buildEffectiveSystemPrompt } from '../src/utils/systemPromptUtils.js';
import { logSubagentEvent } from './subagent-logger.js';

export { buildEffectiveSystemPrompt };

export function sanitizeModelName(model?: string): string {
  if (!model || typeof model !== 'string' || !model.trim()) return 'gemini-3.5-flash-lite';
  return model.trim();
}

export const DEFAULT_AGENTS: AgentConfig[] = [
  {
    id: 'principal',
    name: 'principal',
    displayName: 'Principal / Orchestrator',
    role: 'Principal/Orchestrator: coordenação, roteamento e consolidação.',
    model: 'gemini-3.1-flash-lite',
    fallbackModel: 'gemini-3.5-flash-lite',
    description: 'Coordenação geral, decomposição de tarefas complexas, roteamento e delegação estruturada para agentes especializados (investigator, architect, auditor, tester, worker) e consolidação dos resultados.',
    baseInstructions: `Você é o Principal Orchestrator do Gemini CLI.

Sua função primária:
- Coordenar o trabalho, interpretar a solicitação e decidir a estratégia de execução.
- Executar diretamente tarefas simples, objetivas e de baixo risco.
- Delegar tarefas complexas ou especializadas ao subagente mais adequado, podendo evocar múltiplos ou todos os agentes simultaneamente em paralelo quando a tarefa demandar visões conjuntas ou quando solicitado pelo usuário.
- Consolidar os resultados dos subagentes e apresentar uma resposta única e coerente.

Diretrizes operacionais:
- Antes de agir, identifique o objetivo real, o escopo e os recursos necessários.
- Execute somente o necessário e evite exploração, chamadas e consumo de tokens sem finalidade.
- Para tarefas complexas, delegue com objetivo, contexto, arquivos relevantes e critérios de aceite claros.
- Toda afirmação sobre o estado do projeto, comportamento do código, execução, teste, correção ou resultado deve ser baseada em evidência observável obtida durante a execução.
- É PROIBIDO apresentar inferência, expectativa, intenção, plano ou hipótese como fato consumado.
- É PROIBIDO declarar que algo foi executado, corrigido, testado, validado, compilado, homologado ou funcionando sem evidência correspondente.
- Se uma etapa não foi executada, declare explicitamente que não foi executada.
- Se o resultado não puder ser confirmado, informe que permanece não confirmado.
- Quando existir saída bruta de comando, ferramenta, subagente ou execução solicitada pelo usuário, priorize o retorno factual dessa saída. Não substitua o retorno solicitado por um resumo interpretativo.
- Ao solicitar ou apresentar retorno bruto, preserve seu conteúdo e estrutura originais na medida possível. Nunca invente trechos ausentes.
- Pode resumir somente quando o usuário pedir resumo ou interpretação.
- Não omita uma falha relevante para tornar o resultado mais favorável.
- Ao consolidar subagentes, diferencie claramente evidência recebida, conclusão derivada e pontos ainda não verificados.
- Preserve a arquitetura existente e evite alterações fora do escopo.
- Responda de forma direta, clara e estruturada em Markdown.`,
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
    fallbackModel: 'gemini-3.5-flash',
    description: 'Agente especializado em investigação profunda de código, busca e rastreamento de bugs, pesquisa em fontes e diagnóstico técnico empírico com evidências.',
    baseInstructions: `Você é o Investigator do Gemini CLI.

Sua função primária:
- Investigar código, arquivos, dependências, fluxos, documentação e comportamento do sistema.
- Identificar causas, relações e impactos com base em evidências concretas.
- Rastrear problemas até sua origem provável e fornecer material suficiente para decisão ou correção.

Diretrizes operacionais:
- Inspecione o contexto relevante antes de concluir.
- Rastreie referências, chamadas, dependências, persistência, estados e caminhos relacionados ao problema.
- Use código, arquivos, logs, testes, documentação e resultados de ferramentas como evidência.
- Toda conclusão factual deve apontar para a evidência que a sustenta.
- É PROIBIDO afirmar que encontrou, confirmou ou reproduziu um problema sem evidência observável.
- Diferencie obrigatoriamente FATO OBSERVADO, INFERÊNCIA e HIPÓTESE.
- Não declare causa raiz apenas porque uma explicação parece plausível.
- Não trate ausência de evidência como evidência de ausência.
- Se não puder reproduzir ou confirmar algo, registre isso explicitamente.
- Quando o usuário solicitar retorno bruto de comando, log, ferramenta ou execução, forneça o retorno factual disponível, sem transformá-lo em resumo. Redija interpretação separadamente apenas quando necessária.
- Nunca invente linhas de log, resultados de busca, arquivos, referências, testes ou evidências.
- Evite expandir a investigação para áreas irrelevantes ao objetivo.`,
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
    fallbackModel: 'gemini-3.7-flash',
    description: 'Agente especializado em design de sistemas, arquitetura de software, modularidade, desacoplamento, contratos de interfaces e integridade estrutural.',
    baseInstructions: `Você é o Architect do Gemini CLI.

Sua função primária:
- Tomar decisões arquiteturais e estruturais para o projeto.
- Garantir coerência de padrões, responsabilidades, modularidade e desacoplamento.
- Avaliar trade-offs de engenharia e prevenir complexidade e débito técnico desnecessários.

Diretrizes operacionais:
- Compreenda a arquitetura existente antes de propor alterações.
- Baseie decisões em código, contratos, dependências, fluxos e evidências realmente observadas.
- Diferencie claramente requisito, fato arquitetural, inferência, proposta e preferência.
- É PROIBIDO afirmar que uma arquitetura possui determinada propriedade sem verificá-la no código ou documentação disponível.
- É PROIBIDO declarar que uma alteração preserva compatibilidade sem verificar os pontos relevantes.
- Avalie impacto, acoplamento, manutenção, persistência, concorrência e integração quando forem pertinentes.
- Prefira soluções simples, coesas, extensíveis e compatíveis com o sistema atual.
- Não introduza abstrações ou refatorações sem benefício técnico identificável.
- Não declare uma solução implementada ou validada quando apenas foi proposta.
- Quando houver execução ou teste disponível, use seu resultado real como evidência.
- Se o usuário solicitar o retorno bruto de uma análise ou execução, não o substitua por uma conclusão resumida.`,
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
    fallbackModel: 'gemini-3.6-flash',
    description: 'Agente especializado em revisão crítica rigorosa de código, auditoria de segurança, detecção de regressões, conformidade e análise de vulnerabilidades.',
    baseInstructions: `Você é o Auditor do Gemini CLI.

Sua função primária:
- Realizar revisão crítica e sistemática do código e das alterações.
- Identificar bugs, regressões, falhas de integração, riscos de segurança, problemas de performance e inconsistências.
- Verificar se o comportamento implementado corresponde ao requisito e à arquitetura existente.

Diretrizes operacionais:
- Analise o trecho alterado e os fluxos e componentes diretamente afetados.
- Procure caminhos de erro, estados incompletos, condições de corrida, problemas de persistência, efeitos colaterais e incompatibilidades.
- Verifique integrações, contratos, fallback, tratamento de exceções e comportamento de borda quando aplicável.
- Toda descoberta deve possuir evidência concreta e localizável.
- É PROIBIDO classificar como bug, correção ou vulnerabilidade algo que não tenha sido sustentado por evidência suficiente.
- É PROIBIDO declarar “sem problemas”, “seguro”, “corrigido”, “validado” ou equivalente sem cobertura e evidência compatíveis.
- Compile, execute ou teste quando a tarefa exigir confirmação. Inspeção estática não deve ser apresentada como teste.
- Diferencie problema confirmado, risco potencial e hipótese.
- Se um teste não foi executado, informe explicitamente.
- Se uma correção foi proposta mas não verificada, informe explicitamente.
- Nunca invente teste, resultado, ferramenta utilizada, log, comportamento observado ou correção aplicada.
- Quando solicitado, retorne os dados brutos de execução e evidências antes da interpretação.`,
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
    model: 'gemini-3.5-flash',
    fallbackModel: 'gemini-3-flash',
    description: 'Agente especializado em criação e execução de testes automatizados (unitários, integração e e2e), validação comportamental e análise de falhas.',
    baseInstructions: `Você é o Tester do Gemini CLI.

Sua função primária:
- Determinar o comportamento esperado e validar a implementação por testes reais.
- Criar, executar e analisar testes unitários, integração, end-to-end ou verificações equivalentes quando aplicável.
- Detectar regressões e identificar a origem de falhas observadas.

Diretrizes operacionais:
- Primeiro estabeleça o comportamento esperado e os critérios de aceite.
- Escolha os testes mais relevantes para o risco e o escopo da alteração.
- Execute os testes no ambiente disponível sempre que possível.
- Um teste apenas planejado ou descrito NÃO constitui validação.
- Inspeção de código, compilação e análise estática NÃO substituem teste comportamental quando este for necessário.
- É PROIBIDO declarar “passou”, “funciona”, “validado”, “homologado” ou equivalente sem resultado real correspondente.
- Registre exatamente o que foi executado, o resultado obtido e qualquer limitação da execução.
- Diferencie claramente teste executado com sucesso, teste executado com falha, teste não executado e comportamento apenas inspecionado.
- Analise a falha em vez de mascará-la.
- Não altere código apenas para fazer um teste passar sem compreender a causa.
- Nunca invente resultados de testes, saídas esperadas, cobertura ou evidências.
- Quando o usuário pedir a saída bruta da execução, forneça a saída real disponível, sem substituí-la por resumo ou paráfrase.`,
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
    model: 'gemini-3.5-flash-lite',
    fallbackModel: 'gemini-3.1-flash-lite',
    description: 'Agente especializado em tarefas de alto volume, geração de código boilerplate, refatorações diretas, transformações em lote e implementação de rotina.',
    baseInstructions: `Você é o Worker do Gemini CLI.

Sua função primária:
- Executar tarefas de implementação, transformação e manutenção com precisão e alta cadência.
- Aplicar decisões e especificações fornecidas pelos agentes de coordenação.
- Realizar refatorações diretas, alterações repetitivas e geração de código dentro do escopo definido.

Diretrizes operacionais:
- Inspecione o contexto relevante antes de editar.
- Faça a menor alteração necessária para cumprir o objetivo.
- Preserve contratos, comportamento existente e arquitetura fora do escopo.
- Não trate uma edição realizada como automaticamente correta.
- Após editar, faça a verificação técnica apropriada ao tipo de mudança.
- É PROIBIDO declarar que a alteração corrigiu o problema sem evidência de que a causa foi tratada e a alteração foi verificada.
- É PROIBIDO afirmar que compilou, testou, executou ou funcionou sem ter realizado a etapa correspondente.
- Se não puder executar uma verificação necessária, informe explicitamente a limitação.
- Evite refatorações oportunistas, mudanças cosméticas e alterações não solicitadas.
- Quando houver ambiguidade que possa alterar o resultado, investigue o contexto disponível antes de decidir.
- Nunca invente arquivos alterados, resultados, comandos executados, testes ou evidências.
- Quando solicitado retorno bruto de comando ou execução, entregue o retorno factual disponível antes de qualquer explicação.
- Priorize precisão, consistência e baixo custo operacional.`,
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
  if (targetDir && path.resolve(targetDir) !== path.resolve(getGuiDataDir())) return loadAgents(targetDir);
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
      saveAgentToFile(defaultAgent, targetDir, true);
    } else if (!metadata[defaultAgent.name]) {
      // Existing content is the source of truth; never replace it with defaults.
      const existing = parseAgentMarkdown(fs.readFileSync(agentFilePath, 'utf8'), defaultAgent.name, {});
      if (existing) { metadata[defaultAgent.name] = existing; saveMetadata(metadata, targetDir); }
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
        saveAgentToFile({ ...defaultAgent, name: aliasName }, targetDir, true);
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
  if (targetDir && path.resolve(targetDir) !== path.resolve(getGuiDataDir())) return { migratedCount: 0, agents: [] };
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
      
      if (rawFields['fallback_model'] || rawFields['fallbackModel']) {
        agentMeta.fallbackModel = rawFields['fallback_model'] || rawFields['fallbackModel'];
      }
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

      const currentModel = sanitizeModelName(rawFields['model'] || agentMeta.model || 'gemini-3.5-flash-lite');
      agentMeta.model = currentModel;
      metadata[agentName] = agentMeta;

      // Se houver qualquer campo não reconhecido ou formatação antiga, reescrever no schema oficial
      if (hasUnrecognizedKeys || (rawFields['model'] && rawFields['model'] !== currentModel)) {
        const name = rawFields['name'] || agentName;
        const model = currentModel;
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
  if (targetDir && path.resolve(targetDir) !== path.resolve(getGuiDataDir())) {
    const merged = new Map(loadAgents().map(agent => [agent.name, agent]));
    const directory = getAgentsDirectory(targetDir), metadata = loadMetadata(targetDir);
    if (fs.existsSync(directory)) for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.md'))) {
      const name = file.slice(0, -3);
      const agent = parseAgentMarkdown(fs.readFileSync(path.join(directory, file), 'utf8'), name, metadata[name] || {});
      if (agent) merged.set(agent.name, agent);
    }
    return [...merged.values()];
  }
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
  let needsSettingsSync = false;
  for (const defaultAgent of DEFAULT_AGENTS) {
    const existing = loadedMap.get(defaultAgent.name);
    if (!existing) {
      saveAgentToFile(defaultAgent, targetDir, true);
      loadedMap.set(defaultAgent.name, defaultAgent);
      needsSettingsSync = true;
    } else if (!existing.baseInstructions && defaultAgent.baseInstructions) {
      // Restore base instructions if they were lost during migration
      existing.baseInstructions = defaultAgent.baseInstructions;
      saveAgentToFile(existing, targetDir, true);
      needsSettingsSync = true;
    }
  }

  if (needsSettingsSync) {
    syncAgentsToSettings(targetDir);
  }

  return Array.from(loadedMap.values());
}

export function saveAgentToFile(agent: AgentConfig, targetDir?: string, skipSettingsSync = false) {
  const agentsDir = getAgentsDirectory(targetDir);
  if (!fs.existsSync(agentsDir)) {
    fs.mkdirSync(agentsDir, { recursive: true });
  }

  // Ensure normalized identifier
  const normalizedName = (agent.name || agent.id || '').trim();
  if (!normalizedName) return;
  agent.name = normalizedName;
  agent.id = normalizedName;

  const effectivePrompt = buildEffectiveSystemPrompt(
    agent.baseInstructions,
    agent.systemInstructions,
    agent.overrideBasePrompt
  );

  const modelToSave = sanitizeModelName(agent.model || 'gemini-3.5-flash-lite');
  agent.model = modelToSave;

  // Schema nativo do Gemini CLI: name, model, description, kind, tools, temperature, max_turns
  const fmLines = [
    '---',
    `name: ${agent.name}`,
    `model: ${modelToSave}`,
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
    model: modelToSave,
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
    fallbackModel: agent.fallbackModel ? sanitizeModelName(agent.fallbackModel) : undefined,
    backupAgentId: agent.backupAgentId,
    enabled: agent.enabled !== false,
  };
  saveMetadata(metadata, targetDir);

  // Sincronizar arquivos de alias para subagentes (ex: codebase_investigator -> investigator)
  const defaultAliases: Record<string, string[]> = {
    investigator: ['codebase_investigator', 'code_investigator', 'investigator_agent'],
    principal: ['orquestrador', 'orchestrator', 'principal_orchestrator'],
    architect: ['software_architect', 'architect_agent'],
    auditor: ['security_auditor', 'auditor_agent'],
    tester: ['qa_tester', 'tester_agent'],
    worker: ['code_worker', 'worker_agent'],
  };

  const aliases = defaultAliases[agent.name.toLowerCase()] || [];
  for (const aliasName of aliases) {
    const aliasFmLines = [
      '---',
      `name: ${aliasName}`,
      `model: ${modelToSave}`,
      `description: "${(agent.description || '').replace(/"/g, '\\"')}"`,
      `kind: ${agent.kind || 'local'}`,
      `tools: ${JSON.stringify(agent.tools || ['*'])}`,
    ];
    if (typeof agent.temperature === 'number') aliasFmLines.push(`temperature: ${agent.temperature}`);
    if (typeof agent.maxTurns === 'number') aliasFmLines.push(`max_turns: ${agent.maxTurns}`);
    aliasFmLines.push('---');
    aliasFmLines.push('');
    aliasFmLines.push(effectivePrompt.trim());
    const aliasFilePath = path.join(agentsDir, `${aliasName}.md`);
    try {
      fs.writeFileSync(aliasFilePath, aliasFmLines.join('\n'), 'utf8');
    } catch {}
  }

  // Sincronizar configurações do modelo no settings.json do Gemini CLI
  if (!skipSettingsSync) {
    syncAgentsToSettings(targetDir, agent.name, agent);
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

  const resolvedModel = sanitizeModelName(fields['model'] || metadata.model || 'gemini-3.5-flash-lite');

  return {
    id: name,
    name,
    displayName: metadata.displayName || fields['display_name'] || name,
    role: `${metadata.displayName || fields['display_name'] || name}: ${fields['description'] || ''}`,
    model: resolvedModel,
    fallbackModel: metadata.fallbackModel || fields['fallback_model'] || fields['fallbackModel'] || undefined,
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
    const base = getGuiDataDir();
    const settingsPath = path.join(base, '.gemini', 'settings.json');
    let settings: any = {};
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      } catch (error) { throw new Error('settings.json inválido; sincronização interrompida.'); }
    }

    if (!settings.mcpServers) settings.mcpServers = {};
    if (!settings.modelConfigs) settings.modelConfigs = {};
    if (!settings.modelConfigs.customAliases) settings.modelConfigs.customAliases = {};
    if (!settings.modelConfigs.overrides) settings.modelConfigs.overrides = [];

    // Carregar todos os agentes para compor as configurações
    const allAgents = loadAgents();
    const metadata = loadMetadata();

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

    const previousAliases = new Set(settings.guiManagedAgentAliases || []);
    const previousScopes = new Set(settings.guiManagedAgentScopes || []);
    const personalAliases = Object.fromEntries(Object.entries(settings.modelConfigs.customAliases).filter(([name]) => !previousAliases.has(name)));
    settings.modelConfigs.customAliases = { ...newAliases, ...personalAliases };
    settings.modelConfigs.overrides = [
      ...settings.modelConfigs.overrides.filter((item: any) => !previousScopes.has(item.match?.overrideScope)),
      ...newOverrides.filter(item => !settings.modelConfigs.overrides.some((old: any) => !previousScopes.has(old.match?.overrideScope) && old.match?.overrideScope === item.match?.overrideScope)),
    ];
    settings.guiManagedAgentAliases = Object.keys(newAliases).filter(name => !(name in personalAliases));
    settings.guiManagedAgentScopes = newOverrides.map(item => item.match?.overrideScope).filter(scope => scope && !settings.modelConfigs.overrides.some((old: any) => !previousScopes.has(old.match?.overrideScope) && old.match?.overrideScope === scope && !newOverrides.includes(old)));

    // Preservar e registrar policyPaths se existirem políticas
    const policiesDir = path.join(base, '.gemini', 'policies');
    if (fs.existsSync(policiesDir)) {
      const pFiles = fs.readdirSync(policiesDir).filter(f => f.endsWith('.toml')).map(f => path.join(policiesDir, f));
      const polPaths = [policiesDir, ...pFiles];
      settings.policyPaths = Array.from(new Set([...(settings.policyPaths || []), ...polPaths]));
      settings.adminPolicyPaths = Array.from(new Set([...(settings.adminPolicyPaths || []), ...polPaths]));
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

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

/**
 * Robustly synchronizes all agents across:
 * 1. Global User directory (~/.gemini/agents) - Gemini CLI user-level agent discovery
 * 2. GUI Data directory (~/.local/share/gemini-gui/.gemini/agents) - GUI persistence
 * Project agent files are read without synchronization writes.
 * 
 * Also updates ~/.gemini/acknowledgments/agents.json with the SHA-256 hash of each .md file
 * so that Gemini CLI never blocks or ignores agents due to missing trust acknowledgments.
 */
export function ensureAllAgentsSynchronizedAndAcknowledged(cwd?: string, nativeHome = os.homedir()): {
  synchronizedCount: number;
  acknowledgedCount: number;
  directories: string[];
} {
  const targetDirs = new Set<string>();

  // 1. User home .gemini/agents - canonical global discovery for Gemini CLI
  targetDirs.add(path.join(nativeHome, '.gemini', 'agents'));

  // 2. GUI data dir - persistent storage for Gemini GUI
  targetDirs.add(path.join(getGuiDataDir(), '.gemini', 'agents'));

  // Note: We avoid duplicating the same agents into <cwd>/.gemini/agents because Gemini CLI
  // scans both ~/.gemini/agents and <cwd>/.gemini/agents, causing 'Duplicate agent name detected' warnings.
  // Load all agents from repository defaults and any existing configs
  const agents = loadAgents();
  const ackFile = path.join(nativeHome, '.gemini', 'acknowledgments', 'agents.json');
  let ackMap: Record<string, string> = {};
  if (fs.existsSync(ackFile)) {
    try {
      ackMap = JSON.parse(fs.readFileSync(ackFile, 'utf8'));
    } catch { throw new Error('Acknowledgments de agentes inválidos; arquivo pessoal preservado.'); }
  }

  let totalFiles = 0;
  let ackUpdated = 0;

  for (const dir of targetDirs) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const ownershipPath = path.join(dir, '.gui-owned-agents.json');
      const ownership: Record<string, string> = fs.existsSync(ownershipPath) ? JSON.parse(fs.readFileSync(ownershipPath, 'utf8')) : {};
      for (const agent of agents) {
        const effectivePrompt = buildEffectiveSystemPrompt(
          agent.baseInstructions,
          agent.systemInstructions,
          agent.overrideBasePrompt
        );

        const fmLines = [
          '---',
          `name: ${agent.name}`,
          `model: ${agent.model || 'gemini-3.5-flash-lite'}`,
          `description: "${(agent.description || '').replace(/"/g, '\\"')}"`,
          `kind: ${agent.kind || 'local'}`,
          `tools: ${JSON.stringify(agent.tools || ['*'])}`,
        ];
        if (typeof agent.temperature === 'number') fmLines.push(`temperature: ${agent.temperature}`);
        if (typeof agent.maxTurns === 'number') fmLines.push(`max_turns: ${agent.maxTurns}`);
        fmLines.push('---', '', effectivePrompt.trim());
        const content = fmLines.join('\n');

        const filePath = path.join(dir, `${agent.name}.md`);
        if (fs.existsSync(filePath) && path.resolve(dir) !== path.resolve(path.join(getGuiDataDir(), '.gemini', 'agents'))) {
          const current = fs.readFileSync(filePath, 'utf8');
          const currentHash = crypto.createHash('sha256').update(current).digest('hex');
          if (current !== content && ownership[`${agent.name}.md`] !== currentHash) {
            sysLog.warn('AGENT', `Agente existente preservado por conflito: ${filePath}`);
            continue;
          }
        }
        if (!fs.existsSync(filePath) || fs.readFileSync(filePath, 'utf8') !== content) fs.writeFileSync(filePath, content, 'utf8');
        ownership[`${agent.name}.md`] = crypto.createHash('sha256').update(content).digest('hex');
        totalFiles++;

        // Acknowledge in agents.json: Gemini CLI requires acknowledgedAgents[projectPath][agentName] = hash
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        
        // 1. Path-based acknowledgement
        ackMap[path.resolve(filePath)] = hash;
        
        // 2. Project-scoped acknowledgement (projectPath -> agentName -> hash)
        const projectRoot = path.dirname(path.dirname(filePath));
        const resolvedProjectRoot = path.resolve(projectRoot);
        if (!ackMap[resolvedProjectRoot] || typeof ackMap[resolvedProjectRoot] !== 'object') {
          (ackMap as any)[resolvedProjectRoot] = {};
        }
        (ackMap as any)[resolvedProjectRoot][agent.name] = hash;

        // Also add projectRoot unnormalized if different
        if (projectRoot !== resolvedProjectRoot) {
          if (!ackMap[projectRoot] || typeof ackMap[projectRoot] !== 'object') {
            (ackMap as any)[projectRoot] = {};
          }
          (ackMap as any)[projectRoot][agent.name] = hash;
        }

        // Never acknowledge a GUI hash for a different personal/project agent.
        for (const root of new Set([nativeHome, cwd || process.cwd()])) {
          const candidates = [path.join(root, '.gemini', 'agents', `${agent.name}.md`), path.join(nativeHome, '.gemini', 'agents', `${agent.name}.md`)];
          if (candidates.some(file => fs.existsSync(file) && crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== hash)) continue;
          if (!ackMap[root]) (ackMap as any)[root] = {};
          if (typeof ackMap[root] === 'object') (ackMap as any)[root][agent.name] = hash;
        }

        ackUpdated++;
      }

      // Remove only files previously written by this GUI and still unchanged.
      const canonical = new Set(agents.map(a => `${a.name}.md`));
      for (const [name, hash] of Object.entries(ownership)) {
        if (canonical.has(name)) continue;
        const file = path.join(dir, path.basename(name));
        if (fs.existsSync(file) && crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === hash) fs.unlinkSync(file);
        delete ownership[name];
      }
      fs.writeFileSync(ownershipPath, JSON.stringify(ownership, null, 2));
    } catch (dirErr) {
      console.warn(`[AgentsService] Aviso ao sincronizar diretório ${dir}:`, dirErr);
    }
  }

  // Save updated acknowledgments to all relevant locations
  const ackLocations = [ackFile, path.join(getGuiDataDir(), '.gemini', 'acknowledgments', 'agents.json')];

  for (const targetAckFile of ackLocations) {
    try {
      const ackDir = path.dirname(targetAckFile);
      if (!fs.existsSync(ackDir)) {
        fs.mkdirSync(ackDir, { recursive: true });
      }
      fs.writeFileSync(targetAckFile, JSON.stringify(ackMap, null, 2), 'utf8');
    } catch (ackErr) {
      console.warn(`[AgentsService] Erro ao salvar acknowledgments em ${targetAckFile}:`, ackErr);
    }
  }

  // Synchronize settings.json in ~/.gemini, cwd, and gui data dir
  try {
    syncAgentsToSettings();

  } catch {}

  logSubagentEvent({
    timestamp: new Date().toISOString(),
    executionId: 'system_sync',
    eventType: 'AGENT_DISCOVERY',
    agentName: 'system',
    details: {
      totalAgents: agents.length,
      directories: Array.from(targetDirs),
      acknowledgedEntries: Object.keys(ackMap).length,
    },
  });

  return {
    synchronizedCount: agents.length,
    acknowledgedCount: Object.keys(ackMap).length,
    directories: Array.from(targetDirs),
  };
}
