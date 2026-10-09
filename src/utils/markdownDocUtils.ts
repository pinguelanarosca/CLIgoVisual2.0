/**
 * Utilitários para detecção e formatação de textos extensos como documentos Markdown (.md)
 */

export const LONG_TEXT_THRESHOLD_CHARS = 10000;
export const LONG_TEXT_THRESHOLD_WORDS = 1200;

/**
 * Verifica se um texto é considerado extenso para ser colapsado em um card de documento .md
 */
export function isLongMarkdownText(text: string | undefined | null): boolean {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  return trimmed.length >= LONG_TEXT_THRESHOLD_CHARS || words >= LONG_TEXT_THRESHOLD_WORDS;
}

/**
 * Extrai um título legível e amigável para o documento a partir do conteúdo
 */
export function extractDocumentTitle(text: string, defaultTitle = 'documento_resposta.md'): string {
  if (!text) return defaultTitle;
  const lines = text.trim().split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Cabeçalhos Markdown (# Título, ## Subtítulo)
    if (line.startsWith('#')) {
      const cleanHeader = line.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim();
      if (cleanHeader.length > 2 && cleanHeader.length < 80) {
        return sanitizeFileName(cleanHeader) + '.md';
      }
    }

    // Linha com negrito inicial (**Título**)
    if (line.startsWith('**') && line.includes('**')) {
      const boldMatch = line.match(/^\*\*([^*]+)\*\*/);
      if (boldMatch && boldMatch[1].trim().length > 2) {
        return sanitizeFileName(boldMatch[1].trim()) + '.md';
      }
    }

    // Linha normal inicial que pareça um título
    if (line.length > 3 && line.length < 60 && !line.startsWith('-') && !line.startsWith('```')) {
      return sanitizeFileName(line) + '.md';
    }
  }

  return defaultTitle;
}

function sanitizeFileName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 45);
}

/**
 * Calcula estatísticas do documento Markdown
 */
export function getMarkdownStats(text: string) {
  if (!text) return { chars: 0, words: 0, lines: 0, kb: '0 KB', readTimeMin: 1 };
  const chars = text.length;
  const lines = text.split('\n').length;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const kb = (chars / 1024).toFixed(1) + ' KB';
  const readTimeMin = Math.max(1, Math.ceil(words / 180));

  return { chars, words, lines, kb, readTimeMin };
}
