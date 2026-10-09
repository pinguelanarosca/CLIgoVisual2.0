import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const agentContext = new AsyncLocalStorage<{ agentId: string; invocationId?: string; chain?: string[]; tool_call_id?: string; lastRequest?: any; approvalModes?: Map<object, any> }>();
const scopedConfigs = new WeakSet<object>();
function bindDelegationConfig(config: any) {
  if (!config || scopedConfigs.has(config)) return;
  const engine = config.getPolicyEngine();
  let baseMode = engine.approvalMode;
  Object.defineProperty(engine, 'approvalMode', {
    configurable: true, enumerable: true,
    get: () => agentContext.getStore()?.approvalModes?.get(engine) ?? baseMode,
    set: mode => {
      const modes = agentContext.getStore()?.approvalModes;
      if (modes?.has(engine)) modes.set(engine, mode);
      else baseMode = mode;
    },
  });
  const setApprovalMode = config.setApprovalMode;
  config.setApprovalMode = function(mode: any) {
    if (!agentContext.getStore()?.approvalModes?.has(engine)) return setApprovalMode.call(this, mode);
    // Keep the native trust check and policy rules, without updating the parent's client/tools.
    if (!this.isTrustedFolder() && mode !== 'default' && mode !== 'plan') throw new Error('Cannot enable privileged approval modes in an untrusted folder.');
    engine.setApprovalMode(mode);
  };
  scopedConfigs.add(config);
}

export function emitAgentActivity(type: string, data: any, identity: { agentId: string; invocationId: string; parentToolCallId?: string }) {
  const context = agentContext.getStore();
  const common = { ...context?.lastRequest, executionId: delegationExecutionId, ...identity, timestamp: new Date().toISOString() };
  const nativeToolCallId = data.callId ?? data.id;
  const toolId = nativeToolCallId ? identity.invocationId + ':' + nativeToolCallId : undefined;
  let event;
  if (type === 'THOUGHT_CHUNK') event = { type: 'analysis_summary', activityId: 'analysis:' + identity.invocationId, summary: data.text, ...common };
  if (type === 'TOOL_CALL_START') event = { type: 'tool_use', tool_id: toolId, nativeToolCallId, tool_name: data.name, parameters: data.args, ...common };
  if (type === 'TOOL_CALL_END') event = { type: 'tool_result', tool_id: toolId, nativeToolCallId, tool_name: data.name, output: data.output, status: 'success', ...common };
  if (type === 'ERROR' && data.callId) event = { type: 'tool_result', tool_id: toolId, nativeToolCallId, tool_name: data.name, error: data.error, status: 'failed', ...common };
  if (event) process.stdout.write(JSON.stringify(event) + '\n');
}
export function runWithAgent(agentId: string, invocationId: string, run: () => any) {
  const current = agentContext.getStore();
  if (current?.agentId === agentId && current.invocationId === invocationId) return run();
  return agentContext.run({ ...agentContext.getStore(), agentId, invocationId }, run);
}
let delegationExecutionId: string | undefined;
const delegations = new Map<string, Promise<any>>();
export async function runDelegation(agentId: string, invocationId: string, inputs: any, signal: AbortSignal, run: () => Promise<any>, parentCallId?: string, config?: any) {
  signal?.throwIfAborted();
  const chain = agentContext.getStore()?.chain || [process.env.GEMINI_GUI_AGENT_ID || 'principal'];
  if (chain.includes(agentId)) throw new Error(`Delegação cíclica bloqueada: ${chain.join(' → ')} → ${agentId}`);
  const key = agentId + (process.env.GEMINI_GUI_INVOKE_ALL === '1' ? '' : JSON.stringify(inputs));
  const existing = delegations.get(key);
  if (existing) { emit('DELEGATION_REUSED', { agentId, invocationId }); return existing; }
  bindDelegationConfig(config);
  const engine = config?.getPolicyEngine();
  const approvalModes = new Map<object, any>();
  if (engine) approvalModes.set(engine, engine.getApprovalMode());
  const promise = agentContext.run({ agentId, invocationId, chain: [...chain, agentId], tool_call_id: parentCallId, approvalModes }, async () => {
    const terminal = (status: string, output: any, error?: string) => {
      if (parentCallId) process.stdout.write(JSON.stringify({ type: 'tool_result', tool_id: parentCallId, tool_name: 'invoke_agent', ...agentContext.getStore()?.lastRequest, agentId, invocationId, status, output, error }) + '\n');
    };
    try {
      const output = await run();
      signal?.throwIfAborted();
      if (output?.terminate_reason && (output.terminate_reason !== 'GOAL' || !String(output.result || '').trim())) throw new Error(`Subagente ${agentId} não concluiu a tarefa (${output.terminate_reason}): ${output.result || 'Sem resultado terminal.'}`);
      terminal('success', output?.result ?? output);
      return output;
    } catch (error: any) {
      if (error.runtimeDetails && agentContext.getStore()) agentContext.getStore()!.lastRequest = { ...agentContext.getStore()?.lastRequest, ...error.runtimeDetails, cause: { ...error.runtimeDetails, code: error.code, message: error.message } };
      terminal(signal?.aborted ? 'cancelled' : 'failed', error.message, error.message);
      emit('DELEGATION_FAILED', { ...agentContext.getStore()?.lastRequest, ...error.runtimeDetails, agentId, invocationId, tool_call_id: parentCallId, message: error.message, code: error.code });
      throw error;
    }
  });
  delegations.set(key, promise);
  return promise;
}

