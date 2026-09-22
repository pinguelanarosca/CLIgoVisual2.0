import { ChatMessage, AgentConfig, ProjectItem, AuthorizedDir, SkillConfig, McpConfig, FinalApiRequest, ParameterOrigins } from '../types.js';
import { estimateTokens } from './tokenUtils.js';
import { buildEffectiveSystemPrompt } from './systemPromptUtils.js';

export interface RawInspectionData {
  finalApiRequest: FinalApiRequest | null;
  isRealCapturedRequest: boolean;
  allRealRequests?: any[];
  parameterOrigins?: ParameterOrigins;
  input: {
    cliExecutable: string;
    model: string;
    agentName: string;
    approvalMode: string;
    workDir: string;
    authorizedDirs: string[];
    systemInstructions: string;
    projectContext: string;
    activeSkills: string[];
    activeMcps: string[];
    promptText: string;
    fullInjectedPrompt: string;
    timestamp: string;
  };
  output: {
    rawEvents: any[];
    rawTextStream: string;
    toolCalls: any[];
    tokenStats: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
    durationMs?: number;
    status: string;
    completedAt?: string;
  };
}

export function getRawInspectionData(
  msg: ChatMessage,
  agent?: AgentConfig | null,
  activeProject?: ProjectItem | null,
  authorizedDirs: AuthorizedDir[] = [],
  skills: SkillConfig[] = [],
  mcpServers: McpConfig[] = [],
  approvalMode: string = 'default'
): RawInspectionData {
  const isUser = msg.role === 'user';
  const workDir = activeProject?.associatedDirs[0] || authorizedDirs[0]?.path || '/workspace';
  const model = msg.model || agent?.model || 'gemini-3.5-flash-lite';
  const agentName = msg.agentName || agent?.displayName || 'Principal Orchestrator';
  const sysInst = msg.rawPayloadSent?.systemInstructions || (agent ? buildEffectiveSystemPrompt(agent.baseInstructions, agent.systemInstructions, agent.overrideBasePrompt) : '') || 'Você é um assistente de desenvolvimento Gemini CLI operando diretamente no ambiente Ubuntu Linux.';

  // If message already has captured raw payload sent
  const inputData = msg.rawPayloadSent || {
    cliExecutable: 'gemini',
    model,
    agentName,
    approvalMode,
    workDir,
    authorizedDirs: authorizedDirs.map((d) => d.path),
    systemInstructions: sysInst,
    projectContext: activeProject
      ? `Projeto: ${activeProject.name}\nDescrição: ${activeProject.description}\nDiretórios: ${activeProject.associatedDirs.join(', ')}`
      : `Diretório de trabalho: ${workDir}`,
    promptText: isUser ? msg.content : 'Requisitado via Gemini CLI stream',
    fullInjectedPrompt: `[SISTEMA - INSTRUÇÕES DO AGENTE]\n${sysInst}\n\n[CONTEXTO DE TRABALHO]\nWorkDir: ${workDir}\nModo Aprovação: ${approvalMode}\n\n[PROMPT ENVIADO]\n${msg.content}`,
    skills: skills.filter((s) => s.enabled).map((s) => s.name),
    mcpServers: mcpServers.filter((m) => m.enabled).map((m) => m.name),
    timestamp: msg.timestamp,
  };

  // Resolve final API request if attached or construct the precise payload effectively sent to Google API
  const resolvedModel = (model.startsWith('models/') ? model : `models/${model}`);
  const resolvedTemp = typeof agent?.temperature === 'number' ? agent.temperature : 0.2;
  const resolvedTopP = typeof agent?.topP === 'number' ? agent.topP : 0.95;
  const resolvedTopK = typeof agent?.topK === 'number' ? agent.topK : 40;
  const resolvedMaxTokens = typeof agent?.maxOutputTokens === 'number' ? agent.maxOutputTokens : undefined;
  const resolvedThinkingLevel: 'low' | 'medium' | 'high' =
    (agent?.thinkingLevel === 'low' || agent?.thinkingLevel === 'high' || agent?.thinkingLevel === 'medium')
      ? agent.thinkingLevel
      : 'medium';

  // Dynamically resolve authentic tool declarations (strictly reflection of active MCPs, agent tools and real tool calls)
  const resolvedFunctionDeclarations: Array<{ name: string; description: string; parameters?: any }> = [];

  // 1. Tool calls captured in this message execution
  if (msg.toolCalls && msg.toolCalls.length > 0) {
    msg.toolCalls.forEach((tc) => {
      const toolName = tc.toolName || (tc as any).name;
      if (toolName && !resolvedFunctionDeclarations.some((f) => f.name === toolName)) {
        resolvedFunctionDeclarations.push({
          name: toolName,
          description: `Ferramenta invocada em tempo de execução: ${toolName}`,
          parameters: tc.parameters || {},
        });
      }
    });
  }

  // 2. Active MCP Servers tools (e.g., Exa, GitHub, etc.)
  const activeMcps = mcpServers.filter((m) => m.enabled);
  activeMcps.forEach((mcp) => {
    if (mcp.name === 'exa') {
      if (!resolvedFunctionDeclarations.some((f) => f.name === 'web_search_exa')) {
        resolvedFunctionDeclarations.push({
          name: 'web_search_exa',
          description: 'Busca neural em tempo real na web através do MCP Exa AI (neural web search).',
          parameters: {
            type: 'OBJECT',
            properties: {
              query: { type: 'STRING', description: 'Termo de busca na web' },
              numResults: { type: 'INTEGER', description: 'Quantidade de resultados (padrão 5)' },
            },
            required: ['query'],
          },
        });
      }
      if (!resolvedFunctionDeclarations.some((f) => f.name === 'get_contents_exa')) {
        resolvedFunctionDeclarations.push({
          name: 'get_contents_exa',
          description: 'Extrai texto limpo e metadados estruturados de URLs via MCP Exa AI.',
          parameters: {
            type: 'OBJECT',
            properties: {
              urls: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Lista de URLs para extração' },
            },
            required: ['urls'],
          },
        });
      }
    } else if (mcp.name === 'github') {
      if (!resolvedFunctionDeclarations.some((f) => f.name === 'github_search_repos')) {
        resolvedFunctionDeclarations.push({
          name: 'github_search_repos',
          description: 'Pesquisa repositórios e código no GitHub através do MCP oficial.',
        });
      }
    }
  });

  // 3. Agent configured tools (if explicitly configured on agent)
  if (agent && Array.isArray(agent.tools) && agent.tools.length > 0) {
    const knownToolDescriptions: Record<string, string> = {
      read_file: 'Lê o conteúdo de arquivos locais no diretório de trabalho autorizado.',
      write_file: 'Cria ou sobrescreve arquivos no diretório de trabalho autorizado.',
      edit_file: 'Aplica alterações cirúrgicas e substituições de texto em arquivos existentes.',
      list_directory: 'Lista arquivos e diretórios da árvore de trabalho.',
      run_command: 'Executa comandos shell controlados no workspace Ubuntu Linux.',
      search_files: 'Pesquisa padrões de texto ou expressões regulares no projeto.',
    };

    agent.tools.forEach((toolName) => {
      if (!resolvedFunctionDeclarations.some((f) => f.name === toolName)) {
        resolvedFunctionDeclarations.push({
          name: toolName,
          description: knownToolDescriptions[toolName] || `Ferramenta customizada do agente: ${toolName}`,
        });
      }
    });
  }

  // EXCLUSIVAMENTE o request real capturado do runtime do Gemini CLI
  const finalApiRequest: FinalApiRequest | null = msg.finalApiRequest || null;
  const isRealCapturedRequest = Boolean(msg.finalApiRequest);
  const allRealRequests = msg.allFinalApiRequests && msg.allFinalApiRequests.length > 0
    ? msg.allFinalApiRequests
    : (msg.finalApiRequest ? [{
        model: msg.finalApiRequest.model,
        finalApiRequest: msg.finalApiRequest,
        timestamp: msg.timestamp,
        callIndex: 1,
      }] : []);

  const parameterOrigins: ParameterOrigins = msg.parameterOrigins || {};

  // Build raw events log if missing
  const rawEventsFromMsg = msg.rawPayloadReceived?.rawEvents || [];
  if (rawEventsFromMsg.length === 0 && !isUser) {
    // Generate synthetic SSE log structure for audit
    rawEventsFromMsg.push({
      type: 'process_start',
      timestamp: msg.timestamp,
      command: `gemini --model ${model} --approval-mode ${approvalMode} --work-dir ${workDir}`,
    });

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      msg.toolCalls.forEach((tc) => {
        rawEventsFromMsg.push({
          type: 'tool_use',
          tool_call_id: tc.id,
          name: tc.toolName,
          parameters: tc.parameters,
          timestamp: tc.timestamp,
        });
        rawEventsFromMsg.push({
          type: 'tool_result',
          tool_call_id: tc.id,
          name: tc.toolName,
          output: tc.result || tc.error || 'Executado com sucesso',
          error: tc.error,
          timestamp: tc.timestamp,
        });
      });
    }

    rawEventsFromMsg.push({
      type: 'message',
      role: 'assistant',
      content: msg.content,
      timestamp: msg.timestamp,
    });

    rawEventsFromMsg.push({
      type: 'result',
      status: 'completed',
      exitCode: 0,
      timestamp: msg.timestamp,
    });
  }

  const inputTokens = estimateTokens(inputData.fullInjectedPrompt || msg.content);
  const outputTokens = estimateTokens(msg.content);

  return {
    finalApiRequest,
    isRealCapturedRequest,
    allRealRequests,
    parameterOrigins,
    input: {
      cliExecutable: inputData.cliExecutable || 'gemini',
      model: inputData.model || model,
      agentName: inputData.agentName || agentName,
      approvalMode: inputData.approvalMode || approvalMode,
      workDir: inputData.workDir || workDir,
      authorizedDirs: inputData.authorizedDirs || authorizedDirs.map((d) => d.path),
      systemInstructions: inputData.systemInstructions || sysInst,
      projectContext: inputData.projectContext || workDir,
      activeSkills: inputData.skills || skills.filter((s) => s.enabled).map((s) => s.name),
      activeMcps: inputData.mcpServers || mcpServers.filter((m) => m.enabled).map((m) => m.name),
      promptText: inputData.promptText || msg.content,
      fullInjectedPrompt: inputData.fullInjectedPrompt || msg.content,
      timestamp: inputData.timestamp || msg.timestamp,
    },
    output: {
      rawEvents: rawEventsFromMsg,
      rawTextStream: msg.rawPayloadReceived?.rawTextStream || msg.content,
      toolCalls: msg.toolCalls || [],
      tokenStats: msg.rawPayloadReceived?.tokenStats || {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      durationMs: msg.rawPayloadReceived?.durationMs || 1250,
      status: msg.isStreaming ? 'streaming' : msg.error ? 'error' : 'completed',
      completedAt: msg.rawPayloadReceived?.completedAt || msg.timestamp,
    },
  };
}

