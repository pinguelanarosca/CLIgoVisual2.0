import { execSync, spawnSync, spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { GitAppStatus, GitCommitInfo, GitUpdateCheckResult, GitUpdateResult } from '../src/types.js';
import { sysLog } from './logger-service.js';

export const DEFAULT_GIT_REPO_URL = 'https://github.com/pinguelanarosca/CLIgoVisual';
export const DEFAULT_GIT_BRANCH = 'main';

function getGitVersion(): string | undefined {
  try {
    const out = execSync('git --version', { encoding: 'utf-8', timeout: 5000 });
    return out.trim();
  } catch {
    return undefined;
  }
}

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

export function getGitStatus(customRepoUrl?: string): GitAppStatus {
  const cwd = process.cwd();
  const gitVersion = getGitVersion();
  const gitAvailable = Boolean(gitVersion);
  const repoUrl = customRepoUrl || DEFAULT_GIT_REPO_URL;
  const branch = DEFAULT_GIT_BRANCH;

  if (!gitAvailable) {
    return {
      isGitRepo: false,
      repoUrl,
      branch,
      hasUncommittedChanges: false,
      uncommittedFilesCount: 0,
      gitAvailable: false,
    };
  }

  try {
    const isRepo = execSync('git rev-parse --is-inside-work-tree', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 4000,
    }).trim() === 'true';

    if (!isRepo) {
      return {
        isGitRepo: false,
        repoUrl,
        branch,
        hasUncommittedChanges: false,
        uncommittedFilesCount: 0,
        gitAvailable: true,
        gitVersion,
      };
    }

    let currentBranch = branch;
    try {
      currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 4000,
      }).trim();
    } catch {}

    let currentCommit = '';
    let currentCommitShort = '';
    try {
      currentCommit = execSync('git rev-parse HEAD', {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 4000,
      }).trim();
      currentCommitShort = currentCommit.substring(0, 7);
    } catch {}

    let commitMessage = '';
    let commitDate = '';
    try {
      commitMessage = execSync('git log -1 --pretty=format:"%s"', {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 4000,
      }).trim().replace(/^"|"$/g, '');

      commitDate = execSync('git log -1 --pretty=format:"%cd" --date=relative', {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 4000,
      }).trim().replace(/^"|"$/g, '');
    } catch {}

    let remoteUrl = '';
    try {
      remoteUrl = execSync('git config --get remote.origin.url', {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 4000,
      }).trim();
    } catch {}

    let uncommittedFilesCount = 0;
    try {
      const statusOutput = execSync('git status --porcelain', {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 4000,
      }).trim();
      if (statusOutput) {
        uncommittedFilesCount = statusOutput.split('\n').filter(Boolean).length;
      }
    } catch {}

    return {
      isGitRepo: true,
      repoUrl: remoteUrl || repoUrl,
      branch: currentBranch || branch,
      currentCommit,
      currentCommitShort,
      commitMessage,
      commitDate,
      hasUncommittedChanges: uncommittedFilesCount > 0,
      uncommittedFilesCount,
      remoteUrl: remoteUrl || undefined,
      gitAvailable: true,
      gitVersion,
    };
  } catch {
    return {
      isGitRepo: false,
      repoUrl,
      branch,
      hasUncommittedChanges: false,
      uncommittedFilesCount: 0,
      gitAvailable: true,
      gitVersion,
    };
  }
}

