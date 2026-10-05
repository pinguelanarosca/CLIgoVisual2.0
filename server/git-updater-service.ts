import { spawn } from 'node:child_process';
import { runProcess } from './process-service.js';
import path from 'node:path';
import fs from 'node:fs';
import { GitAppStatus, GitCommitInfo, GitUpdateCheckResult, GitUpdateResult } from '../src/types.js';
import { sysLog } from './logger-service.js';

export const DEFAULT_GIT_REPO_URL = 'https://github.com/pinguelanarosca/CLIgoVisual2.0';
export const DEFAULT_GIT_BRANCH = 'main';

function parseGithubRepo(repoUrl: string): { owner: string; repo: string } | null {
  try {
    const cleanUrl = repoUrl.trim().replace(/\.git$/, '');
    const match = cleanUrl.match(/github\.com[/:]([\w.-]+)\/([\w.-]+)/);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
    return null;
  } catch {
    return null;
  }
}

export async function getGitStatus(customRepoUrl?: string): Promise<GitAppStatus> {
  const cwd = process.cwd();
  const repoUrl = customRepoUrl || DEFAULT_GIT_REPO_URL;
  const base: GitAppStatus = { isGitRepo: false, repoUrl, branch: DEFAULT_GIT_BRANCH, hasUncommittedChanges: false, uncommittedFilesCount: 0, gitAvailable: false };
  try { base.gitVersion = (await runProcess('git', ['--version'], cwd, 5000)).trim(); base.gitAvailable = true; } catch { return base; }
  try {
    if ((await runProcess('git', ['rev-parse', '--is-inside-work-tree'], cwd, 4000)).trim() !== 'true') return base;
    base.isGitRepo = true;
    const [branch, commit, message, date, status] = await Promise.all([
      runProcess('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd, 4000),
      runProcess('git', ['rev-parse', 'HEAD'], cwd, 4000),
      runProcess('git', ['log', '-1', '--format=%s'], cwd, 4000),
      runProcess('git', ['log', '-1', '--format=%cd', '--date=relative'], cwd, 4000),
      runProcess('git', ['status', '--porcelain'], cwd, 4000),
    ]);
    base.branch = branch.trim(); base.currentCommit = commit.trim(); base.currentCommitShort = commit.trim().slice(0, 7);
    base.commitMessage = message.trim(); base.commitDate = date.trim();
    base.uncommittedFilesCount = status.split('\n').filter(Boolean).length;
    base.hasUncommittedChanges = base.uncommittedFilesCount > 0;
    try { base.remoteUrl = (await runProcess('git', ['remote', 'get-url', 'origin'], cwd, 4000)).trim(); base.repoUrl = base.remoteUrl || repoUrl; } catch {}
    return base;
  } catch (error) { if (base.isGitRepo) throw error; return base; }
}

export async function checkRemoteGitUpdates(
  repoUrl: string = DEFAULT_GIT_REPO_URL,
  branch: string = DEFAULT_GIT_BRANCH
): Promise<GitUpdateCheckResult> {
  const currentStatus = await getGitStatus(repoUrl);
  const cleanRepoUrl = repoUrl.trim() || DEFAULT_GIT_REPO_URL;
  const targetBranch = branch.trim() || DEFAULT_GIT_BRANCH;

  let remoteCommit = '';
  let remoteCommitShort = '';
  let remoteCommitInfo: GitCommitInfo | undefined;

  // 1. Query remote commit hash via git ls-remote
  try {
    const lsOutput = (await runProcess('git', ['ls-remote', cleanRepoUrl, `refs/heads/${targetBranch}`, 'HEAD'], process.cwd(), 10000)).trim();

    const lines = lsOutput.split('\n');
    let foundSpecific = false;
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        if (parts[1] === `refs/heads/${targetBranch}`) {
          remoteCommit = parts[0];
          remoteCommitShort = remoteCommit.substring(0, 7);
          foundSpecific = true;
          break;
        }
      }
    }

    if (!foundSpecific) {
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          if (parts[1] === 'HEAD') {
            remoteCommit = parts[0];
            remoteCommitShort = remoteCommit.substring(0, 7);
            break;
          }
        }
      }
    }
  } catch (err: any) {
    // If git ls-remote fails, we will try GitHub API fallback below
  }

  // 2. Query GitHub public API if it's a GitHub URL for rich commit info
  const ghRepo = parseGithubRepo(cleanRepoUrl);
  if (ghRepo) {
    try {
      const res = await fetch(`https://api.github.com/repos/${ghRepo.owner}/${ghRepo.repo}/commits/${targetBranch}`, {
        headers: {
          'User-Agent': 'Gemini-GUI-GitUpdater',
          Accept: 'application/vnd.github.v3+json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const data = await res.json();
        if (data && data.sha) {
          if (!remoteCommit) {
            remoteCommit = data.sha;
            remoteCommitShort = data.sha.substring(0, 7);
          }
          remoteCommitInfo = {
            sha: data.sha,
            shortSha: data.sha.substring(0, 7),
            message: data.commit?.message?.split('\n')[0] || 'Atualização recente',
            author: data.commit?.author?.name || data.author?.login || 'pinguelanarosca',
            date: data.commit?.author?.date ? new Date(data.commit.author.date).toLocaleString('pt-BR') : '',
            url: data.html_url,
          };
        }
      }
    } catch {}
  }

  if (!remoteCommit) {
    sysLog.warn('GIT', `Falha ao consultar repositório Git remoto: ${cleanRepoUrl} (${targetBranch})`);
    return {
      hasUpdate: false,
      branch: targetBranch,
      repoUrl: cleanRepoUrl,
      message: 'Não foi possível consultar o repositório remoto informado. Verifique a URL do Git.',
      error: 'Falha na conexão com o repositório Git remoto.',
    };
  }

  const localCommit = currentStatus.currentCommit;
  const hasUpdate = Boolean(localCommit && remoteCommit && localCommit !== remoteCommit) || !currentStatus.isGitRepo;

  let message = '';
  if (!currentStatus.isGitRepo) {
    message = `Repositório remoto encontrado (${remoteCommitShort}). O diretório local pode ser sincronizado com o Git.`;
  } else if (hasUpdate) {
    message = `Nova versão disponível no repositório (${remoteCommitShort}). Commit local: ${currentStatus.currentCommitShort || 'N/D'}.`;
  } else {
    message = `A aplicação já está atualizada com o commit mais recente (${remoteCommitShort}) da branch ${targetBranch}.`;
  }

  sysLog.info('GIT', `Verificação de updates Git: ${message}`, { remoteCommit: remoteCommitShort, branch: targetBranch });

  return {
    hasUpdate,
    localCommit: currentStatus.currentCommit,
    remoteCommit,
    remoteCommitShort,
    remoteCommitInfo,
    branch: targetBranch,
    repoUrl: cleanRepoUrl,
    message,
  };
}

export interface PerformGitUpdateOptions {
  repoUrl?: string;
  branch?: string;
  forceSync?: boolean;
  installDependencies?: boolean;
  runBuild?: boolean;
  restartServer?: boolean;
}

let activeServerInstance: any = null;

export function registerActiveServer(server: any) {
  activeServerInstance = server;
}

export function scheduleServerRestart(delayMs: number = 1500) {
  sysLog.warn('SYSTEM', `Reinício programado do processo do servidor em ${delayMs}ms...`);
  setTimeout(() => {
    sysLog.info('SYSTEM', 'Iniciando processo de reinício automático...');
    
    // Se estiver rodando sob gerenciador de processos (PM2), fechar e sair é suficiente
    const isUnderPm2 = process.env.pm_id !== undefined || process.env.PM2_HOME !== undefined;

    try {
      if (activeServerInstance && typeof activeServerInstance.close === 'function') {
        activeServerInstance.close();
      }
    } catch {}

    if (!isUnderPm2) {
      try {
        const execPath = process.execPath;
        const nodeArgs = [...process.execArgv, ...process.argv.slice(1)];
        const cwd = process.cwd();
        const env = { ...process.env };

        // Script launcher inteligente: aguarda a porta 3000 ser liberada antes de iniciar
        const inlineScript = `
          const { spawn } = require('child_process');
          const net = require('net');

          function tryStartServer(retriesLeft) {
            const socket = new net.Socket();
            socket.once('error', () => {
              // Porta liberada! Spawna o servidor.
              socket.destroy();
              const child = spawn(${JSON.stringify(execPath)}, ${JSON.stringify(nodeArgs)}, {
                cwd: ${JSON.stringify(cwd)},
                detached: true,
                stdio: 'inherit',
                env: process.env
              });
              child.unref();
            });
            socket.once('connect', () => {
              // Porta ainda ocupada, tenta novamente em 400ms
              socket.destroy();
              if (retriesLeft > 0) {
                setTimeout(() => tryStartServer(retriesLeft - 1), 400);
              } else {
                const child = spawn(${JSON.stringify(execPath)}, ${JSON.stringify(nodeArgs)}, {
                  cwd: ${JSON.stringify(cwd)},
                  detached: true,
                  stdio: 'inherit',
                  env: process.env
                });
                child.unref();
              }
            });
            socket.connect(3000, '127.0.0.1');
          }

          setTimeout(() => tryStartServer(25), 800);
        `;

        const launcher = spawn(execPath, ['-e', inlineScript], {
          cwd,
          detached: true,
          stdio: 'ignore',
          env,
        });
        launcher.unref();
      } catch (err: any) {
        sysLog.error('SYSTEM', `Erro ao agendar processo de reinício: ${err.message}`);
      }
    }

    // Encerra o processo atual liberando o SO
    process.exit(0);
  }, delayMs);
}

let maintenanceRunning = false;
export async function performRebuild(): Promise<{ success: boolean; message: string; logs: string[]; error?: string }> {
  if (maintenanceRunning) return { success: false, message: 'Outra atualização/compilação está em andamento.', logs: [] };
  maintenanceRunning = true;
  const logs = ['⚙️ [Build] Executando npm run build...'];
  try {
    const output = await runProcess('npm', ['run', 'build'], process.cwd(), 120000, text => logs.push(`⚠️ stderr: ${text}`));
    if (output.trim()) logs.push(`📤 stdout: ${output.trim()}`);
    sysLog.success('SYSTEM', 'Aplicação recompilada com sucesso.');
    return { success: true, message: 'Aplicação recompilada com sucesso!', logs };
  } catch (error: any) {
    if (error.stdout) logs.push(`📤 stdout: ${error.stdout}`);
    if (error.stderr) logs.push(`⚠️ stderr: ${error.stderr}`);
    sysLog.error('SYSTEM', `Falha na compilação: ${error.message}`);
    return { success: false, message: `Falha na compilação: ${error.message}`, error: error.message, logs };
  } finally { maintenanceRunning = false; }
}

export async function performGitUpdate(
  optionsOrRepoUrl: PerformGitUpdateOptions | string = DEFAULT_GIT_REPO_URL,
  maybeBranch = DEFAULT_GIT_BRANCH,
  maybeForceSync = false
): Promise<GitUpdateResult> {
  const options = typeof optionsOrRepoUrl === 'string' ? { repoUrl: optionsOrRepoUrl, branch: maybeBranch, forceSync: maybeForceSync } : optionsOrRepoUrl;
  const logs: string[] = [];
  if (maintenanceRunning) return { success: false, message: 'Outra atualização/compilação está em andamento.', logs };
  maintenanceRunning = true;
  const cwd = process.cwd(), repoUrl = options.repoUrl || DEFAULT_GIT_REPO_URL, branch = options.branch || DEFAULT_GIT_BRANCH;
  const run = async (command: string, args: string[], description: string, timeout = 60000) => {
    logs.push(`⚙️ [${description}] Executando: ${command} ${args.join(' ')}`);
    try {
      const out = await runProcess(command, args, cwd, timeout, text => logs.push(`⚠️ stderr: ${text}`));
      if (out.trim()) logs.push(`📤 stdout: ${out.trim()}`);
      return out.trim();
    } catch (error: any) {
      if (error.stdout) logs.push(`📤 stdout: ${error.stdout}`);
      if (error.stderr) logs.push(`⚠️ stderr: ${error.stderr}`);
      throw error;
    }
  };
  try {
    await run('git', ['check-ref-format', '--branch', branch], 'Validar branch');
    const status = await getGitStatus(repoUrl);
    if (!status.isGitRepo) throw new Error('O diretório não contém um repositório Git válido. Atualização interrompida para preservar arquivos existentes.');
    if (!options.forceSync && status.hasUncommittedChanges) throw new Error('Existem alterações locais. Atualização interrompida; preserve/commit seu trabalho ou escolha descarte explícito.');
    await run('git', ['fetch', repoUrl, branch], '1/4 Buscar atualizações');
    if (options.forceSync) await run('git', ['reset', '--hard', 'FETCH_HEAD'], '1/4 Descarte explicitamente solicitado');
    else await run('git', ['merge', '--ff-only', 'FETCH_HEAD'], '1/4 Atualizar sem conflitos');
    const updatedCommit = await run('git', ['rev-parse', 'HEAD'], 'Verificar commit');
    logs.push(`✅ [1/4] Código sincronizado (${updatedCommit.slice(0, 7)}).`);
    let installedDeps = false, rebuilt = false;
    if (options.installDependencies !== false) {
      await run('npm', ['install', '--prefer-offline', '--no-audit'], '2/4 Dependências', 120000); installedDeps = true;
    }
    if (options.runBuild !== false) {
      await run('npm', ['run', 'build'], '3/4 Compilação', 120000); rebuilt = true;
    }
    if (options.restartServer) { logs.push('🔄 [4/4] Reinício agendado.'); scheduleServerRestart(1500); }
    const message = `Aplicação atualizada para ${updatedCommit.slice(0, 7)}.`;
    sysLog.success('GIT', message, { installedDeps, rebuilt });
    return { success: true, message, logs, updatedCommit, installedDeps, rebuilt, requiresRestart: !options.restartServer, restarting: Boolean(options.restartServer) };
  } catch (error: any) {
    logs.push(`❌ Atualização interrompida: ${error.message}`);
    sysLog.error('GIT', error.message);
    return { success: false, message: error.message, error: error.message, logs };
  } finally { maintenanceRunning = false; }
}

export function generateManualUpdateCommands(
  repoUrl: string = DEFAULT_GIT_REPO_URL,
  branch: string = DEFAULT_GIT_BRANCH
): string {
  return [
    '# Atualização rápida manual no Ubuntu / Linux:',
    'git fetch origin ' + branch,
    'git pull origin ' + branch,
    'npm install',
    'npm run build',
  ].join('\n');
}
