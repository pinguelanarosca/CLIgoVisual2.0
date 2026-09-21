import React, { useState, useEffect, useRef } from 'react';
import {
  GitBranch,
  GitPullRequest,
  GitCommit,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Download,
  Terminal,
  ExternalLink,
  Copy,
  Clock,
  ArrowUpCircle,
  Check,
  RotateCcw,
  Hammer,
  Sparkles,
  Layers,
  Power,
  Server,
  Loader2,
} from 'lucide-react';
import {
  GitAppStatus,
  GitUpdateCheckResult,
  GitUpdateResult,
  SystemRebuildResult,
} from '../types';

interface GitUpdaterViewProps {
  onRefreshGlobalStatus?: () => void;
}

export const GitUpdaterView: React.FC<GitUpdaterViewProps> = ({ onRefreshGlobalStatus }) => {
  const [repoUrl, setRepoUrl] = useState('https://github.com/pinguelanarosca/CLIgoVisual2.0');
  const [branch, setBranch] = useState('main');
  const [gitStatus, setGitStatus] = useState<GitAppStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);

  // Update check
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateCheckResult, setUpdateCheckResult] = useState<GitUpdateCheckResult | null>(null);

  // Pull & Pipeline state
  const [isPullingUpdate, setIsPullingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<GitUpdateResult | null>(null);

  // Manual Rebuild state
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [rebuildResult, setRebuildResult] = useState<SystemRebuildResult | null>(null);

  // Restart state & Auto-reconnect polling
  const [isRestarting, setIsRestarting] = useState(false);
  const [reconnectCountdown, setReconnectCountdown] = useState<number | null>(null);
  const [isServerBackOnline, setIsServerBackOnline] = useState(false);

  // Pipeline options
  const [installDeps, setInstallDeps] = useState(true);
  const [runBuild, setRunBuild] = useState(true);
  const [autoRestart, setAutoRestart] = useState(true);
  const [forceSync, setForceSync] = useState(false);

  // Copy helper
  const [copiedManual, setCopiedManual] = useState(false);

  const pollIntervalRef = useRef<any>(null);

  const safeJson = async (res: Response): Promise<any> => {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return {
        success: res.ok,
        message: text.startsWith('<') ? 'O servidor retornou uma página ou resposta HTML (possível reinício de serviço ou timeout).' : text,
        logs: [text],
      };
    }
  };

  const loadStatus = async () => {
    setIsLoadingStatus(true);
    try {
      const res = await fetch(`/api/git/status?repoUrl=${encodeURIComponent(repoUrl)}`);
      if (res.ok) {
        const data = await safeJson(res);
        if (data && typeof data === 'object' && !data.error) {
          setGitStatus(data);
          if (data.remoteUrl && !repoUrl) {
            setRepoUrl(data.remoteUrl);
          }
          if (data.branch && !branch) {
            setBranch(data.branch);
          }
        }
      }
    } catch (err) {
      console.error('Falha ao obter status do Git', err);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  useEffect(() => {
    loadStatus();
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // Poll server health after restart to auto reload page
  const startHealthPolling = (initialDelaySec = 3) => {
    setIsRestarting(true);
    setIsServerBackOnline(false);
    setReconnectCountdown(initialDelaySec);

    let count = initialDelaySec;
    const countTimer = setInterval(() => {
      count -= 1;
      setReconnectCountdown(count > 0 ? count : 0);
      if (count <= 0) {
        clearInterval(countTimer);
        // Start pinging /api/health
        pollIntervalRef.current = setInterval(async () => {
          try {
            const res = await fetch('/api/health', { cache: 'no-store' });
            if (res.ok) {
              clearInterval(pollIntervalRef.current);
              setIsServerBackOnline(true);
              setTimeout(() => {
                window.location.reload();
              }, 1200);
            }
          } catch {
            // Still rebooting
          }
        }, 1500);
      }
    }, 1000);
  };

  const handleCheckUpdates = async () => {
    setIsCheckingUpdate(true);
    setUpdateCheckResult(null);
    setUpdateResult(null);
    setRebuildResult(null);
    try {
      const res = await fetch('/api/git/check-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: repoUrl.trim(), branch: branch.trim() }),
      });
      const data = await safeJson(res);
      setUpdateCheckResult(data);
    } catch (err: any) {
      setUpdateCheckResult({
        hasUpdate: false,
        branch,
        repoUrl,
        message: err.message || 'Erro ao consultar atualizações remotas',
        error: err.message,
      });
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handlePerformUpdate = async () => {
    setIsPullingUpdate(true);
    setUpdateResult(null);
    setRebuildResult(null);
    try {
      const res = await fetch('/api/git/pull-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoUrl: repoUrl.trim(),
          branch: branch.trim(),
          forceSync,
          installDependencies: installDeps,
          runBuild,
          restartServer: autoRestart,
        }),
      });
      const data = await safeJson(res);
      setUpdateResult(data);

      if (data.success) {
        await loadStatus();
        if (onRefreshGlobalStatus) {
          onRefreshGlobalStatus();
        }
        if (data.restarting || autoRestart) {
          startHealthPolling(4);
        }
      } else {
        const isRebooting = autoRestart || runBuild;
        if (isRebooting && !res.ok) {
          setUpdateResult({
            success: true,
            message: 'A atualização foi iniciada e o servidor está reiniciando em segundo plano.',
            logs: [`Processo de atualização finalizado. Reinicialização iniciada...`],
          });
          startHealthPolling(4);
        }
      }
    } catch (err: any) {
      setUpdateResult({
        success: false,
        message: err.message || 'Erro ao aplicar atualização do Git',
        logs: [`❌ Erro inesperado: ${err.message}`],
        error: err.message,
      });
    } finally {
      setIsPullingUpdate(false);
    }
  };

  const handleRebuild = async () => {
    setIsRebuilding(true);
    setRebuildResult(null);
    try {
      const res = await fetch('/api/system/rebuild', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await safeJson(res);
      setRebuildResult(data);
    } catch (err: any) {
      setRebuildResult({
        success: false,
        message: err.message || 'Erro ao executar recompilação',
        logs: [`❌ Falha de rede: ${err.message}`],
        error: err.message,
      });
    } finally {
      setIsRebuilding(false);
    }
  };

  const handleRestartServer = async () => {
    if (!window.confirm('Deseja realmente reiniciar o serviço da aplicação agora?')) {
      return;
    }
    try {
      await fetch('/api/system/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delayMs: 1000 }),
      });
      startHealthPolling(3);
    } catch (err) {
      // If server dies immediately, still start polling
      startHealthPolling(3);
    }
  };

  const manualCommands = `# 1. Navegar até a pasta da aplicação no Ubuntu:
cd /opt/gemini-gui || cd ~/CLIgoVisual2.0 || cd ~/gemini-cli-gui

# 2. Sincronizar o código com o repositório remoto:
git fetch origin ${branch || 'main'}
git reset --hard origin/${branch || 'main'}

# 3. Atualizar dependências e recompilar a aplicação:
npm install
npm run build

# 4. Reiniciar o serviço ou processo (se usar PM2 / Systemd / Node):
npm start
# Ou: pm2 restart gemini-gui || sudo systemctl restart gemini-gui`;

  const copyManualCmds = () => {
    navigator.clipboard.writeText(manualCommands);
    setCopiedManual(true);
    setTimeout(() => setCopiedManual(false), 2500);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
          <GitPullRequest className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <span>Atualização & Manutenção do Aplicativo (Git / Build / Restart)</span>
        </h4>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
          Sincronize commits do repositório oficial, instale novas dependências npm, recompile os arquivos de distribuição e reinicie o serviço com reconexão automática.
        </p>
      </div>

      {/* Restarting / Auto-reconnection Banner */}
      {isRestarting && (
        <div className="p-4 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 shadow-sm flex items-center justify-between gap-3 animate-pulse">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-amber-600 dark:text-amber-400 animate-spin shrink-0" />
            <div>
              <p className="text-xs font-semibold">
                {isServerBackOnline
                  ? '✅ Servidor reiniciado e online! Recarregando a página...'
                  : reconnectCountdown !== null && reconnectCountdown > 0
                  ? `🔄 Reiniciando servidor em segundo plano... Conectando em ${reconnectCountdown}s`
                  : '🔍 Verificando disponibilidade do servidor...'}
              </p>
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
                A aplicação será atualizada no navegador automaticamente assim que o serviço responder.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition cursor-pointer shadow-xs shrink-0"
          >
            Forçar Recarregamento
          </button>
        </div>
      )}

      {/* Repository & Branch Configuration Card */}
      <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/90 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h5 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
            <GitBranch className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>Repositório Git e Ramo Alvo</span>
          </h5>
          <a
            href={repoUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
          >
            <span>Abrir no GitHub</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-3 space-y-1">
            <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
              URL do Repositório Git / GitHub
            </label>
            <input
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/pinguelanarosca/CLIgoVisual2.0"
              className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500 transition"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
              Branch / Ramo
            </label>
            <input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="Update"
              className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500 transition"
            />
          </div>
        </div>

        {/* Pipeline Options Checkboxes */}
        <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/80 dark:border-zinc-700/80 space-y-2">
          <div className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>Opções do Pipeline de Atualização Automática:</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={installDeps}
                onChange={(e) => setInstallDeps(e.target.checked)}
                className="rounded text-blue-600"
              />
              <span>📦 Executar <code className="font-mono text-[10px] bg-zinc-200/80 dark:bg-zinc-700 px-1 rounded">npm install</code> (atualizar pacotes)</span>
            </label>

            <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={runBuild}
                onChange={(e) => setRunBuild(e.target.checked)}
                className="rounded text-blue-600"
              />
              <span>🛠️ Recompilar projeto (<code className="font-mono text-[10px] bg-zinc-200/80 dark:bg-zinc-700 px-1 rounded">npm run build</code>)</span>
            </label>

            <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRestart}
                onChange={(e) => setAutoRestart(e.target.checked)}
                className="rounded text-blue-600"
              />
              <span>🔄 Reiniciar servidor e recarregar página ao finalizar</span>
            </label>

            <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={forceSync}
                onChange={(e) => setForceSync(e.target.checked)}
                className="rounded text-blue-600"
              />
              <span>⚡ Reset forçado (ignorar conflitos locais)</span>
            </label>
          </div>
        </div>

        {/* Action Buttons: Check, Full Update, Rebuild, Restart */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleCheckUpdates}
            disabled={isCheckingUpdate || !repoUrl.trim()}
            className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white transition flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
            <span>{isCheckingUpdate ? 'Consultando...' : 'Verificar Atualizações'}</span>
          </button>

          <button
            type="button"
            onClick={handlePerformUpdate}
            disabled={isPullingUpdate || !repoUrl.trim()}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white transition flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Download className={`w-3.5 h-3.5 ${isPullingUpdate ? 'animate-bounce' : ''}`} />
            <span>{isPullingUpdate ? 'Atualizando Aplicação...' : 'Atualizar Aplicação Agora'}</span>
          </button>

          <button
            type="button"
            onClick={handleRebuild}
            disabled={isRebuilding}
            title="Recompilar assets de produção e servidor"
            className="px-3 py-2 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
          >
            <Hammer className={`w-3.5 h-3.5 ${isRebuilding ? 'animate-spin text-amber-500' : ''}`} />
            <span>{isRebuilding ? 'Recompilando...' : 'Recompilar (Build)'}</span>
          </button>

          <button
            type="button"
            onClick={handleRestartServer}
            disabled={isRestarting}
            title="Reiniciar processo do servidor Node"
            className="px-3 py-2 text-xs font-medium rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 hover:bg-amber-100/70 text-amber-800 dark:text-amber-300 transition flex items-center gap-1.5 shadow-xs cursor-pointer ml-auto"
          >
            <Power className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            <span>Reiniciar Servidor</span>
          </button>
        </div>
      </div>

      {/* Current Local Environment Status */}
      <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 space-y-2.5 text-xs">
        <div className="flex justify-between items-center pb-1 border-b border-zinc-200/60 dark:border-zinc-700/60">
          <span className="font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
            <GitCommit className="w-3.5 h-3.5 text-zinc-500" />
            <span>Estado Atual do Ambiente Local</span>
          </span>
          <button
            onClick={loadStatus}
            disabled={isLoadingStatus}
            title="Recarregar status do Git"
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition cursor-pointer"
          >
            <RefreshCw className={`w-3 h-3 ${isLoadingStatus ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          <div className="flex justify-between items-center">
            <span className="text-zinc-500">Repositório Git:</span>
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {gitStatus?.isGitRepo ? (
                <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Inicializado & Ativo
                </span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> Standalone (Pronto p/ Sync)
                </span>
              )}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-zinc-500">Branch Local:</span>
            <span className="font-mono text-[11px] font-semibold text-zinc-800 dark:text-zinc-200">
              {gitStatus?.branch || branch}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-zinc-500">Commit Local Atual:</span>
            <span className="font-mono text-[11px] text-zinc-800 dark:text-zinc-200 font-bold">
              {gitStatus?.currentCommitShort || 'Versão Inicial'}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-zinc-500">Modificações locais:</span>
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {gitStatus?.hasUncommittedChanges ? (
                <span className="text-amber-600 dark:text-amber-400">
                  {gitStatus.uncommittedFilesCount} arquivos alterados
                </span>
              ) : (
                <span className="text-emerald-600 dark:text-emerald-400">Diretório limpo</span>
              )}
            </span>
          </div>
        </div>

        {gitStatus?.commitMessage && (
          <div className="pt-1 text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-zinc-400 shrink-0" />
            <span className="truncate">
              Último commit local: <em>"{gitStatus.commitMessage}"</em> ({gitStatus.commitDate})
            </span>
          </div>
        )}
      </div>

      {/* Check Result Banner */}
      {updateCheckResult && (
        <div
          className={`p-4 rounded-xl border text-xs space-y-2.5 ${
            updateCheckResult.error
              ? 'bg-rose-50/70 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/50 text-rose-800 dark:text-rose-300'
              : updateCheckResult.hasUpdate
              ? 'bg-blue-50/70 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/50 text-blue-800 dark:text-blue-300'
              : 'bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {updateCheckResult.error ? (
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
            ) : updateCheckResult.hasUpdate ? (
              <ArrowUpCircle className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400" />
            ) : (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            )}
            <span className="font-semibold">{updateCheckResult.message}</span>
          </div>

          {updateCheckResult.remoteCommitInfo && (
            <div className="p-3 rounded-lg bg-white/80 dark:bg-zinc-900/80 border border-zinc-200/60 dark:border-zinc-800 space-y-1.5 text-zinc-800 dark:text-zinc-200">
              <div className="flex justify-between items-center text-[11px]">
                <span className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1">
                  <GitCommit className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                  Commit Remoto: {updateCheckResult.remoteCommitInfo.shortSha}
                </span>
                <span className="text-zinc-500 dark:text-zinc-400">
                  {updateCheckResult.remoteCommitInfo.date}
                </span>
              </div>
              <p className="text-xs font-mono bg-zinc-50 dark:bg-zinc-800 p-2 rounded border border-zinc-200/50 dark:border-zinc-700/50">
                {updateCheckResult.remoteCommitInfo.message}
              </p>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Autor: <span className="font-medium text-zinc-700 dark:text-zinc-300">{updateCheckResult.remoteCommitInfo.author}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pull / Update Result Output Box */}
      {updateResult && (
        <div
          className={`p-4 rounded-xl border text-xs space-y-3 ${
            updateResult.success
              ? 'bg-emerald-50/80 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800'
              : 'bg-rose-50/80 dark:bg-rose-950/20 border-rose-300 dark:border-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {updateResult.success ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            )}
            <span
              className={`font-semibold ${
                updateResult.success ? 'text-emerald-900 dark:text-emerald-200' : 'text-rose-900 dark:text-rose-200'
              }`}
            >
              {updateResult.message}
            </span>
          </div>

          {/* Execution steps badge row */}
          {updateResult.success && (
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700">
                1. Git Sync Concluído
              </span>
              {updateResult.installedDeps && (
                <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700">
                  2. Dependências NPM Atualizadas
                </span>
              )}
              {updateResult.rebuilt && (
                <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700">
                  3. Recompilação (Build) Concluída
                </span>
              )}
              {updateResult.restarting && (
                <span className="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-700 animate-pulse">
                  4. Reinício do Servidor em Andamento...
                </span>
              )}
            </div>
          )}

          {/* Logs container */}
          {updateResult.logs && updateResult.logs.length > 0 && (
            <div className="space-y-1">
              <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 block">
                Relatório de Execução Completo:
              </span>
              <div className="p-3 rounded-lg bg-zinc-900 text-zinc-200 font-mono text-[11px] max-h-56 overflow-y-auto space-y-1 border border-zinc-800 select-text">
                {updateResult.logs.map((log, idx) => (
                  <div key={idx} className="leading-relaxed">
                    {log}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Rebuild Result Output Box */}
      {rebuildResult && (
        <div
          className={`p-4 rounded-xl border text-xs space-y-2.5 ${
            rebuildResult.success
              ? 'bg-emerald-50/80 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800'
              : 'bg-rose-50/80 dark:bg-rose-950/20 border-rose-300 dark:border-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {rebuildResult.success ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            )}
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              {rebuildResult.message}
            </span>
          </div>

          {rebuildResult.logs && (
            <div className="p-3 rounded-lg bg-zinc-900 text-zinc-200 font-mono text-[11px] max-h-40 overflow-y-auto space-y-1 border border-zinc-800 select-text">
              {rebuildResult.logs.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Manual Terminal Commands for Ubuntu */}
      <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/90 shadow-xs space-y-2.5">
        <div className="flex items-center justify-between">
          <h5 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5 text-zinc-600 dark:text-zinc-400" />
            <span>Execução Manual no Terminal (Ubuntu / Linux)</span>
          </h5>
          <button
            type="button"
            onClick={copyManualCmds}
            className="text-[11px] flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
          >
            {copiedManual ? (
              <>
                <Check className="w-3 h-3 text-emerald-600" />
                <span>Copiado!</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Copiar Comandos</span>
              </>
            )}
          </button>
        </div>

        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
          Se você preferir executar o ciclo de atualização manualmente via SSH / Terminal no seu servidor Ubuntu:
        </p>

        <div className="p-3 rounded-lg bg-zinc-900 text-zinc-200 font-mono text-[11px] overflow-x-auto space-y-1 select-all">
          <p className="text-zinc-500"># 1. Sincronizar código do repositório:</p>
          <p className="text-blue-400">git fetch origin {branch || 'Update'} && git reset --hard origin/{branch || 'Update'}</p>
          <p className="text-zinc-500 pt-1"># 2. Instalar dependências e compilar frontend/backend:</p>
          <p className="text-emerald-400">npm install && npm run build</p>
          <p className="text-zinc-500 pt-1"># 3. Reiniciar a aplicação:</p>
          <p className="text-amber-400">npm start</p>
        </div>
      </div>
    </div>
  );
};