async function bridge(input: any, signal?: AbortSignal): Promise<any> {
  const deadline = AbortSignal.timeout(10000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const details = { bridgeAction: input.action, bridgeRequestId: randomUUID(), requestId: input.requestId, agentId: input.agentId || agentContext.getStore()?.agentId || process.env.GEMINI_GUI_AGENT_ID, invocationId: input.invocationId || agentContext.getStore()?.invocationId, model: input.model, affectsKey: false };
  for (let retry = 0; retry < 2; retry++) {
    try {
      const response = await fetch(process.env.GEMINI_GUI_RUNTIME_URL!, {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.GEMINI_GUI_RUNTIME_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, bridgeRequestId: details.bridgeRequestId }), signal: combined,
      });
      if (!response.ok) throw Object.assign(new Error(`Runtime bridge: ação ${input.action} recusada (HTTP ${response.status}).`), { bridgeHttpStatus: response.status });
      const output = await response.json();
      if ((input.action === 'plan' && output.protocolVersion !== 1) || (input.action === 'attempt' && typeof output.allowed !== 'boolean')) {
        throw Object.assign(new Error('Runtime bridge: protocolo incompatível; reinicie o backend com o build instalado.'), { code: 'GUI_RUNTIME_PROTOCOL', protocolVersion: Number(output.protocolVersion) || undefined });
      }
      return output;
    } catch (cause: any) {
      const transient = cause.bridgeHttpStatus >= 500 || (!cause.bridgeHttpStatus && cause.code !== 'GUI_RUNTIME_PROTOCOL' && cause instanceof TypeError);
      if (retry === 0 && transient && !combined.aborted) { emit('RUNTIME_BRIDGE_RETRY', { ...details, bridgeHttpStatus: cause.bridgeHttpStatus }); continue; }
      const code = signal?.aborted ? 'GUI_EXECUTION_CANCELLED' : deadline.aborted ? 'GUI_RUNTIME_TIMEOUT' : cause.code === 'GUI_RUNTIME_PROTOCOL' || cause.bridgeHttpStatus === 400 ? 'GUI_RUNTIME_PROTOCOL' : 'GUI_RUNTIME_UNAVAILABLE';
      const error = Object.assign(new Error(code === 'GUI_EXECUTION_CANCELLED' ? 'Execução cancelada durante comunicação com Runtime bridge.' : `${code}: ${code === 'GUI_RUNTIME_PROTOCOL' ? 'Runtime bridge usa protocolo incompatível; reinicie o backend com o build instalado.' : cause.bridgeHttpStatus ? `Runtime bridge recusou ${input.action} (HTTP ${cause.bridgeHttpStatus}).` : 'Falha local na comunicação com Runtime bridge.'} Nenhuma chamada adicional ao provedor foi iniciada.`), {
        code, guiManaged: true, cause,
        runtimeDetails: { ...details, bridgeHttpStatus: cause.bridgeHttpStatus, protocolVersion: cause.protocolVersion, expectedProtocolVersion: 1, abortedBy: signal?.aborted ? 'caller' : deadline.aborted ? 'bridge_timeout' : undefined },
        ...details,
      });
      emit('RUNTIME_BRIDGE_FAILURE', { ...error.runtimeDetails, code, message: error.message });
      throw error;
    }
  }
}
function emit(event: string, data: any) {
  const { approvalModes, ...context } = agentContext.getStore() || {};
  process.stdout.write(JSON.stringify({ type: 'runtime_event', channel: 'runtime_event', timestamp: new Date().toISOString(), event, ...context, ...data }) + '\n');
}

