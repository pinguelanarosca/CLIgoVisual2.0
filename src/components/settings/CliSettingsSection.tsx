import React, { useState } from 'react';
import { Sparkles, RefreshCw, CheckCircle2, AlertCircle, Terminal, Check } from 'lucide-react';
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

  const handleTestApiConnection = async () => {
    setIsValidatingApi(true);
    setApiValidationResult(null);
    try {
      const data = await fetchJsonSafely<{
        success: boolean;
        message: string;
        latencyMs?: number;
        modelTested?: string;
      }>('/api/cli/validate-key?model=gemma-4-31b', { method: 'POST' });

      if (data) {
        setApiValidationResult({
          ...data,
          modelTested: data.modelTested || 'gemma-4-31b',
        });
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
        message: `Erro na requisição com o servidor local: ${err.message || err}`,
      });
    } finally {
      setIsValidatingApi(false);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Cabeçalho */}
      <div>
        <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
          <Terminal className="w-4 h-4 text-blue-500" />
          <span>Status do Motor Gemini CLI</span>
        </h4>
        <p className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">
          Informações operacionais obtidas dinamicamente do processo do Gemini CLI no servidor.
        </p>
      </div>

      {/* Cartão de Status Dinâmico */}
      <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-800/40 space-y-2.5 text-xs">
        <div className="flex justify-between items-center pb-2 border-b border-zinc-200/80 dark:border-zinc-700/60">
          <span className="font-medium text-zinc-600 dark:text-zinc-400">Binário do CLI Em Uso:</span>
          <span className="font-mono text-[11px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 rounded border border-blue-200/60 dark:border-blue-800/60">
            {cliStatus?.cliPath || 'gemini'}
          </span>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-zinc-600 dark:text-zinc-400">Versão do CLI Detectada:</span>
          <span className="font-mono text-[11px] font-bold text-zinc-800 dark:text-zinc-200">
            {cliStatus?.version ? `v${cliStatus.version}` : 'Verificando...'}
          </span>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-zinc-600 dark:text-zinc-400">Status do Processo:</span>
          {cliStatus?.available && cliStatus?.connectionState === 'connected' ? (
            <span className="flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" /> Operacional
            </span>
          ) : (
            <span className="flex items-center gap-1.5 font-semibold text-rose-600 dark:text-rose-400">
              <AlertCircle className="w-3.5 h-3.5" /> {cliStatus?.errorMessage || 'Indisponível'}
            </span>
          )}
        </div>

        <div className="flex justify-between items-center pt-2 border-t border-zinc-200/80 dark:border-zinc-700/60">
          <span className="text-zinc-600 dark:text-zinc-400">Chave GEMINI_API_KEY / Key Pool:</span>
          <div className="flex items-center gap-2">
            {cliStatus?.authConfigured ? (
              <span className="font-mono text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <Check className="w-3.5 h-3.5" />
                {cliStatus.maskedApiKey || 'Ativa no ambiente'}
              </span>
            ) : (
              <span className="flex items-center gap-1 font-semibold text-rose-500 text-[11px]">
                <AlertCircle className="w-3.5 h-3.5" /> Ausente
              </span>
            )}
            {onNavigateToTab && (
              <button
                type="button"
                onClick={() => onNavigateToTab('key_pool')}
                className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:underline px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 cursor-pointer"
              >
                Gerenciar Pool (K1..K9) →
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Teste Dinâmico de Conexão com API utilizando Gemma 4 (31B) */}
      <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-blue-500" />
            <h5 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Validação Dinâmica da API (Gemma 4 31B)
            </h5>
          </div>
          <button
            type="button"
            onClick={handleTestApiConnection}
            disabled={isValidatingApi}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isValidatingApi ? 'animate-spin' : ''}`} />
            <span>{isValidatingApi ? 'Testando...' : 'Testar Conexão Agora'}</span>
          </button>
        </div>

        {apiValidationResult && (
          <div
            className={`p-2.5 rounded-lg text-xs flex items-start gap-2 ${
              apiValidationResult.success
                ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/80'
                : 'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300 border border-rose-200/80 dark:border-rose-800/80'
            }`}
          >
            {apiValidationResult.success ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
            )}
            <div className="text-[11px] leading-tight">
              <p className="font-semibold">{apiValidationResult.message}</p>
              {apiValidationResult.success && apiValidationResult.latencyMs !== undefined && (
                <p className="opacity-80 mt-0.5 font-mono">
                  Latência: {apiValidationResult.latencyMs}ms | Modelo Testado: Gemma 4 (31B)
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
