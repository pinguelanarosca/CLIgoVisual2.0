import http from 'node:http';
import crypto from 'node:crypto';
import { classifyKeyResult, getRankedKeys, getEligibleRankedKeys, getModelAvailability, recordRuntimeExecutionResult, loadConfiguredKeys } from './key-pool-service.js';

const activeRuntimeLeases = new Map<string, string>();

// A per-execution, authenticated loopback channel. Secrets never enter SSE/logs.
export async function createRuntimeBridge(options: {
  agents: Array<{ name: string; model: string; fallbackModel?: string }>;
  executionId?: string;
  getExecutionId?: () => string | undefined;
  agentId: string; apiKey?: string; mode: string;
  onEvent: (event: { type: string; data: any }) => void;
}) {
  const leases = activeRuntimeLeases;
  const ownedLeases = new Set<string>();
  const executionId = () => options.getExecutionId?.() || options.executionId;
  let failures = 0;
  const pendingAttempts = new Map<string, string>();
  const invocationFailures = new Map<string, number>();
  const modelFailures = new Map<string, Map<string, number>>();
  const pendingModels = new Map<string, string>();
  const invocationFallbacks = new Map<string, string>();
  const lastFailures = new Map<string, any>();
  const executionLimit = 12, invocationLimit = 6;
  const budgetFor = (id: string) => {
    const pending = [...pendingAttempts.values()].filter(value => value === id).length;
    return { failures, invocationFailures: invocationFailures.get(id) || 0, limit: executionLimit, invocationLimit, remaining: Math.max(0, Math.min(executionLimit - failures - pendingAttempts.size, invocationLimit - (invocationFailures.get(id) || 0) - pending)) };
  };
  const completedResults = new Map<string, any>();
  let closed = false;
  const event = (name: string, data: any = {}) => {
    try { options.onEvent({ type: 'runtime_event', data: { type: 'runtime_event', event: name, executionId: executionId(), agentId: options.agentId, ...data } }); } catch { /* Diagnostics cannot break IPC. */ }
  };
  const token = crypto.randomBytes(32).toString('hex');
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'POST' || req.headers.authorization !== `Bearer ${token}`) { res.writeHead(403).end('{}'); return; }
    let input: any;
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 1024 * 1024) { res.writeHead(413).end('{}'); return; }
      }
      input = JSON.parse(body);
      if (input.action === 'plan') {
        const name = input.agentId || options.agentId;
        const agent = options.agents.find(a => a.name === name);
        const keys = options.mode === 'api-key' ? getEligibleRankedKeys(input.model).map(k => ({ keyId: k.keyId, key: k.key })) : [];
        if (!getRankedKeys(input.model).length && options.mode === 'api-key' && options.apiKey) keys.push({ keyId: '', key: options.apiKey });
        const id = input.invocationId || name;
        res.end(JSON.stringify({ protocolVersion: 1, executionId: executionId(), agentId: name, configuredModel: agent?.model || input.model, fallbackModel: agent?.fallbackModel, activeModel: invocationFallbacks.get(id), lastFailure: lastFailures.get(id), budget: budgetFor(id), keys, mode: options.mode, availability: getModelAvailability(input.model) }));
      } else if (input.action === 'attempt') {
        const id = input.invocationId || input.agentId || options.agentId;
        const budget = budgetFor(id);
        const fallback = options.agents.find(a => a.name === (input.agentId || options.agentId))?.fallbackModel;
        const replay = pendingAttempts.get(input.requestId) === id;
        let allowed = replay || budget.remaining > 0;
        let nextModel: string | undefined, reason: string | undefined;
        // Reserve part of the existing allowance for the configured fallback. Failed
        // primary calls accumulate across tool turns; successes do not reset it.
        if (!replay && allowed && input.model && input.primaryModel && fallback && fallback !== input.primaryModel && input.model === input.primaryModel) {
          const primaryPending = [...pendingAttempts].filter(([request, owner]) => owner === id && pendingModels.get(request) === input.primaryModel).length;
          const primaryFailures = (modelFailures.get(id)?.get(input.primaryModel) || 0) + primaryPending;
          if (invocationFallbacks.get(id) === fallback || primaryFailures >= Math.ceil(invocationLimit / 2) || budget.remaining <= 1) {
            allowed = false; nextModel = fallback;
            reason = invocationFallbacks.get(id) === fallback ? 'FALLBACK_ACTIVE' : primaryFailures >= Math.ceil(invocationLimit / 2) ? 'PRIMARY_RETRY_LIMIT' : 'GLOBAL_BUDGET_RESERVED';
          }
        }
        if (allowed && input.requestId) {
          pendingAttempts.set(input.requestId, id); pendingModels.set(input.requestId, input.model);
          if (input.model === fallback && fallback !== input.primaryModel) invocationFallbacks.set(id, fallback);
        }
        res.end(JSON.stringify({ allowed, ...budget, nextModel, reason, lastFailure: lastFailures.get(id) }));
      } else if (input.action === 'acquire') {
        const id = `${input.model}:${input.keyId}`;
        const eligible = !getRankedKeys(input.model).length || getEligibleRankedKeys(input.model).some(key => key.keyId === input.keyId);
        const busy = leases.has(id) && leases.get(id) !== input.requestId;
        if (eligible && !busy) { leases.set(id, input.requestId); ownedLeases.add(input.requestId); }
        res.end(JSON.stringify({ acquired: eligible && !busy, eligible, busy }));
      } else if (input.action === 'release') {
        for (const requestId of input.attemptRequestIds || []) { pendingAttempts.delete(requestId); pendingModels.delete(requestId); }
        const id = `${input.model}:${input.keyId}`;
        if (leases.get(id) === input.requestId) leases.delete(id);
        ownedLeases.delete(input.requestId);
        res.end('{}');
      } else if (input.action === 'result') {
        if (input.requestId && completedResults.has(input.requestId)) {
          const previous = completedResults.get(input.requestId);
          if (previous.bridgeFailure) res.writeHead(500).end('{"error":"Runtime result commit failed","code":"GUI_RUNTIME_FAILURE"}');
          else res.end(JSON.stringify(previous));
          return;
        }
        let message = String(input.message || '');
        for (const key of [...Object.values(loadConfiguredKeys()), options.apiKey].filter(Boolean) as string[]) message = message.split(key).join('[REDACTED]');
        const classified = classifyKeyResult(input.success ? 200 : input.status, input.code, message);
        pendingAttempts.delete(input.requestId); pendingModels.delete(input.requestId);
        if (!input.success) {
          failures++; const id = input.invocationId || input.agentId || options.agentId;
          invocationFailures.set(id, (invocationFailures.get(id) || 0) + 1);
          const counts = modelFailures.get(id) || new Map<string, number>();
          counts.set(input.model, (counts.get(input.model) || 0) + 1); modelFailures.set(id, counts);
          lastFailures.set(id, { agentId: input.agentId, invocationId: input.invocationId, requestId: input.requestId, model: input.model, keyId: input.keyId, ...classified, httpStatus: input.status, message });
        }
        if (classified.affectsKey !== false && input.keyId && options.mode === 'api-key') recordRuntimeExecutionResult(input.model, input.keyId, { success: Boolean(input.success), httpStatus: input.status, errorText: message, latencyMs: input.latencyMs, endpoint: input.endpoint, apiVersion: input.apiVersion, executionId: executionId(), agentId: input.agentId, invocationId: input.invocationId, requestId: input.requestId });
        const result = { ...classified, httpStatus: input.status, message };
        if (input.requestId) {
          completedResults.set(input.requestId, result);
          if (completedResults.size > 512) completedResults.delete(completedResults.keys().next().value!);
        }
        res.end(JSON.stringify(result));
      } else if (input.action === 'classify') {
        res.end(JSON.stringify(classifyKeyResult(input.status, input.code, input.message)));
      } else { res.writeHead(400).end('{"error":"Unsupported runtime action","code":"GUI_RUNTIME_PROTOCOL"}'); }
    } catch {
      // An ambiguous result commit must never replay credential writes or failure counters.
      if (input?.action === 'result' && input.requestId && !completedResults.has(input.requestId)) completedResults.set(input.requestId, { bridgeFailure: true });
      event('RUNTIME_BRIDGE_ERROR', { bridgeAction: input?.action, bridgeRequestId: input?.bridgeRequestId, requestId: input?.requestId, agentId: input?.agentId || options.agentId, invocationId: input?.invocationId, model: input?.model, bridgeHttpStatus: 500, code: 'GUI_RUNTIME_FAILURE', affectsKey: false });
      if (!res.headersSent && !res.destroyed) res.writeHead(500).end('{"error":"Runtime bridge failure","code":"GUI_RUNTIME_FAILURE"}');
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address() as import('node:net').AddressInfo;
  event('RUNTIME_BRIDGE_READY', { protocolVersion: 1 });
  return { url: `http://127.0.0.1:${address.port}`, token, close: () => {
    if (closed) return;
    closed = true;
    for (const [id, request] of leases) if (ownedLeases.has(request)) leases.delete(id);
    ownedLeases.clear(); pendingAttempts.clear(); pendingModels.clear(); invocationFailures.clear(); modelFailures.clear(); invocationFallbacks.clear(); lastFailures.clear(); completedResults.clear();
    server.closeAllConnections(); server.close(); event('RUNTIME_BRIDGE_CLOSED');
  } };
}