export async function checkRemoteGitUpdates(
  repoUrl: string = DEFAULT_GIT_REPO_URL,
  branch: string = DEFAULT_GIT_BRANCH
): Promise<GitUpdateCheckResult> {
  const currentStatus = getGitStatus(repoUrl);
  const cleanRepoUrl = repoUrl.trim() || DEFAULT_GIT_REPO_URL;
  const targetBranch = branch.trim() || DEFAULT_GIT_BRANCH;

  let remoteCommit = '';
  let remoteCommitShort = '';
  let remoteCommitInfo: GitCommitInfo | undefined;

  // 1. Query remote commit hash via git ls-remote
  try {
    const lsOutput = execSync(`git ls-remote "${cleanRepoUrl}" refs/heads/${targetBranch} HEAD`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    }).trim();

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

export function scheduleServerRestart(delayMs: number = 1500) {
  sysLog.warn('SYSTEM', `Reinício programado do processo do servidor em ${delayMs}ms...`);
  setTimeout(() => {
    sysLog.info('SYSTEM', 'Iniciando processo de reinício automático...');
    try {
      const execPath = process.execPath;
      const nodeArgs = [...process.execArgv, ...process.argv.slice(1)];
      const cwd = process.cwd();
      const env = { ...process.env };

      // Script gerenciador temporário desvinculado (detached)
      // Aguarda 1.2s para garantir que o processo pai encerre e libere a porta 3000,
      // e em seguida spawna a nova instância do servidor.
      const inlineScript = `
        setTimeout(() => {
          const { spawn } = require('child_process');
          const child = spawn(${JSON.stringify(execPath)}, ${JSON.stringify(nodeArgs)}, {
            cwd: ${JSON.stringify(cwd)},
            detached: true,
            stdio: 'inherit',
            env: process.env
          });
          child.unref();
        }, 1200);
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

    // Encerra o processo atual liberando a porta 3000
    process.exit(0);
  }, delayMs);
}

export function performRebuild(): { success: boolean; message: string; logs: string[]; error?: string } {
  const cwd = process.cwd();
  const logs: string[] = [];

  sysLog.info('SYSTEM', 'Iniciando recompilação do projeto (npm run build)...');
  logs.push('⚙️ [Build] Executando npm run build...');

  try {
    const res = spawnSync('npm run build', {
      cwd,
      shell: true,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120000,
    });

    if (res.stdout && res.stdout.trim()) {
      logs.push(`📤 stdout: ${res.stdout.trim()}`);
    }
    if (res.stderr && res.stderr.trim()) {
      logs.push(`⚠️ stderr: ${res.stderr.trim()}`);
    }

    if (res.status !== 0 && res.status !== null) {
      const err = res.stderr || res.stdout || 'Falha ao executar npm run build';
      sysLog.error('SYSTEM', `Falha ao recompilar aplicação: ${err}`);
      return {
        success: false,
        message: `Falha na compilação: ${err}`,
        logs,
        error: err,
      };
    }

    sysLog.success('SYSTEM', 'Aplicação recompilada com sucesso (dist/ atualizado).');
    logs.push('✅ Compilação concluída com sucesso!');
    return {
      success: true,
      message: 'Aplicação recompilada com sucesso!',
      logs,
    };
  } catch (err: any) {
    sysLog.error('SYSTEM', `Erro ao recompilar aplicação: ${err.message}`);
    return {
      success: false,
      message: `Erro na compilação: ${err.message}`,
      logs: [...logs, `❌ Erro: ${err.message}`],
      error: err.message,
    };
  }
}

export function performGitUpdate(
  optionsOrRepoUrl: PerformGitUpdateOptions | string = DEFAULT_GIT_REPO_URL,
  maybeBranch: string = DEFAULT_GIT_BRANCH,
  maybeForceSync: boolean = false
): GitUpdateResult {
  let options: PerformGitUpdateOptions;
  if (typeof optionsOrRepoUrl === 'string') {
    options = {
      repoUrl: optionsOrRepoUrl,
      branch: maybeBranch,
      forceSync: maybeForceSync,
      installDependencies: true,
      runBuild: true,
      restartServer: false,
    };
  } else {
    options = {
      installDependencies: true,
      runBuild: true,
      restartServer: false,
      ...optionsOrRepoUrl,
    };
  }

  const cwd = process.cwd();
  const cleanRepoUrl = (options.repoUrl || '').trim() || DEFAULT_GIT_REPO_URL;
  const targetBranch = (options.branch || '').trim() || DEFAULT_GIT_BRANCH;
  const forceSync = Boolean(options.forceSync);
  const shouldInstallDeps = options.installDependencies !== false;
  const shouldBuild = options.runBuild !== false;
  const shouldRestart = Boolean(options.restartServer);
  const logs: string[] = [];

  const runCmd = (cmd: string, description: string, timeoutMs: number = 60000) => {
    logs.push(`⚙️ [${description}] Executando: ${cmd}`);
    const res = spawnSync(cmd, {
      cwd,
      shell: true,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });
    if (res.stdout && res.stdout.trim()) {
      logs.push(`📤 stdout: ${res.stdout.trim()}`);
    }
    if (res.stderr && res.stderr.trim()) {
      logs.push(`⚠️ stderr: ${res.stderr.trim()}`);
    }
    if (res.status !== 0 && res.status !== null) {
      throw new Error(`Erro na etapa "${description}": ${res.stderr || res.stdout || 'Falha no comando'}`);
    }
    return res.stdout ? res.stdout.trim() : '';
  };

  try {
    const status = getGitStatus(cleanRepoUrl);

    // 1. Etapa Git: Fetch & Merge/Reset
    if (!status.isGitRepo) {
      runCmd('git init', '1/4 Inicializar repositório Git local');
      runCmd(`git remote add origin "${cleanRepoUrl}" || git remote set-url origin "${cleanRepoUrl}"`, '1/4 Configurar Remote Origin');
      runCmd(`git fetch origin ${targetBranch}`, '1/4 Buscar ramos remotos');
      
      try {
        runCmd(`git checkout -B ${targetBranch} origin/${targetBranch}`, '1/4 Checkout do branch remoto');
      } catch {
        runCmd(`git reset --hard origin/${targetBranch}`, '1/4 Reset para branch remota');
      }
    } else {
      runCmd(`git remote set-url origin "${cleanRepoUrl}" || git remote add origin "${cleanRepoUrl}"`, '1/4 Atualizar URL do Remote Origin');
      runCmd(`git fetch origin ${targetBranch}`, '1/4 Buscar atualizações remotas');

      if (forceSync) {
        runCmd(`git reset --hard origin/${targetBranch}`, '1/4 Sincronização forçada com o remoto');
      } else {
        try {
          runCmd(`git merge origin/${targetBranch} -m "Merge update from ${cleanRepoUrl}"`, '1/4 Mesclar atualizações');
        } catch {
          logs.push(`⚠️ Conflito no merge detectado. Aplicando sincronização limpa do branch ${targetBranch}...`);
          runCmd(`git reset --hard origin/${targetBranch}`, '1/4 Reset forçado para versão mais recente');
        }
      }
    }

    // Check new commit
    let newCommit = '';
    try {
      newCommit = execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8' }).trim();
    } catch {}

    logs.push(`✅ [1/4] Código fonte sincronizado com sucesso (Commit ${newCommit ? newCommit.substring(0, 7) : 'recente'})!`);

    // 2. Etapa NPM Install: Se solicitado
    let installedDeps = false;
    if (shouldInstallDeps) {
      try {
        logs.push('📦 [2/4] Atualizando dependências (npm install)...');
        runCmd('npm install --prefer-offline --no-audit', '2/4 Instalação de dependências npm', 120000);
        installedDeps = true;
        logs.push('✅ [2/4] Dependências npm verificadas/atualizadas com sucesso!');
      } catch (depErr: any) {
        logs.push(`⚠️ [2/4] Aviso ao rodar npm install: ${depErr.message}. Prosseguindo com o build...`);
      }
    }

    // 3. Etapa Build: Recompilar Vite e backend bundle
    let rebuilt = false;
    if (shouldBuild) {
      try {
        logs.push('🛠️ [3/4] Recompilando frontend e backend (npm run build)...');
        runCmd('npm run build', '3/4 Compilação do projeto', 120000);
        rebuilt = true;
        logs.push('✅ [3/4] Projeto recompilado com sucesso (dist/ atualizado)!');
      } catch (buildErr: any) {
        logs.push(`❌ [3/4] Falha ao recompilar projeto: ${buildErr.message}`);
        throw buildErr;
      }
    }

    // 4. Etapa Reinício: Se solicitado
    if (shouldRestart) {
      logs.push('🔄 [4/4] Reinício do servidor agendado em 1.5s...');
      scheduleServerRestart(1500);
    }

    const summaryMsg = `Aplicação atualizada com sucesso para o commit ${newCommit ? newCommit.substring(0, 7) : 'recente'}!${
      shouldRestart ? ' O servidor está reiniciando agora.' : ''
    }`;

    sysLog.success('GIT', summaryMsg, {
      repoUrl: cleanRepoUrl,
      branch: targetBranch,
      commit: newCommit ? newCommit.substring(0, 7) : undefined,
      rebuilt,
      installedDeps,
      restarting: shouldRestart,
    });

    return {
      success: true,
      message: summaryMsg,
      updatedCommit: newCommit,
      logs,
      requiresRestart: !shouldRestart,
      restarting: shouldRestart,
      rebuilt,
      installedDeps,
    };
  } catch (err: any) {
    logs.push(`❌ Erro no processo de atualização: ${err.message}`);
    sysLog.error('GIT', `Erro ao atualizar aplicação via Git: ${err.message}`, { repoUrl: cleanRepoUrl, branch: targetBranch });
    return {
      success: false,
      message: `Falha ao atualizar a aplicação via Git: ${err.message}`,
      logs,
      error: err.message,
    };
  }
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
