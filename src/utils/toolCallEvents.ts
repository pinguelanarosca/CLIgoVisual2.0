import type { ToolCallStep } from '../types';

/** Merge correlated activity events; raw/native duplicate terminals cannot reopen a tool. */
export function applyToolCallEvent(calls: Record<string, ToolCallStep>, type: string, event: any, now = Date.now()) {
  const id = event.tool_call_id || event.tool_id || event.callId || event.id;
  const identity = {
    componentExecutor: event.componentExecutor || event.executed_by || event.agentName || event.agentId,
    agentModel: event.model || event.subagentModel,
    requestId: event.requestId || event.lastRequestId || event.request_id,
    invocationId: event.invocationId,
    executionId: event.executionId,
    parentToolCallId: event.parentToolCallId,
    nativeToolCallId: event.nativeToolCallId,
  };
  if (type === 'tool_use' || type === 'tool_call') {
    const callId = id || `tool_${now}`;
    const previous = calls[callId];
    if (previous && ['completed', 'failed'].includes(previous.status)) return;
    const knownIdentity = Object.fromEntries(Object.entries(identity).filter(([, value]) => value !== undefined));
    calls[callId] = {
      ...previous, ...knownIdentity, id: callId,
      toolName: event.tool_name || event.name || event.tool || previous?.toolName || 'tool',
      parameters: event.parameters || event.args || previous?.parameters || {},
      status: 'running', timestamp: previous?.timestamp || event.timestamp || new Date(now).toISOString(),
      startedAt: previous?.startedAt ?? now, description: event.description || previous?.description,
      schema: event.schema || event.definition || previous?.schema,
      componentRegister: event.componentRegister || event.registered_by || previous?.componentRegister,
      origin: event.origin || event.source || previous?.origin,
      wrapperRelation: event.wrapperRelation || event.wrapper || previous?.wrapperRelation,
    };
    return;
  }
  if (type !== 'tool_result') return;
  let target = id ? calls[id] : undefined;
  if (!id) {
    const candidates = Object.values(calls).filter(call => call.status === 'running' &&
      (!identity.invocationId || call.invocationId === identity.invocationId) &&
      (!identity.componentExecutor || call.componentExecutor === identity.componentExecutor));
    if (candidates.length === 1) target = candidates[0];
  }
  if (!target || ['completed', 'failed'].includes(target.status)) return;
  Object.assign(target, Object.fromEntries(Object.entries(identity).filter(([, value]) => value !== undefined)));
  target.completedAt = now;
  if (target.startedAt !== undefined) target.durationMs = now - target.startedAt;
  const output = event.output ?? event.result ?? '';
  target.result = typeof output === 'string' ? output : JSON.stringify(output);
  target.status = event.error || ['failed', 'error', 'cancelled'].includes(event.status) ? 'failed' : 'completed';
  if (event.error) target.error = typeof event.error === 'string' ? event.error : JSON.stringify(event.error);
}
