import { execSync } from 'node:child_process';

let hasDiscovered = false;

export function discoverApiKeyFromLoginEnv(): void {
  if (hasDiscovered) return;
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY) {
    hasDiscovered = true;
    return;
  }

  const targetUser = process.env.SUDO_USER || '';
  const isSudo = targetUser && targetUser !== 'root';

  const commands = [
    // 1. Bash de login
    isSudo
      ? `sudo -u ${targetUser} bash -l -c 'echo -n "$GEMINI_API_KEY:$GOOGLE_GENAI_API_KEY"'`
      : `bash -l -c 'echo -n "$GEMINI_API_KEY:$GOOGLE_GENAI_API_KEY"'`,
    // 2. Bash com source do bashrc do usuário
    isSudo
      ? `sudo -u ${targetUser} bash -c 'source ~/.bashrc 2>/dev/null; echo -n "$GEMINI_API_KEY:$GOOGLE_GENAI_API_KEY"'`
      : `bash -c 'source ~/.bashrc 2>/dev/null; echo -n "$GEMINI_API_KEY:$GOOGLE_GENAI_API_KEY"'`,
    // 3. Zsh de login do usuário
    isSudo
      ? `sudo -u ${targetUser} zsh -l -c 'echo -n "$GEMINI_API_KEY:$GOOGLE_GENAI_API_KEY"'`
      : `zsh -l -c 'echo -n "$GEMINI_API_KEY:$GOOGLE_GENAI_API_KEY"'`
  ];

  for (const cmd of commands) {
    try {
      const output = execSync(cmd, { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (output && output !== ':') {
        const parts = output.split(':');
        const geminiKey = parts[0]?.trim();
        const genaiKey = parts[1]?.trim();
        if (geminiKey) {
          process.env.GEMINI_API_KEY = geminiKey;
          console.log('[SYSTEM] GEMINI_API_KEY descoberta com sucesso no ambiente de login do usuário.');
          hasDiscovered = true;
          break;
        }
        if (genaiKey) {
          process.env.GOOGLE_GENAI_API_KEY = genaiKey;
          console.log('[SYSTEM] GOOGLE_GENAI_API_KEY descoberta com sucesso no ambiente de login do usuário.');
          hasDiscovered = true;
          break;
        }
      }
    } catch {
      // ignore shell or execution errors
    }
  }
}
