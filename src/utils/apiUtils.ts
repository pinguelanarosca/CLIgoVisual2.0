/**
 * Utility functions for robust, fail-safe API requests in Gemini CLI GUI.
 * Prevents "Unexpected token '<', '<!doctype '... is not valid JSON" errors
 * when endpoints are temporarily unavailable, returning HTML fallbacks, or encountering network issues.
 */

export async function fetchJsonSafely<T>(
  url: string,
  options?: RequestInit,
  fallback: T | null = null
): Promise<T | null> {
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      return fallback;
    }
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return fallback;
    }
    const data = await res.json();
    return data as T;
  } catch (err) {
    console.warn(`[API] Erro ao buscar ou decodificar JSON de ${url}:`, err);
    return fallback;
  }
}
