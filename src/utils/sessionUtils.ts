import { SessionItem } from '../types.js';

/**
 * Retorna a sessão válida mais recente a partir de uma lista de sessões.
 * Filtra identificadores inválidos/nulos e IDs explicitamente excluídos (ex: sessões inexistentes ou corrompidas).
 * Prioriza sessões ativas (não arquivadas), ordenadas decrescentemente por data de atualização (ou criação).
 */
export function getMostRecentValidSession(
  sessionList: SessionItem[] | null | undefined,
  invalidSessionId?: string | null
): SessionItem | null {
  if (!Array.isArray(sessionList) || sessionList.length === 0) {
    return null;
  }

  // Filtrar sessões inválidas, corrompidas ou o ID explicitamente inválido
  const validCandidates = sessionList.filter((s) => {
    if (!s || typeof s !== 'object') return false;
    if (!s.id || typeof s.id !== 'string' || !s.id.trim()) return false;
    if (invalidSessionId && s.id === invalidSessionId) return false;
    return true;
  });

  if (validCandidates.length === 0) {
    return null;
  }

  // Priorizar sessões ativas (não arquivadas)
  const activeCandidates = validCandidates.filter((s) => s.isArchived !== true);
  const pool = activeCandidates.length > 0 ? activeCandidates : validCandidates;

  // Ordenar decrescente por updatedAt (fallback: createdAt, ou 0)
  return (
    [...pool].sort((a, b) => {
      const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
      const validTimeA = isNaN(timeA) ? 0 : timeA;
      const validTimeB = isNaN(timeB) ? 0 : timeB;
      return validTimeB - validTimeA;
    })[0] || null
  );
}

/**
 * Valida se um identificador de sessão existe na lista e não está arquivado.
 */
export function isValidSessionId(
  sessionId: string | null | undefined,
  sessionList: SessionItem[] | null | undefined
): boolean {
  if (!sessionId || typeof sessionId !== 'string' || !sessionId.trim()) {
    return false;
  }
  if (!Array.isArray(sessionList) || sessionList.length === 0) {
    return false;
  }
  return sessionList.some((s) => s && s.id === sessionId && s.isArchived !== true);
}
