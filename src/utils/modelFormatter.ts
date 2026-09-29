/**
 * Utility to format raw model identifier strings into user-friendly UI display titles.
 *
 * Examples:
 *  - "gemini-3.5-flash-lite" -> "Gemini 3.5 Flash LITE"
 *  - "gemini-3.1-flash-lite" -> "Gemini 3.1 Flash LITE"
 *  - "gemini-2.5-flash"      -> "Gemini 2.5 Flash"
 *  - "gemini-2.5-pro"        -> "Gemini 2.5 Pro"
 *  - "gemma-4-31b"           -> "Gemma 4 (31B)"
 *  - "gemini-1.5-pro"        -> "Gemini 1.5 Pro"
 */
export function formatModelName(modelRaw?: string | null): string {
  if (!modelRaw || typeof modelRaw !== 'string') {
    return 'Gemini 3.5 Flash LITE';
  }

  const trimmed = modelRaw.trim().toLowerCase();

  // Explicit mappings for known models
  const MAPPINGS: Record<string, string> = {
    'gemini-3.5-flash-lite': 'Gemini 3.5 Flash LITE',
    'gemini-3.1-flash-lite': 'Gemini 3.1 Flash LITE',
    'gemini-3.5-flash': 'Gemini 3.5 Flash',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'gemini-2.0-flash-exp': 'Gemini 2.0 Flash EXP',
    'gemini-1.5-pro': 'Gemini 1.5 Pro',
    'gemini-1.5-flash': 'Gemini 1.5 Flash',
    'gemma-4-31b': 'Gemma 4 (31B)',
    'gemma-4-31b-it': 'Gemma 4 (31B)',
    'gemma-2-27b-it': 'Gemma 2 (27B)',
    'gemma-2-9b-it': 'Gemma 2 (9B)',
  };

  if (MAPPINGS[trimmed]) {
    return MAPPINGS[trimmed];
  }

  // Generic fallback formatter for any model string (e.g. "my-custom-model-v1")
  return trimmed
    .replace(/_/g, '-')
    .split('-')
    .map((word) => {
      if (word === 'gemini') return 'Gemini';
      if (word === 'gemma') return 'Gemma';
      if (word === 'flash') return 'Flash';
      if (word === 'pro') return 'Pro';
      if (word === 'lite') return 'LITE';
      if (word === 'exp') return 'EXP';
      if (/^\d+b$/i.test(word)) return `(${word.toUpperCase()})`;
      if (word.length <= 3 && !/^\d+$/.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}