// No model guessing: only an exact resource/baseModelId match returned by this key's catalog.
export async function resolveCompatibleModel(model: string, key: string, endpoint: string, apiVersion: string, signal?: AbortSignal): Promise<string | null> {
  const configured = model.replace(/^models\//, '');
  let pageToken = '';
  const matches = new Set<string>();
  do {
    const url = new URL(`${endpoint.replace(/\/$/, '')}/${apiVersion}/models`);
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, { headers: { 'x-goog-api-key': key }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    const catalog = await response.json();
    for (const candidate of catalog.models || []) {
      const name = String(candidate.name || '').replace(/^models\//, '');
      if (!(candidate.supportedGenerationMethods || []).includes('generateContent')) continue;
      if (name === configured) return name;
      if (candidate.baseModelId === configured) matches.add(name);
    }
    pageToken = catalog.nextPageToken || '';
  } while (pageToken);
  return matches.size === 1 ? [...matches][0] : null;
}

export function wrapModels(original: any, factory?: (key: string) => any, endpoint = 'https://generativelanguage.googleapis.com', apiVersion = 'v1beta') {
  if (!process.env.GEMINI_GUI_RUNTIME_URL) return original;
  const managed = async (method: string, req: any, ...rest: any[]) => {
    if (req.config?.tools?.some((tool: any) => tool.googleSearch || tool.googleSearchRetrieval)) return original[method](req, ...rest);
    const signal = req.config?.abortSignal;
    const agentId = agentContext.getStore()?.agentId || process.env.GEMINI_GUI_AGENT_ID || 'principal';
    const invocationId = agentContext.getStore()?.invocationId;
    const initial = await bridge({ action: 'plan', agentId, invocationId, model: req.model }, signal);
    if (!agentContext.getStore() && initial.executionId && initial.executionId !== delegationExecutionId) { delegations.clear(); delegationExecutionId = initial.executionId; }
    const primaryModel = agentContext.getStore() ? initial.configuredModel : req.model;
    const models = [...new Set([primaryModel, initial.fallbackModel].filter(Boolean))];
    let nextRetryAt: string | undefined;
    let quota = false;
    const invalidKeys = new Set<string>();
    let previousFailure = initial.lastFailure;
    let fallbackReason = 'MODEL_OPTIONS_EXHAUSTED';
    const firstModel = initial.activeModel === initial.fallbackModel && models.length > 1 ? 1 : 0;
    for (let index = firstModel; index < models.length; index++) {
      const configuredModel = models[index];
      const plan = await bridge({ action: 'plan', agentId, invocationId, model: configuredModel }, signal);
      if (plan.availability?.nextRetryAt && (!nextRetryAt || plan.availability.nextRetryAt < nextRetryAt)) nextRetryAt = plan.availability.nextRetryAt;
      quota ||= Boolean(plan.availability?.quota);
      const keys = factory ? plan.keys.filter((candidate: any) => !invalidKeys.has(candidate.keyId)) : [{ keyId: '', key: '' }];
      const remainingKeys = [...keys];
      let attemptIndex = 0;
      keyAttempts: while (remainingKeys.length) {
        signal?.throwIfAborted();
        const leaseRequestId = randomUUID();
        let candidate: any;
        if (!factory) candidate = remainingKeys.shift();
        else {
          for (let index = 0; index < remainingKeys.length; index++) {
            const key = remainingKeys[index];
            const lease = await bridge({ action: 'acquire', model: configuredModel, keyId: key.keyId, requestId: leaseRequestId }, signal);
            if (lease.acquired) { candidate = remainingKeys.splice(index, 1)[0]; break; }
            if (!lease.eligible) { remainingKeys.splice(index, 1); index--; }
          }
          // Only wait for requests already running, never for a quota reset.
          if (!candidate && remainingKeys.length) { await delay(100, undefined, { signal }); continue; }
          if (!candidate) break;
        }
        const { keyId, key } = candidate;
        const attemptRequestIds: string[] = [];
        try {
        let effectiveModel = configuredModel;
        let networkRetries = 0;
        const sdk = factory ? factory(key) : original;
        for (let repair = 0; repair < 2; repair++) {
          signal?.throwIfAborted();
          const requestId = randomUUID();
          attemptRequestIds.push(requestId);
          const budget = await bridge({ action: 'attempt', agentId, requestId, invocationId, model: configuredModel, primaryModel }, signal);
          if (budget.allowed === false) {
            if (index === 0 && models.length > 1 && budget.nextModel === models[1]) {
              fallbackReason = budget.reason;
              previousFailure = budget.lastFailure || previousFailure;
              break keyAttempts;
            }
            const error = Object.assign(new Error('GUI_RETRY_BUDGET: limite de falhas por execução/invocação atingido; nenhuma nova tentativa automática.'), { code: 'GUI_RETRY_BUDGET', guiManaged: true, runtimeDetails: { ...previousFailure, cause: previousFailure, budget } });
            emit('EXECUTION_BLOCKED', { id: 'budget:' + agentId, agentId, message: error.message, code: error.code, cause: previousFailure, budget });
            throw error;
          }
          if (index > firstModel && attemptIndex === 0 && repair === 0) emit('MODEL_FALLBACK', { agentId, invocationId, fromModel: previousFailure?.model || primaryModel, toModel: effectiveModel, model: effectiveModel, configuredModel: initial.configuredModel, reason: fallbackReason, cause: previousFailure, previousKeyId: previousFailure?.keyId, previousRequestId: previousFailure?.requestId, keyId, requestId, endpoint, apiVersion });
          emit(attemptIndex ? 'KEY_FAILOVER' : 'ATTEMPT', { agentId, keyId, model: effectiveModel, configuredModel: initial.configuredModel, endpoint, apiVersion, requestId });
          const start = Date.now();
          const timeoutMs = req.config?.httpOptions?.timeout || 30000;
          const deadline = new AbortController();
          const timer = setTimeout(() => deadline.abort(), timeoutMs);
          timer.unref();
          const requestSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
          const requestDetails = { agentId, invocationId: agentContext.getStore()?.invocationId, model: effectiveModel, configuredModel, requestId, keyId, endpoint, apiVersion };
          if (agentContext.getStore()) agentContext.getStore()!.lastRequest = requestDetails;
          let requestPhase = 'awaiting_response';
          let responseChunks = 0, responseBytes = 0;
          let firstChunkMs: number | undefined, lastChunkMs: number | undefined;
          const progress = () => ({ requestPhase, elapsedMs: Date.now() - start, responseChunks, responseBytes, firstChunkMs, lastChunkMs });
          try {
            const actual = { ...req, model: effectiveModel, config: { ...req.config, abortSignal: requestSignal, httpOptions: { ...req.config?.httpOptions, timeout: timeoutMs, retryOptions: { attempts: 1 } } } };
            const response = await sdk[method](actual, ...rest);
            requestSignal.throwIfAborted();
            // Buffer an attempt so a failed stream cannot contaminate chat/history or execute tools twice.
            const result: any[] = [];
            if (method === 'generateContentStream') {
              requestPhase = 'streaming';
              for await (const chunk of response) {
                requestSignal.throwIfAborted();
                lastChunkMs = Date.now() - start;
                firstChunkMs ??= lastChunkMs;
                responseChunks++;
                responseBytes += Buffer.byteLength(JSON.stringify(chunk));
                if (responseBytes > 24 * 1024 * 1024 || result.length >= 10000) throw Object.assign(new Error('GUI_RESPONSE_LIMIT: resposta excedeu o limite local de buffer (24 MiB/10 mil fragmentos).'), { code: 'GUI_RESPONSE_LIMIT' });
                result.push(chunk);
              }
            }
            requestSignal.throwIfAborted();
            clearTimeout(timer);
            requestPhase = 'bridge_result';
            await bridge({ action: 'result', agentId, invocationId: agentContext.getStore()?.invocationId, requestId, endpoint, apiVersion, model: configuredModel, keyId, success: true, status: 200, latencyMs: Date.now() - start }, signal);
            emit('SUCCESS', { ...requestDetails, ...progress() });
            return method === 'generateContentStream' ? (async function* () { yield* result; })() : response;
          } catch (error: any) {
            clearTimeout(timer);
            if (signal?.aborted || deadline.signal.aborted || error.name === 'AbortError' || /AbortError.*aborted|operation was aborted/i.test(error.message)) {
              const abortedBy = signal?.aborted ? 'caller' : deadline.signal.aborted ? 'request_timeout' : 'sdk_abort';
              const code = abortedBy === 'caller' ? 'GUI_EXECUTION_CANCELLED' : abortedBy === 'request_timeout' ? 'GUI_REQUEST_TIMEOUT' : 'GUI_REQUEST_ABORTED';
              const originalError = key ? String(error.message).split(key).join('[REDACTED]') : error.message;
              const details = { ...requestDetails, ...progress(), abortedBy, timeoutMs, code, errorCode: code, affectsKey: false, originalError };
              const reason = Object.assign(new Error(`${code}: ${abortedBy === 'request_timeout' ? `requisição atingiu o timeout de ${timeoutMs} ms` : abortedBy === 'caller' ? 'execução cancelada pelo chamador' : 'requisição abortada pelo SDK'}. ${originalError}`), { code, guiManaged: true, cause: error, runtimeDetails: details });
              if (agentContext.getStore()) agentContext.getStore()!.lastRequest = details;
              emit('API_FAILURE', { ...details, message: reason.message });
              // Cleanup/accounting uses its own IPC deadline, even if the caller was cancelled.
              await bridge({ action: 'result', ...requestDetails, model: configuredModel, success: false, code, message: reason.message, latencyMs: Date.now() - start }).catch(() => {});
              throw reason;
            }
            if (String(error.code || '').startsWith('GUI_RUNTIME_')) throw error;
            let classified: any;
            try {
              classified = await bridge({ action: 'result', agentId, invocationId: agentContext.getStore()?.invocationId, requestId, endpoint, apiVersion, model: configuredModel, keyId, success: false, status: Number(error.status || error.code) || undefined, code: error.code, message: error.message, latencyMs: Date.now() - start }, signal);
            } catch (bridgeError: any) {
              // A failed acknowledgement must retain the provider's original error.
              const providerFailure = { ...requestDetails, httpStatus: Number(error.status || error.code) || undefined, message: key ? String(error.message).split(key).join('[REDACTED]') : error.message };
              bridgeError.runtimeDetails = { ...bridgeError.runtimeDetails, providerFailure };
              emit('API_FAILURE', { ...providerFailure, classificationUnavailable: true, affectsKey: false });
              throw bridgeError;
            }
            previousFailure = { ...requestDetails, ...classified };
            if (agentContext.getStore()) agentContext.getStore()!.lastRequest = { ...requestDetails, cause: { ...classified, requestId } };
            emit('API_FAILURE', { ...requestDetails, ...classified });
            if (classified.affectsKey === false) {
              if (classified.errorCode === 'NETWORK_FAILURE' && networkRetries++ === 0) { repair--; await delay(250, undefined, { signal }); continue; }
              error.guiManaged = true;
              throw error;
            }
            if (classified.group === 'G6') {
              if (classified.errorCode === 'MODEL_NOT_FOUND' && repair === 0 && factory) {
                let resolved: string | null = null;
                try { resolved = await resolveCompatibleModel(configuredModel, key, endpoint, apiVersion, signal); } catch (catalogError) { if (signal?.aborted) throw catalogError; emit('CATALOG_UNAVAILABLE', { agentId, keyId, model: configuredModel, endpoint, apiVersion }); }
                if (resolved && resolved !== effectiveModel) {
                  effectiveModel = resolved;
                  emit('MODEL_COMPATIBILITY', { agentId, keyId, model: effectiveModel, configuredModel, endpoint, apiVersion });
                  continue; // Same credential, never modify agent settings.
                }
              }
              // Model/project availability can differ per key, so do not infer other key results.
              if (classified.errorCode !== 'MODEL_NOT_FOUND') throw error;
              break;
            }
            if (classified.group === 'G5') invalidKeys.add(keyId);
            if (!['G2', 'G3', 'G4', 'G5'].includes(classified.group)) throw error;
            break;
          } finally { clearTimeout(timer); }
        }
        } finally {
          attemptIndex++;
          await bridge({ action: 'release', model: configuredModel, keyId, requestId: leaseRequestId, attemptRequestIds }).catch(() => {});
        }
      }
      const remaining = await bridge({ action: 'plan', agentId, invocationId, model: configuredModel }, signal);
      if (remaining.availability?.nextRetryAt && (!nextRetryAt || remaining.availability.nextRetryAt < nextRetryAt)) nextRetryAt = remaining.availability.nextRetryAt;
      quota ||= Boolean(remaining.availability?.quota);
    }
    emit('RETRY_EXHAUSTED', { agentId, model: req.model, managed: true, nextRetryAt });
    const message = quota ? 'Opções disponíveis esgotadas; há restrições de cota.' : 'Nenhuma opção elegível está disponível para este agente.';
    emit('EXECUTION_BLOCKED', { id: 'unavailable:' + agentId, agentId, message, nextRetryAt });
    // Prevent native generic retry layers from repeating this exhausted strategy.
    const terminal = new Error(message + (nextRetryAt ? ' Próxima tentativa a partir de ' + nextRetryAt + '.' : '') + ' Consulte Logs/Payload.');
    (terminal as any).code = 'GUI_OPTIONS_EXHAUSTED';
    throw terminal;
  };
  return new Proxy(original, { get(target, property) {
    if (property === 'generateContent' || property === 'generateContentStream') return (req: any, ...rest: any[]) => managed(property, req, ...rest);
    const value = target[property];
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

// Exa's anonymous endpoint can return its rate-limit notice as ordinary text,
// without MCP isError. Classify only the provider's control response, not search snippets.
export function normalizeExaMcpError(serverName: string, toolName: string, parts: any) {
  if (String(serverName).toLowerCase() !== 'exa' && !/_exa$/i.test(toolName)) return;
  const response = parts?.[0]?.functionResponse?.response;
  if (!response || response.isError === true || response.isError === 'true') return;
  const content = response.content;
  if (!Array.isArray(content) || !content.length || content.some((block: any) => block.type !== 'text')) return;
  const text = content.map((block: any) => String(block.text || '')).join('\n').trim();
  if (!/^You've hit Exa['’]s free MCP rate limit(?:[.\s]|$)/i.test(text)) return;
  response.isError = true;
  response.error = { isError: true, code: 'EXA_MCP_RATE_LIMIT', message: 'Exa MCP indisponível: limite gratuito atingido.', affectsKey: false };
}

export async function fallbackWebSearch(context: any, query: string, signal: AbortSignal, error: any) {
  const classified = await bridge({ action: 'classify', status: Number(error.status || error.code) || undefined, code: error.code, message: error.message }, signal);
  if (classified.group !== 'G3') throw error;
  const registry = context.toolRegistry || context.config?.getToolRegistry();
  const tools = registry?.getAllTools() || [];
  const exa = tools.find((tool: any) => (tool.serverName === 'exa' || /(?:^|__)exa(?:__|_)/i.test(tool.name)) && /web_search(?:_advanced)?_exa/.test(tool.name));
  if (!exa) throw new Error('Busca nativa sem cota; ferramenta Exa MCP não disponível nesta execução.');
  emit('WEB_FALLBACK', { tool: exa.name, group: classified.group });
  const toolId = 'exa-' + randomUUID();
  process.stdout.write(JSON.stringify({ type: 'tool_use', tool_id: toolId, tool_name: exa.name, parameters: { query } }) + '\n');
  let result: any;
  try {
    const invocation = exa.build({ query });
    result = await invocation.execute({ abortSignal: signal });
  } catch (failure: any) {
    process.stdout.write(JSON.stringify({ type: 'tool_result', tool_id: toolId, status: 'failed', error: failure.message }) + '\n');
    throw failure;
  }
  process.stdout.write(JSON.stringify({ type: 'tool_result', tool_id: toolId, status: result.error ? 'failed' : 'success', output: result.llmContent, error: result.error }) + '\n');
  if (result.error) throw new Error(result.error.message || 'Exa MCP retornou erro na busca.');
  emit('WEB_SUCCESS', { tool: exa.name });
  return result;
}
