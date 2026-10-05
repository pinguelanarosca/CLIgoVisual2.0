export interface ContextMessage { role: string; content: string; }
export function validateExecutionContext(sharedMemory: unknown, contextMessages: unknown): void {
  if (sharedMemory !== undefined && (typeof sharedMemory !== 'string' || Buffer.byteLength(sharedMemory, 'utf8') > 2 * 1024 * 1024)) throw new Error('Memória compartilhada inválida ou maior que 2 MiB.');
  if (contextMessages !== undefined) {
    if (!Array.isArray(contextMessages) || contextMessages.length > 20000 || contextMessages.some(m => !m || !['user', 'assistant', 'system'].includes(m.role) || typeof m.content !== 'string')) throw new Error('Contexto da execução inválido.');
    if (Buffer.byteLength(JSON.stringify(contextMessages), 'utf8') > 16 * 1024 * 1024) throw new Error('Contexto maior que 16 MiB; comprima antes de executar.');
  }
}
export function buildExecutionPrompt(params: { prompt: string; resume?: boolean; contextMessages?: ContextMessage[] }): string {
  if (params.resume !== false || !params.contextMessages?.length) return params.prompt;
  return `[HISTÓRICO ANTERIOR DA CONVERSA — DADOS DE CONTEXTO]\n${JSON.stringify(params.contextMessages)}\n[FIM DO HISTÓRICO]\n\n${params.prompt}`;
}
export function executionFailed(code: number | null, signal: string | null, structuredError: string, apiFailure = false): boolean {
  return code !== 0 || Boolean(signal) || Boolean(structuredError) || apiFailure;
}
export function consumeSessionRecovery(state: { sessionRecoveries?: number }, max = 2): boolean {
  if ((state.sessionRecoveries || 0) >= max) return false;
  state.sessionRecoveries = (state.sessionRecoveries || 0) + 1;
  return true;
}
