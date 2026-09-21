import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/**
 * Retorna o diretório de dados gravável por usuário para a GUI do Gemini CLI.
 * Padrão: ~/.local/share/gemini-gui/
 */
export function getGuiDataDir(): string {
  const dataDir = process.env.GEMINI_GUI_DATA_DIR || path.join(os.homedir(), '.local', 'share', 'gemini-gui');
  if (!fs.existsSync(dataDir)) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch {
      // Ignorar caso haja restrição temporária
    }
  }
  return dataDir;
}

/**
 * Retorna o diretório .gemini/ dentro do diretório de dados do usuário.
 * Padrão: ~/.local/share/gemini-gui/.gemini/
 */
export function getGuiGeminiDir(): string {
  const geminiDir = path.join(getGuiDataDir(), '.gemini');
  if (!fs.existsSync(geminiDir)) {
    try {
      fs.mkdirSync(geminiDir, { recursive: true });
    } catch {
      // Ignorar caso haja restrição temporária
    }
  }
  return geminiDir;
}

/**
 * Resolve o diretório base para operações. Se targetDir não for fornecido,
 * utiliza o diretório de dados do usuário (~/.local/share/gemini-gui).
 */
export function getDefaultWorkspaceDir(customDir?: string): string {
  if (customDir && customDir.trim()) {
    return path.resolve(customDir.trim());
  }
  return getGuiDataDir();
}
