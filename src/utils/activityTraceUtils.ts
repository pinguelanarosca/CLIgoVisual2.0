import { NormalizedActivity, ActivityType, ActivityStatus, ToolCallStep } from '../types';

/**
 * Normaliza um caminho de arquivo para exibição concisa e legível
 */
export function extractFilePath(params: Record<string, any> | undefined): string {
  if (!params || typeof params !== 'object') return '';
  const raw =
    params.TargetFile ||
    params.filePath ||
    params.path ||
    params.file ||
    params.AbsolutePath ||
    params.target_file ||
    params.destination ||
    params.filename ||
    '';
  return typeof raw === 'string' ? raw : '';
}

export function formatFileName(fullPath: string): string {
  if (!fullPath) return '';
  const parts = fullPath.split(/[\/\\]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : fullPath;
}

/**
 * Extrai o comando shell real
 */
export function extractCommand(params: Record<string, any> | undefined): string {
  if (!params || typeof params !== 'object') return '';
  const raw =
    params.CommandLine ||
    params.command ||
    params.cmd ||
    params.script ||
    params.exec ||
    '';
  return typeof raw === 'string' ? raw : '';
}

/**
 * Extrai a consulta de busca web (Exa / Web Search)
 */
export function extractWebQuery(params: Record<string, any> | undefined): string {
  if (!params || typeof params !== 'object') return '';
  const raw =
    params.query ||
    params.search_query ||
    params.q ||
    params.searchQuery ||
    params.keyword ||
    params.url ||
    params.urls ||
    '';
  if (Array.isArray(raw)) return raw.join(', ');
  return typeof raw === 'string' ? raw : JSON.stringify(raw);
}

/**
 * Extrai o agente de destino na delegação (invoke_agent)
 */
export function extractTargetAgent(params: Record<string, any> | undefined): string {
  if (!params || typeof params !== 'object') return '';
  const raw =
    params.agent ||
    params.subagent ||
    params.targetAgent ||
    params.agentName ||
    params.name ||
    params.target_agent ||
    params.agentId ||
    '';
  return typeof raw === 'string' ? raw : '';
}

/**
 * Determina o tipo real da atividade baseado na ferramenta e nos parâmetros
 */
export function classifyToolActivity(
  toolNameRaw: string,
  params: Record<string, any> = {}
): { type: ActivityType; isWebSearch: boolean } {
  const name = (toolNameRaw || '').toLowerCase().trim();

  // 1. Delegação de subagentes (invoke_agent)
  if (
    name === 'invoke_agent' ||
    name === 'delegate_agent' ||
    name === 'call_subagent' ||
    name === 'switch_agent' ||
    name === 'delegate' ||
    name.includes('invoke_agent') ||
    name.includes('delegate')
  ) {
    return { type: 'invoke_agent', isWebSearch: false };
  }

  // 2. Busca Web / MCP Exa
  // CRÍTICO: Corrige o desalinhamento onde 'Access Search Web' ou buscas Exa
  // eram erroneamente confundidas com leitura de diretório!
  if (
    name === 'access search web' ||
    name === 'access_search_web' ||
    name === 'web_search_exa' ||
    name === 'get_contents_exa' ||
    name === 'web_fetch_exa' ||
    name === 'web_search_advanced_exa' ||
    name === 'web_search' ||
    name === 'search_web' ||
    name === 'google_search' ||
    name.includes('exa') ||
    ((name.includes('search') || name.includes('fetch') || name.includes('browse')) &&
      Boolean(params.query || params.search_query || params.q || params.url || params.urls || params.numResults))
  ) {
    return { type: 'web_search', isWebSearch: true };
  }

  // 3. Execução de comandos shell
  if (
    name === 'run_command' ||
    name === 'execute_command' ||
    name === 'bash' ||
    name === 'sh' ||
    name === 'terminal' ||
    name === 'commandline' ||
    name === 'cmd' ||
    Boolean(params.CommandLine || (params.command && !params.query))
  ) {
    return { type: 'command', isWebSearch: false };
  }

  // 4. Criação de novos arquivos
  if (name === 'create_file' || name.includes('create_file') || name.includes('touch')) {
    return { type: 'file_create', isWebSearch: false };
  }

  // 5. Edição / alteração de arquivos
  if (
    name === 'edit_file' ||
    name === 'multi_edit_file' ||
    name === 'write_file' ||
    name === 'replace_file_content' ||
    name.includes('edit_file') ||
    name.includes('write_file') ||
    name.includes('patch')
  ) {
    return { type: 'file_edit', isWebSearch: false };
  }

  // 6. Leitura e visualização de arquivos
  if (
    name === 'view_file' ||
    name === 'read_file' ||
    name === 'fetch_file' ||
    name === 'get_file' ||
    name.includes('read_file') ||
    name.includes('view_file') ||
    name.includes('cat_file')
  ) {
    return { type: 'file_read', isWebSearch: false };
  }

  // 7. Validação, build e testes
  if (
    name === 'compile_applet' ||
    name === 'lint_applet' ||
    name === 'validate' ||
    name.includes('compile') ||
    name.includes('lint')
  ) {
    return { type: 'validation', isWebSearch: false };
  }

  // 8. MCP específico (se origin ou schema indicar MCP)
  if (name.includes('__') || name.startsWith('mcp_')) {
    return { type: 'mcp_tool', isWebSearch: false };
  }

  return { type: 'tool', isWebSearch: false };
}

/**
 * Gera título real e contextual para a atividade
 */
export function generateActivityTitle(
  type: ActivityType,
  status: ActivityStatus,
  toolName: string,
  params: Record<string, any> = {},
  durationMs?: number
): string {
  const isRunning = status === 'running';
  const filePath = extractFilePath(params);
  const fileName = formatFileName(filePath);
  const cmd = extractCommand(params);
  const query = extractWebQuery(params);
  const targetAgent = extractTargetAgent(params);

  switch (type) {
    case 'thinking': {
      if (isRunning) return 'Processando raciocínio (Thinking)...';
      if (durationMs && durationMs > 0) {
        const sec = (durationMs / 1000).toFixed(1);
        return `Raciocínio concluído (${sec}s)`;
      }
      return 'Raciocínio concluído';
    }

    case 'web_search': {
      const qDisplay = query ? `"${query.length > 40 ? query.substring(0, 37) + '...' : query}"` : '';
      if (isRunning) {
        return qDisplay ? `Buscando na Web via Exa: ${qDisplay}...` : 'Buscando dados na Web via Exa...';
      }
      return qDisplay ? `Busca Web via Exa: ${qDisplay}` : 'Busca Web via Exa concluída';
    }

    case 'command': {
      const cmdDisplay = cmd ? `\`${cmd.length > 35 ? cmd.substring(0, 32) + '...' : cmd}\`` : '';
      if (isRunning) {
        return cmdDisplay ? `Executando comando ${cmdDisplay}...` : 'Executando comando no terminal...';
      }
      return cmdDisplay ? `Executou comando ${cmdDisplay}` : 'Comando executado';
    }

    case 'file_read': {
      if (isRunning) {
        return fileName ? `Lendo arquivo '${fileName}'...` : 'Lendo arquivo...';
      }
      return fileName ? `Leu arquivo '${fileName}'` : 'Arquivo lido';
    }

    case 'file_edit': {
      if (isRunning) {
        return fileName ? `Editando arquivo '${fileName}'...` : 'Editando arquivo...';
      }
      return fileName ? `Editou arquivo '${fileName}'` : 'Arquivo editado';
    }

    case 'file_create': {
      if (isRunning) {
        return fileName ? `Criando arquivo '${fileName}'...` : 'Criando arquivo...';
      }
      return fileName ? `Criou arquivo '${fileName}'` : 'Arquivo criado';
    }

    case 'invoke_agent': {
      if (isRunning) {
        return targetAgent ? `Delegando tarefa para o agente '${targetAgent}'...` : 'Delegando tarefa para subagente...';
      }
      if (status === 'failed') {
        return targetAgent ? `Falha na delegação para o agente '${targetAgent}'` : 'Falha na delegação para subagente';
      }
      if (status === 'cancelled') {
        return targetAgent ? `Delegação para o agente '${targetAgent}' cancelada` : 'Delegação para subagente cancelada';
      }
      return targetAgent ? `Delegação para o agente '${targetAgent}' concluída` : 'Delegação para subagente concluída';
    }

    case 'validation': {
      if (isRunning) return 'Validando código e compilação...';
      if (status === 'failed') return 'Falha na validação do código';
      return 'Código e compilação validados com sucesso';
    }

    case 'mcp_tool':
    case 'tool': {
      const displayTool = toolName || 'ferramenta';
      if (isRunning) return `Executando ferramenta '${displayTool}'...`;
      if (status === 'failed') return `Falha na ferramenta '${displayTool}'`;
      return `Executou ferramenta '${displayTool}'`;
    }

    case 'error': {
      return isRunning ? 'Erro detectado na execução...' : 'Erro na execução';
    }

    case 'cancelled': {
      return 'Execução cancelada pelo usuário';
    }

    case 'completed': {
      return 'Execução concluída com sucesso';
    }

    default:
      return isRunning ? `Executando ${toolName}...` : `Executou ${toolName}`;
  }
}

/**
 * Normaliza eventos brutos (SSE) e tool calls existentes em uma lista estrita de NormalizedActivity
 * - Sem inventar dados
 * - Sem perder correlação de IDs
 * - Sem duplicatas
 * - Preservando ordem cronológica real
 */
export function normalizeActivities(options: {
  rawEvents?: any[];
  toolCalls?: ToolCallStep[];
  isStreaming?: boolean;
  agentName?: string;
  model?: string;
  error?: string;
}): NormalizedActivity[] {
  const { rawEvents = [], toolCalls = [], isStreaming = false, agentName, model, error } = options;

  const activitiesMap = new Map<string, NormalizedActivity>();
  let sequenceCounter = 0;

  // 1. Processar ToolCallSteps existentes (já correlacionados no App.tsx ou banco)
  for (const tc of toolCalls) {
    if (!tc || !tc.id) continue;

    const callId = tc.id;
    const { type } = classifyToolActivity(tc.toolName, tc.parameters);
    const duration = tc.durationMs ?? (tc.completedAt && tc.startedAt ? tc.completedAt - tc.startedAt : undefined);

    let status: ActivityStatus = 'running';
    if (tc.status === 'completed') status = 'completed';
    else if (tc.status === 'failed' || Boolean(tc.error)) status = 'failed';
    else if (tc.status === 'running') status = 'running';
    else if (!isStreaming) status = 'completed'; // Se stream terminou e não houve falha, foi concluído

    const title = generateActivityTitle(type, status, tc.toolName, tc.parameters, duration);

    activitiesMap.set(callId, {
      id: callId,
      toolCallId: callId,
      sequence: sequenceCounter++,
      type,
      status,
      title,
      timestamp: tc.timestamp || new Date().toISOString(),
      startedAt: tc.startedAt,
      completedAt: tc.completedAt,
      durationMs: duration,
      toolName: tc.toolName,
      command: extractCommand(tc.parameters),
      filePath: extractFilePath(tc.parameters),
      searchQuery: extractWebQuery(tc.parameters),
      targetAgent: extractTargetAgent(tc.parameters),
      agentName: tc.componentExecutor || agentName,
      model,
      arguments: tc.parameters,
      result: tc.result,
      error: tc.error,
      metadata: {
        origin: tc.origin,
        wrapperRelation: tc.wrapperRelation,
        componentRegister: tc.componentRegister,
        componentExecutor: tc.componentExecutor,
      },
    });
  }

  // 2. Processar rawEvents (fluxo completo do Gemini CLI SSE stream)
  let activeThinkingActivity: NormalizedActivity | null = null;

  for (const evt of rawEvents) {
    if (!evt || typeof evt !== 'object') continue;

    const evtType = evt.type || evt.sessionUpdate || '';
    const evtTimestamp = evt.timestamp || new Date().toISOString();

    // A. Eventos de Raciocínio (Thinking)
    // REQUISITO: "Thinking: mostrar somente duração/evento de thinking realmente fornecido pelo runtime; nunca exibir cadeia de pensamento privada."
    if (
      evtType === 'agent_thought_chunk' ||
      evtType === 'thought' ||
      evtType === 'thinking' ||
      evt.sessionUpdate === 'agent_thought_chunk'
    ) {
      if (!activeThinkingActivity) {
        const thinkingId = `thinking_${activitiesMap.size}_${sequenceCounter}`;
        activeThinkingActivity = {
          id: thinkingId,
          eventId: evt.id || evt.prompt_id,
          sequence: sequenceCounter++,
          type: 'thinking',
          status: 'running',
          title: 'Processando raciocínio (Thinking)...',
          timestamp: evtTimestamp,
          startedAt: Date.now(),
          agentName,
          model,
          // NUNCA armazenar cadeia de pensamento privada:
          metadata: {
            isRuntimeThinking: true,
            thoughtLevel: evt.thought_level || evt.level,
          },
        };
        activitiesMap.set(thinkingId, activeThinkingActivity);
      }
      continue;
    }

    // Se houve evento posterior e havia thinking ativo, fecha o thinking
    if (activeThinkingActivity && activeThinkingActivity.status === 'running') {
      const now = Date.now();
      activeThinkingActivity.completedAt = now;
      activeThinkingActivity.durationMs = activeThinkingActivity.startedAt ? now - activeThinkingActivity.startedAt : undefined;
      activeThinkingActivity.status = 'completed';
      activeThinkingActivity.title = generateActivityTitle('thinking', 'completed', '', {}, activeThinkingActivity.durationMs);
      activeThinkingActivity = null;
    }

    // B. Evento de chamada de ferramenta (tool_use / tool_call)
    if (evtType === 'tool_use' || evtType === 'tool_call') {
      const toolCallId = evt.tool_call_id || evt.tool_id || evt.id || `tool_${sequenceCounter}`;
      const toolName = evt.tool_name || evt.name || evt.title || 'tool';
      const params = evt.parameters || evt.args || evt.arguments || {};
      const { type } = classifyToolActivity(toolName, params);

      const existing = activitiesMap.get(toolCallId);
      if (existing) {
        // Atualizar sem duplicar
        existing.arguments = { ...existing.arguments, ...params };
        existing.toolName = toolName;
        existing.type = type;
        existing.title = generateActivityTitle(type, existing.status, toolName, existing.arguments, existing.durationMs);
      } else {
        const newAct: NormalizedActivity = {
          id: toolCallId,
          toolCallId,
          eventId: evt.id,
          requestId: evt.request_id || evt.prompt_id,
          sequence: sequenceCounter++,
          type,
          status: 'running',
          title: generateActivityTitle(type, 'running', toolName, params),
          timestamp: evtTimestamp,
          startedAt: Date.now(),
          toolName,
          command: extractCommand(params),
          filePath: extractFilePath(params),
          searchQuery: extractWebQuery(params),
          targetAgent: extractTargetAgent(params),
          agentName,
          model,
          arguments: params,
          metadata: {
            origin: evt.origin,
            schema: evt.schema,
          },
        };
        activitiesMap.set(toolCallId, newAct);
      }
      continue;
    }

    // C. Evento de resultado de ferramenta (tool_result / tool_call_update)
    if (evtType === 'tool_result' || evtType === 'tool_call_update') {
      const toolCallId = evt.tool_call_id || evt.tool_id || evt.id;
      if (toolCallId && activitiesMap.has(toolCallId)) {
        const act = activitiesMap.get(toolCallId)!;
        const now = Date.now();
        act.completedAt = now;
        if (act.startedAt) {
          act.durationMs = now - act.startedAt;
        }
        const isError = evt.status === 'error' || evt.status === 'failed' || Boolean(evt.error);
        act.status = isError ? 'failed' : 'completed';
        act.result = typeof evt.output === 'string' ? evt.output : JSON.stringify(evt.output || evt.result || '');
        if (evt.error) {
          act.error = typeof evt.error === 'string' ? evt.error : JSON.stringify(evt.error);
        }
        act.title = generateActivityTitle(act.type, act.status, act.toolName || '', act.arguments || {}, act.durationMs);
      }
      continue;
    }

    // D. Evento de cancelamento real
    if (evtType === 'cancelled' || evt.signal === 'SIGINT') {
      const cancelId = `cancel_${sequenceCounter}`;
      activitiesMap.set(cancelId, {
        id: cancelId,
        sequence: sequenceCounter++,
        type: 'cancelled',
        status: 'cancelled',
        title: 'Execução cancelada pelo usuário',
        timestamp: evtTimestamp,
        agentName,
        model,
        metadata: { signal: evt.signal || 'SIGINT' },
      });
      continue;
    }

    // E. Evento de erro de processo/runtime
    if (evtType === 'process_error' || (evtType === 'error' && evt.severity === 'error')) {
      const errId = `error_${sequenceCounter}`;
      const errMsg = evt.message || evt.error || 'Erro reportado pelo runtime';
      activitiesMap.set(errId, {
        id: errId,
        sequence: sequenceCounter++,
        type: 'error',
        status: 'failed',
        title: `Erro: ${errMsg.length > 50 ? errMsg.substring(0, 47) + '...' : errMsg}`,
        timestamp: evtTimestamp,
        error: errMsg,
        agentName,
        model,
        metadata: evt,
      });
      continue;
    }

    // F. Final stats result
    if (evtType === 'result' && evt.stats) {
      if (evt.stats.thoughtDurationMs) {
        const existingThinking = Array.from(activitiesMap.values()).find((a) => a.type === 'thinking');
        if (existingThinking) {
          existingThinking.durationMs = evt.stats.thoughtDurationMs;
          existingThinking.status = 'completed';
          existingThinking.title = generateActivityTitle('thinking', 'completed', '', {}, evt.stats.thoughtDurationMs);
          if (existingThinking.metadata) {
            existingThinking.metadata.thoughtTokens = evt.stats.thoughtTokens;
            existingThinking.metadata.thoughtDurationMs = evt.stats.thoughtDurationMs;
          }
        } else {
          const thId = `thinking_stat_${sequenceCounter}`;
          activitiesMap.set(thId, {
            id: thId,
            sequence: 0, // Inserido no início do ciclo
            type: 'thinking',
            status: 'completed',
            title: `Raciocínio concluído (${(evt.stats.thoughtDurationMs / 1000).toFixed(1)}s)`,
            timestamp: evtTimestamp,
            durationMs: evt.stats.thoughtDurationMs,
            agentName,
            model,
            metadata: {
              thoughtTokens: evt.stats.thoughtTokens,
              thoughtDurationMs: evt.stats.thoughtDurationMs,
            },
          });
        }
      }
    }
  }

  // Se o stream já finalizou e restou alguma atividade como 'running', marcar como concluída
  if (!isStreaming) {
    for (const act of activitiesMap.values()) {
      if (act.status === 'running') {
        act.status = 'completed';
        act.title = generateActivityTitle(act.type, 'completed', act.toolName || '', act.arguments || {}, act.durationMs);
      }
    }
  }

  // Adicionar erro explícito da mensagem caso exista e não haja atividade de erro
  if (error && !Array.from(activitiesMap.values()).some((a) => a.type === 'error')) {
    const errId = `msg_error_${sequenceCounter}`;
    activitiesMap.set(errId, {
      id: errId,
      sequence: sequenceCounter++,
      type: 'error',
      status: 'failed',
      title: `Erro: ${error.length > 50 ? error.substring(0, 47) + '...' : error}`,
      timestamp: new Date().toISOString(),
      error,
      agentName,
      model,
    });
  }

  // Ordenação estrita pela sequência real de chegada
  return Array.from(activitiesMap.values()).sort((a, b) => a.sequence - b.sequence);
}
