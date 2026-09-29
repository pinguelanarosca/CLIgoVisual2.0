/**
 * env-discovery.ts - Desativado para injeção global de credenciais.
 * 
 * O Key Pool (~/.config/gemini-gui/api-keys.env) é a ÚNICA fonte oficial de credenciais Gemini.
 * É estritamente proibido auto-descobrir ou manter credenciais globais no process.env.
 */

export function discoverApiKeyFromLoginEnv(_forceRefresh = false): void {
  // No-op intencional: A autenticação é 100% gerenciada pelo Key Pool (K1..K9).
}
