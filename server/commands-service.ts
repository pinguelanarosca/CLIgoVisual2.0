import fs from 'node:fs';
import path from 'node:path';
import { CommandConfig } from '../src/types.js';
import { getGuiDataDir } from './paths-service.js';

const DEFAULT_COMMANDS: CommandConfig[] = [
  {
    name: '/debug',
    description: 'Atalho operacional para investigar falha, reproduzir erro e isolar a causa raiz.',
    promptTemplate: `Executar rotina /debug:
1. Reproduzir o erro indicado e coletar logs de erro.
2. Isolar causa raiz com evidências de código.
3. Propor correção mínima direcionada sem efeitos colaterais.`,
    enabled: true,
    statusGrade: 'CONFIGURED',
  },
  {
    name: '/test',
    description: 'Atalho operacional para executar a suíte de testes e analisar resultados.',
    promptTemplate: `Executar rotina /test:
1. Localizar suíte de testes relevante para as alterações recentes.
2. Executar testes no ambiente real.
3. Apresentar relatório sucinto com taxa de sucesso, falhas e evidências concretas.`,
    enabled: true,
    statusGrade: 'CONFIGURED',
  },
  {
    name: '/review',
    description: 'Atalho operacional para revisão de código de diffs recentes e conformidade de segurança.',
    promptTemplate: `Executar rotina /review:
1. Inspecionar as alterações em git diff ou arquivos modificados.
2. Avaliar consistência com as convenções do projeto, segurança e regressões.
3. Listar achados priorizados por criticidade.`,
    enabled: true,
    statusGrade: 'CONFIGURED',
  },
  {
    name: '/implement',
    description: 'Atalho operacional para implementar requisito respeitando a arquitetura existente.',
    promptTemplate: `Executar rotina /implement:
1. Compreender o requisito solicitado e inspecionar código adjacente.
2. Implementar a solução mantendo estilo e padrões do projeto.
3. Validar se a compilação/execução permanece íntegra.`,
    enabled: true,
    statusGrade: 'CONFIGURED',
  },
  {
    name: '/fix',
    description: 'Atalho operacional para aplicar correção de defeito específico.',
    promptTemplate: `Executar rotina /fix:
1. Analisar a falha apontada.
2. Aplicar correção estrita da causa identificada.
3. Validar a correção via testes ou checagem sintática/funcional.`,
    enabled: true,
    statusGrade: 'CONFIGURED',
  },
  {
    name: '/git:commit',
    description: 'inspecionar alterações → validar testes relevantes → preparar commit → não realizar commit com falhas não resolvidas ou alterações não validadas.',
    promptTemplate: `Executar rotina /git:commit:
1. Inspecionar alterações ativas (git status / diff).
2. Validar testes relevantes e compilação do projeto.
3. Se houver falhas não resolvidas ou alterações não validadas, abortar e reportar os problemas.
4. Caso tudo esteja validado, preparar mensagem de commit semântica e objetiva refletindo as mudanças reais.`,
    enabled: true,
    statusGrade: 'CONFIGURED',
  },
];

export function getCommandsDirectory(customDir?: string): string {
  const base = customDir || getGuiDataDir();
  return path.join(base, '.gemini', 'commands');
}

export function ensureCommandsSeeded(targetDir?: string): CommandConfig[] {
  const commandsDir = getCommandsDirectory(targetDir);
  if (!fs.existsSync(commandsDir)) {
    fs.mkdirSync(commandsDir, { recursive: true });
  }

  const existing = loadCommands(targetDir);
  if (existing.length === 0) {
    for (const cmd of DEFAULT_COMMANDS) {
      saveCommandToFile(cmd, targetDir);
    }
    return DEFAULT_COMMANDS;
  }
  return existing;
}

export function loadCommands(targetDir?: string): CommandConfig[] {
  const commandsDir = getCommandsDirectory(targetDir);
  if (!fs.existsSync(commandsDir)) {
    return [];
  }

  const files = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.toml') || f.endsWith('.json'));
  const list: CommandConfig[] = [];

  for (const file of files) {
    const filePath = path.join(commandsDir, file);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (file.endsWith('.json')) {
        const parsed = JSON.parse(raw);
        list.push(parsed);
      } else {
        // TOML format: prompt = """...""" or description = "..."
        const promptMatch = raw.match(/prompt\s*=\s*"""([\s\S]*?)"""/);
        const descMatch = raw.match(/description\s*=\s*"([^"]+)"/);
        const nameClean = '/' + file.replace(/\.toml$/, '').replace(/__/g, ':');
        list.push({
          name: nameClean,
          description: descMatch ? descMatch[1] : nameClean,
          promptTemplate: promptMatch ? promptMatch[1].trim() : raw.trim(),
          enabled: true,
          statusGrade: 'CONFIGURED',
        });
      }
    } catch {
      // Continue
    }
  }

  return list.length > 0 ? list : DEFAULT_COMMANDS;
}

export function saveCommandToFile(command: CommandConfig, targetDir?: string) {
  const commandsDir = getCommandsDirectory(targetDir);
  if (!fs.existsSync(commandsDir)) {
    fs.mkdirSync(commandsDir, { recursive: true });
  }

  // Sanitize filename (e.g. /git:commit -> git__commit.toml)
  const safeName = command.name.replace(/^\//, '').replace(/:/g, '__');
  const filePath = path.join(commandsDir, `${safeName}.toml`);

  const tomlContent = [
    `description = "${command.description.replace(/"/g, '\\"')}"`,
    `enabled = ${command.enabled}`,
    'prompt = """',
    command.promptTemplate,
    '"""',
  ].join('\n');

  fs.writeFileSync(filePath, tomlContent, 'utf8');
}

export function deleteCommand(commandName: string, targetDir?: string): boolean {
  const safeName = commandName.replace(/^\//, '').replace(/:/g, '__');
  const filePath = path.join(getCommandsDirectory(targetDir), `${safeName}.toml`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

export function resetDefaultCommands(targetDir?: string): CommandConfig[] {
  const commandsDir = getCommandsDirectory(targetDir);
  if (fs.existsSync(commandsDir)) {
    fs.rmSync(commandsDir, { recursive: true, force: true });
  }
  fs.mkdirSync(commandsDir, { recursive: true });
  for (const cmd of DEFAULT_COMMANDS) {
    saveCommandToFile(cmd, targetDir);
  }
  return DEFAULT_COMMANDS;
}

export function overwriteCommands(commands: CommandConfig[], targetDir?: string): void {
  const commandsDir = getCommandsDirectory(targetDir);
  if (fs.existsSync(commandsDir)) {
    fs.rmSync(commandsDir, { recursive: true, force: true });
  }
  fs.mkdirSync(commandsDir, { recursive: true });
  for (const cmd of commands) {
    saveCommandToFile(cmd, targetDir);
  }
}
