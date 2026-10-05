import { ChatMessage } from '../types.js';
export function compactExecutionHistory(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(({ id, role, content, timestamp, toolCalls }) => ({ id, role, content, timestamp, ...(toolCalls?.length ? { toolCalls } : {}) }));
}
export function toExecutorContext(messages: ChatMessage[]): Array<{ role: string; content: string }> {
  return messages.map(message => ({ role: message.role, content: message.content + (message.toolCalls?.length ? `\n[RESULTADOS DAS FERRAMENTAS]\n${JSON.stringify(message.toolCalls.map(({ toolName, parameters, result, error, status }) => ({ toolName, parameters, result, error, status })))}` : '') }));
}
