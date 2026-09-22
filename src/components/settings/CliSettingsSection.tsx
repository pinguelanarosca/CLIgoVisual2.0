import React, { useState } from 'react';
import { Sparkles, RefreshCw, CheckCircle2, AlertCircle, GitPullRequest } from 'lucide-react';
import { CliStatus } from '../../types.js';
import { fetchJsonSafely } from '../../utils/apiUtils.js';

interface CliSettingsSectionProps {
  cliStatus: CliStatus | null;
  approvalMode: 'default' | 'auto_edit' | 'yolo' | 'plan';
  onChangeApprovalMode: (mode: 'default' | 'auto_edit' | 'yolo' | 'plan') => void;
  onRefreshStatus?: () => void;
  onNavigateToTab: (tab: string) => void;
}

export const CliSettingsSection: React.FC<CliSettingsSectionProps> = ({
  cliStatus,
  approvalMode,
  onChangeApprovalMode,
  onRefreshStatus,
  onNavigateToTab,
}) => {
  const [isValidatingApi, setIsValidatingApi] = useState(false);
  const [apiValidationResult, setApiValidationResult] = useState<{
    success: boolean;
    message: string;
    latencyMs?: number;
    modelTested?: string;
  } | null>(null);

  const handleSelectCliPath = async (selectedPath: string) => {
    try {
      const res = await fetch('/api/cli/config-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliPath: selectedPath }),
      });
      if (res.ok) {
        if (onRefreshStatus) onRefreshStatus();
      }
    } catch (err) {
      console.error('Falha ao definir caminho do CLI:', err);
    }
  };

  const handleTestApiConnection = async () => {
    setIsValidatingApi(true);
    setApiValidationResult(null);
    try {
      const data = await fetchJsonSafely<{
        success: boolean;
        message: string;
        latencyMs?: number;
        modelTested?: string;
      }>('/api/cli/validate-key', { method: 'POST' });

      if (data) {
        setApiValidationResult(data);
      } else {
        setApiValidationResult({
          success: false,
          message: 'Falha ao obter resposta válida da validação da API.',
        });
      }
      if (onRefreshStatus) onRefreshStatus();
    } catch (err: any) {
      setApiValidationResult({
        success: false,
        message: `Erro na requisição HTTP com o servidor local: ${err.message || err}`,
      });
    } finally {
      setIsValidatingApi(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Status e Integração do Gemini CLI
        </h4>
        <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
          A aplicação executa o binário oficial do Gemini CLI como motor de execução nativo.
        </p>
      </div>

      <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 space-y-3 text-xs">
        <div className="flex justify-between items-center pb-2 border-b border-zinc-200/60 dark:border-zinc-700/50">
          <span className="font-semibold text-zinc-800 dark:text-zinc-200">Executável Ativo em Uso:</span>
          <span className="font-mono font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800">
            {cliStatus?.cliPath || 'Auto'} ({cliStatus?.version ? `v${cliStatus.version}` : 'Detectando...'})
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          <div className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 space-y-1">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">1. CLI Local do Projeto</span>
              <span className="font-mono text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                {cliStatus?.localVersion ? `v${cliStatus.localVersion}` : 'Não detectado'}
              </span>
            </div>
            <p className="font-mono text-[10px] text-zinc-500 truncate" title={cliStatus?.localCliPath || 'node_modules/.bin/gemini'}>
              {cliStatus?.localCliPath || 'node_modules/.bin/gemini'}
            </p>
            {cliStatus?.localCliPath && (
              <button
                type="button"
                onClick={() => handleSelectCliPath(cliStatus.localCliPath!)}
                disabled={cliStatus.cliPath === cliStatus.localCliPath}
                className="mt-1 text-[10px] px-2 py-0.5 rounded font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-blue-600 hover:text-white dark:hover:bg-blue-600 transition disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
              >
                {cliStatus.cliPath === cliStatus.localCliPath ? '✓ Usando Este' : 'Ativar CLI Local'}
              </button>
            )}
          </div>

          <div className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 space-y-1">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">2. CLI Global do Sistema</span>
              <span className="font-mono text-[11px] font-bold text-blue-600 dark:text-blue-400">
                {cliStatus?.globalVersion ? `v${cliStatus.globalVersion}` : 'Não detectado'}
              </span>
            </div>
            <p className="font-mono text-[10px] text-zinc-500 truncate" title={cliStatus?.globalCliPath || 'gemini (PATH)'}>
              {cliStatus?.globalCliPath || 'gemini (PATH)'}
            </p>
            {cliStatus?.globalCliPath && (
              <button
                type="button"
                onClick={() => handleSelectCliPath(cliStatus.globalCliPath!)}
                disabled={cliStatus.cliPath === cliStatus.globalCliPath || cliStatus.cliPath === 'gemini'}
                className="mt-1 text-[10px] px-2 py-0.5 rounded font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-blue-600 hover:text-white dark:hover:bg-blue-600 transition disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
              >
                {cliStatus.cliPath === cliStatus.globalCliPath || cliStatus.cliPath === 'gemini' ? '✓ Usando Este' : 'Ativar CLI Global'}
              </button>
            )}
          </div>
        </div>

        <div className="flex justify-between items-center pt-1">
          <span className="text-zinc-500">Estado da Conexão CLI:</span>
          {cliStatus?.available && cliStatus?.connectionState === 'connected' ? (
            <span className="flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-4 h-4" /> Conectado e Operacional
            </span>
          ) : (
            <span className="flex items-center gap-1.5 font-semibold text-rose-600 dark:text-rose-400">
              <AlertCircle className="w-4 h-4" /> {cliStatus?.errorMessage || 'Indisponível'}
            </span>
          )}
        </div>
        <div className="flex justify-between items-center">
          <span className="text-zinc-500">Autenticação (Ambiente):</span>
          {cliStatus?.authConfigured ? (
            cliStatus.apiValid ? (
              <span className="flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-4 h-4" /> GEMINI_API_KEY Validada {cliStatus.latencyMs !== undefined ? `(${cliStatus.latencyMs}ms)` : ''}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 font-semibold text-amber-600 dark:text-amber-400">
                <AlertCircle className="w-4 h-4" /> Chave Configurada (Aviso na API)
              </span>
            )
          ) : (
            <span className="flex items-center gap-1.5 font-semibold text-rose-600 dark:text-rose-400">
              <AlertCircle className="w-4 h-4" /> Chave Ausente no Ambiente
            </span>
          )}
        </div>
      </div>

      <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/90 shadow-xs space-y-3.5">
        <div className="flex items-center justify-between">
          <div>
            <h5 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>GEMINI_API_KEY (Variável de Ambiente)</span>
              {cliStatus?.authConfigured && (
                <span className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded font-medium">
                  {cliStatus.apiValid ? 'Validada & Ativa' : 'Detectada no Ambiente'}
                </span>
              )}
            </h5>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
              A autenticação com o Google Gemini é carregada automaticamente a partir das variáveis de ambiente seguras do sistema.
            </p>
          </div>
        </div>

        <div className="bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded-lg border border-zinc-200/80 dark:border-zinc-700/60 space-y-2 text-xs">
          <div className="flex justify-between items-center">
            <span className="text-zinc-500 dark:text-zinc-400">Origem da Credencial:</span>
            <span className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300 font-semibold">
              process.env.GEMINI_API_KEY
            </span>
          </div>
          {cliStatus?.maskedApiKey && (
            <div className="flex justify-between items-center">
              <span className="text-zinc-500 dark:text-zinc-400">Chave Lida:</span>
              <span className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300 font-semibold bg-zinc-200/50 dark:bg-zinc-900/50 px-1.5 py-0.5 rounded">
                {cliStatus.maskedApiKey}
              </span>
            </div>
          )}
          <div className="flex justify-between items-center">
            <span className="text-zinc-500 dark:text-zinc-400">Status Operacional:</span>
            <span className="font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              {cliStatus?.authConfigured ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {cliStatus.apiValid ? 'Verificada e Operacional' : 'Configurada no Servidor'}
                </>
              ) : (
                <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Defina GEMINI_API_KEY no ambiente
                </span>
              )}
            </span>
          </div>
          {cliStatus?.modelTested && (
            <div className="flex justify-between items-center">
              <span className="text-zinc-500 dark:text-zinc-400">Modelo Testado:</span>
              <span className="font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
                {cliStatus.modelTested}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleTestApiConnection}
            disabled={isValidatingApi}
            className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white transition flex items-center gap-1.5 shrink-0 shadow-xs cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isValidatingApi ? 'animate-spin' : ''}`} />
            {isValidatingApi ? 'Validando conexão com o Google Gemini...' : 'Testar Conexão com a API em Tempo Real'}
          </button>
        </div>

        {apiValidationResult && (
          <div
            className={`p-3 rounded-lg text-xs flex items-start gap-2.5 ${
              apiValidationResult.success
                ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                : 'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
            }`}
          >
            {apiValidationResult.success ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
            )}
            <div>
              <p className="font-semibold">{apiValidationResult.message}</p>
              {apiValidationResult.latencyMs !== undefined && (
                <p className="text-[11px] opacity-80 mt-0.5">
                  Latência de resposta da API: <strong>{apiValidationResult.latencyMs}ms</strong>
                  {apiValidationResult.modelTested && ` • Modelo verificado: ${apiValidationResult.modelTested}`}
                </p>
              )}
            </div>
          </div>
        )}

        <p className="text-[11px] text-zinc-400 dark:text-zinc-500 leading-relaxed">
          🔒 <strong>Segurança:</strong> A chave de API permanece estritamente no backend do servidor e nunca é trafegada para o cliente.
        </p>
      </div>

      <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/30 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-center gap-2.5">
          <RefreshCw className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
          <div>
            <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Remover Versão Anterior e Instalar Versão Mais Recente do CLI
            </p>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              A atualização e reinstalação do Gemini CLI foi movida para o menu de Atualizações.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onNavigateToTab('git_update')}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition flex items-center gap-1.5 cursor-pointer shadow-xs shrink-0"
        >
          <span>Abrir Menu de Atualizações</span>
          <GitPullRequest className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          Modo de Aprovação de Ações (--approval-mode)
        </label>
        <select
          value={approvalMode}
          onChange={(e: any) => onChangeApprovalMode(e.target.value)}
          className="w-full px-3 py-2 text-xs rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 outline-none"
        >
          <option value="default">default - Solicita aprovação para comandos e alterações</option>
          <option value="auto_edit">auto_edit - Aprova edições de arquivos automaticamente</option>
          <option value="yolo">yolo - Executa comandos sem confirmações intermediárias</option>
          <option value="plan">plan - Modo plano / somente leitura</option>
        </select>
      </div>
    </div>
  );
};
