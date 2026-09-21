/**
 * Unifica e constrói o prompt de sistema efetivo com preservação estrita da arquitetura:
 * - Modo padrão (overrideBasePrompt = false): baseInstructions + systemInstructions (override).
 *   Se apenas uma existir, retorna a existente sem duplicar.
 *   Se forem idênticas ou uma contiver a outra, elimina duplicação na origem.
 * - Modo "Sobrescrever base" (overrideBasePrompt = true): somente systemInstructions (override).
 */
export function buildEffectiveSystemPrompt(
  baseInstructions?: string,
  systemInstructions?: string,
  overrideBasePrompt = false
): string {
  const base = (baseInstructions || '').trim();
  const override = (systemInstructions || '').trim();

  // 1. Modo "Sobrescrever base": apenas override
  if (overrideBasePrompt) {
    return override;
  }

  // 2. Se apenas um estiver preenchido, retornar o preenchido sem duplicar
  if (!base) return override;
  if (!override) return base;

  // 3. Se ambos forem idênticos, retornar uma única cópia
  if (base === override) return base;

  // 4. Se uma das strings já contiver a outra integralmente, evitar duplicação redundante
  if (override.includes(base)) return override;
  if (base.includes(override)) return base;

  // 5. Padrão arquitetural: base + override
  return `${base}\n\n${override}`;
}
