import { VoiceDirectorConfig } from './voiceTypes.js';

/**
 * Compiles visual deck knobs/sliders into a structured Gemini Director Prompt.
 * Adheres strictly to Rule #6 (No Fake REST API parameters: non-native REST settings
 * are compiled into a prompt directive that Gemini TTS understands natively).
 */
export function compileDirectorPrompt(config: VoiceDirectorConfig): string {
  const parts: string[] = [];

  parts.push(`[DIREÇÃO VOCAL DE ESTÚDIO DO NARRADOR GEMINI]`);

  // Idioma
  if (config.language) {
    parts.push(`- Idioma Principal: ${config.language}`);
  }

  // Estilo & Emoção
  if (config.style) {
    parts.push(`- Estilo Narrativo: ${config.style}`);
  }
  if (config.emotion && config.emotion !== 'Neutro') {
    parts.push(`- Estado Emocional: ${config.emotion}`);
  }

  // Tom, Ritmo & Expressividade
  if (config.tone) {
    parts.push(`- Tom/Atitude: ${config.tone}`);
  }
  if (config.rhythm) {
    parts.push(`- Cadência/Ritmo de Fala: ${config.rhythm}`);
  }
  if (config.expressiveness) {
    parts.push(`- Intensidade de Expressão Vocal: ${config.expressiveness}`);
  }

  // Sotaque e Pausas
  if (config.accent && !config.accent.includes('Neutro')) {
    parts.push(`- Sotaque/Sotaque Regional: ${config.accent}`);
  }
  if (config.pauseStyle) {
    parts.push(`- Dinâmica de Pausas: ${config.pauseStyle}`);
  }

  // Afinação (Pitch)
  if (config.pitch !== undefined && config.pitch !== 0) {
    const pitchLabel = config.pitch < 0 ? `Mais Grave (${config.pitch} semitons)` : `Mais Agudo (+${config.pitch} semitons)`;
    parts.push(`- Modulação de Altura (Pitch): ${pitchLabel}`);
  }

  // Velocidade de fala
  if (config.speed !== undefined && config.speed !== 1.0) {
    parts.push(`- Velocidade de Articulação: ${config.speed}x`);
  }

  // Multi-speaker config if enabled
  if (config.multiSpeakerConfig?.enabled) {
    parts.push(`- Configuração Multi-Voz/Diálogo: Ativa (${config.multiSpeakerConfig.speakerABName || 'Locutor 1 / Locutor 2'})`);
  }

  // Instruções customizadas adicionais
  if (config.customInstructions && config.customInstructions.trim()) {
    parts.push(`\n[ORIENTAÇÕES ESPECÍFICAS DE DIREÇÃO]:\n${config.customInstructions.trim()}`);
  }

  parts.push(
    `\nInstrução Absoluta de Áudio: Respeite rigorosamente as marcações de performance em colchetes como [pausa longa], [sussurrando], [risos], [sarcástico] presentes no texto.`
  );

  return parts.join('\n');
}

/**
 * Helper to insert a performance markup tag into text at a specified cursor position.
 */
export function injectMarkupTag(
  text: string,
  tag: string,
  selectionStart: number = text.length,
  selectionEnd: number = text.length
): { newText: string; newCursorPos: number } {
  const before = text.substring(0, selectionStart);
  const selected = text.substring(selectionStart, selectionEnd);
  const after = text.substring(selectionEnd);

  if (selected.length > 0) {
    // Wrap selection
    const newText = `${before}${tag} ${selected} ${after}`;
    return { newText, newCursorPos: selectionStart + tag.length + 1 + selected.length };
  } else {
    // Insert tag
    const newText = `${before}${tag} ${after}`;
    return { newText, newCursorPos: selectionStart + tag.length + 1 };
  }
}
