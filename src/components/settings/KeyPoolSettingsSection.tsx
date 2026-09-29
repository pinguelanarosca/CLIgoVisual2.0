import React, { useState, useEffect } from 'react';
import {
  Key,
  ShieldCheck,
  Zap,
  Activity,
  RefreshCw,
  Trash2,
  Save,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Eye,
  EyeOff,
  Cpu,
  Info,
  Clock,
  Sparkles,
} from 'lucide-react';
import { ConfiguredKeyInfo, KeyModelStatus, KeyGroup } from '../../types.js';

interface KeyPoolSettingsSectionProps {
  onRefreshStatus?: () => void;
}

const GROUP_INFO: Record<KeyGroup, { label: string; desc: string; badgeClass: string; borderClass: string }> = {
  G1: {
    label: 'G1 (Operacional)',
    desc: 'Execução bem-sucedida / Totalmente disponível',
    badgeClass: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
    borderClass: 'border-emerald-500',
  },
  G2: {
    label: 'G2 (Sobrecarga / 529)',
    desc: 'Indisponibilidade temporária / Alta demanda do modelo',
    badgeClass: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800',
    borderClass: 'border-amber-500',
  },
  G3: {
    label: 'G3 (Quota / 429)',
    desc: 'Limite de requisições / Rate limit atingido',
    badgeClass: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-800',
    borderClass: 'border-orange-500',
  },
  G4: {
    label: 'G4 (Erro Servidor 5xx)',
    desc: 'Erro temporário de serviço na infraestrutura Google Gemini',
    badgeClass: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-800',
    borderClass: 'border-rose-500',
  },
  G5: {
    label: 'G5 (Erro Auth / 4xx Perm)',
    desc: 'Autenticação, chave inválida ou permissão negada',
    badgeClass: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-800',
    borderClass: 'border-purple-500',
  },
  G6: {
    label: 'G6 (Incompatível / 400)',
    desc: 'Modelo ou configuração incompatível / Parâmetros inválidos',
    badgeClass: 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700',
    borderClass: 'border-zinc-500',
  },
};

export const KeyPoolSettingsSection: React.FC<KeyPoolSettingsSectionProps> = ({ onRefreshStatus }) => {
  const [configuredKeys, setConfiguredKeys] = useState<Record<string, ConfiguredKeyInfo>>({});
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [visibleInputs, setVisibleInputs] = useState<Record<string, boolean>>({});
  const [rankingsByModel, setRankingsByModel] = useState<Record<string, KeyModelStatus[]>>({});
  const [models, setModels] = useState<string[]>([]);
  const [selectedModelFilter, setSelectedModelFilter] = useState<string>('gemini-3.5-flash-lite');
  const [lastCycleDate, setLastCycleDate] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isTestingBattery, setIsTestingBattery] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [externalKeyStatus, setExternalKeyStatus] = useState<{
    hasExternalKey: boolean;
    source?: string;
    maskedKey?: string;
    isMigrated?: boolean;
  } | null>(null);
  const [isMigrating, setIsMigrating] = useState<boolean>(false);

  const keyIds = ['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8', 'K9'];

  useEffect(() => {
    console.log('[KPOOL_UI] selected_model', selectedModelFilter);
    const count = (rankingsByModel[selectedModelFilter] || []).length;
    console.log('[KPOOL_UI] ranking_count', { model: selectedModelFilter, count });
  }, [selectedModelFilter, rankingsByModel]);

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [poolRes, extRes] = await Promise.all([
        fetch('/api/key-pool'),
        fetch('/api/key-pool/external-status').catch(() => null),
      ]);

      if (poolRes.ok) {
        const data = await poolRes.json();
        setConfiguredKeys(data.configuredKeys || {});
        setRankingsByModel(data.rankingsByModel || {});
        setModels(data.models || []);
        setLastCycleDate(data.lastCycleDate || '');
        if (data.models && data.models.length > 0 && !selectedModelFilter) {
          setSelectedModelFilter(data.models[0]);
        }
      }

      if (extRes && extRes.ok) {
        const extData = await extRes.json();
        setExternalKeyStatus(extData);
      }
    } catch (err: any) {
      setErrorMessage(`Erro ao carregar dados do Key Pool: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMigrateExternalKey = async () => {
    setIsMigrating(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/key-pool/migrate-external-key', {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccessMessage(`Chave existente (${data.migratedKeyMasked}) migrada com sucesso para K1 e removida do ambiente!`);
        setTimeout(() => setSuccessMessage(null), 6000);
        await loadData();
        if (onRefreshStatus) onRefreshStatus();
      } else {
        setErrorMessage(data.error || 'Falha ao migrar chave externa.');
      }
    } catch (err: any) {
      setErrorMessage(`Erro ao migrar chave: ${err.message}`);
    } finally {
      setIsMigrating(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveSingleKey = async (keyId: string) => {
    const val = inputValues[keyId]?.trim();
    if (!val) return;

    try {
      setErrorMessage(null);
      const res = await fetch('/api/key-pool/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: { [keyId]: val } }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setInputValues((prev) => ({ ...prev, [keyId]: '' }));
        setConfiguredKeys(data.configuredKeys || {});
        setSuccessMessage(`Chave ${keyId} salva com sucesso em api-keys.env (chmod 600)!`);
        setTimeout(() => setSuccessMessage(null), 4000);
        await loadData();
        if (onRefreshStatus) onRefreshStatus();
      } else {
        setErrorMessage(data.error || 'Falha ao salvar chave.');
      }
    } catch (err: any) {
      setErrorMessage(`Erro ao salvar chave: ${err.message}`);
    }
  };

  const handleSaveAllKeys = async () => {
    const payload: Record<string, string> = {};
    let count = 0;
    for (const [k, v] of Object.entries(inputValues)) {
      if (typeof v === 'string' && v.trim()) {
        payload[k] = v.trim();
        count++;
      }
    }

    if (count === 0) {
      setErrorMessage('Nenhuma nova chave digitada para salvar.');
      return;
    }

    try {
      setErrorMessage(null);
      const res = await fetch('/api/key-pool/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: payload }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setInputValues({});
        setConfiguredKeys(data.configuredKeys || {});
        setSuccessMessage(`${count} chave(s) salva(s) com sucesso em api-keys.env (chmod 600)!`);
        setTimeout(() => setSuccessMessage(null), 4000);
        await loadData();
        if (onRefreshStatus) onRefreshStatus();
      } else {
        setErrorMessage(data.error || 'Falha ao salvar chaves.');
      }
    } catch (err: any) {
      setErrorMessage(`Erro ao salvar chaves: ${err.message}`);
    }
  };

  const handleDeleteKey = async (keyId: string) => {
    if (!confirm(`Deseja remover a chave ${keyId} do Key Pool?`)) return;

    try {
      setErrorMessage(null);
      const res = await fetch(`/api/key-pool/keys/${keyId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setConfiguredKeys(data.configuredKeys || {});
        setSuccessMessage(`Chave ${keyId} removida com sucesso.`);
        setTimeout(() => setSuccessMessage(null), 4000);
        await loadData();
        if (onRefreshStatus) onRefreshStatus();
      } else {
        setErrorMessage(data.error || 'Falha ao remover chave.');
      }
    } catch (err: any) {
      setErrorMessage(`Erro ao remover chave: ${err.message}`);
    }
  };

  const handleRunBattery = async () => {
    console.log('[KPOOL_UI] battery_start');
    setIsTestingBattery(true);
    setErrorMessage(null);
    setSuccessMessage('Executando bateria completa de testes de saúde por modelo...');

    try {
      const res = await fetch('/api/key-pool/test-battery', { method: 'POST' });
      const data = await res.json();

      const testCount = Array.isArray(data.results)
        ? data.results.length
        : (data.totalTested ?? data.results?.totalTested ?? 0);

      console.log('[KPOOL_UI] battery_response', {
        success: Boolean(data.success),
        testCount,
      });

      if (res.ok && data.success) {
        setSuccessMessage(
          `Bateria diária concluída! ${testCount} testes executados e ranking atualizado.`
        );
        setTimeout(() => setSuccessMessage(null), 5000);

        // Fluxo obrigatório: POST bateria real -> persistência -> GET API -> ranking exibido
        console.log('[KPOOL_UI] refresh_after_battery');
        await loadData();
        if (onRefreshStatus) onRefreshStatus();
      } else {
        setErrorMessage(data.error || 'Falha ao executar bateria de testes.');
      }
    } catch (err: any) {
      setErrorMessage(`Erro ao executar bateria: ${err.message}`);
    } finally {
      setIsTestingBattery(false);
    }
  };

  const configuredCount = Object.values(configuredKeys).filter((k: ConfiguredKeyInfo) => k?.configured).length;
  // Ranking direto sem qualquer sort, filter ou reordenação client-side
  const currentRankings = rankingsByModel[selectedModelFilter] || [];

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Cabeçalho Principal */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Key className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              Key Pool & Ranking Dinâmico de Chaves Gemini (K1..K9)
            </h3>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Pool com 9 chaves gerenciadas de forma isolada por modelo, com classificação G1..G6, ordenação por latência L1..Ln e failover automático.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleRunBattery}
            disabled={isTestingBattery || configuredCount === 0}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-xs cursor-pointer ${
              isTestingBattery
                ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isTestingBattery ? 'animate-spin' : ''}`} />
            <span>{isTestingBattery ? 'Testando Modelos...' : 'Executar Bateria Diária'}</span>
          </button>
        </div>
      </div>

      {/* Alertas de Sucesso / Erro */}
      {successMessage && (
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 flex items-center gap-2 text-xs font-medium text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 flex items-center gap-2 text-xs font-medium text-rose-800 dark:text-rose-300">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Ação Explícita de Migração de GEMINI_API_KEY legada */}
      {externalKeyStatus?.hasExternalKey && (
        <div className="p-4 rounded-2xl border border-amber-300 dark:border-amber-700/80 bg-amber-500/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-bold text-amber-900 dark:text-amber-200">
                Credencial GEMINI_API_KEY detectada no ambiente legado
              </div>
              <p className="text-[11px] text-amber-800 dark:text-amber-300/90 mt-0.5 leading-relaxed">
                Origem: <code className="font-mono font-semibold">{externalKeyStatus.source || 'Variável de Ambiente'}</code> ({externalKeyStatus.maskedKey}).
                O Key Pool (K1..K9) é a única fonte oficial de credenciais da GUI.
              </p>
            </div>
          </div>
          <button
            onClick={handleMigrateExternalKey}
            disabled={isMigrating}
            className="px-3.5 py-2 bg-amber-600 hover:bg-amber-500 active:scale-95 text-white rounded-xl text-xs font-bold shrink-0 transition flex items-center gap-1.5 shadow-sm cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            <span>{isMigrating ? 'Migrando...' : 'Migrar GEMINI_API_KEY existente para K1 e remover do ambiente'}</span>
          </button>
        </div>
      )}

      {/* Cards de Métricas e Nomenclatura */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Chaves Ativas</span>
            <Key className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="text-xl font-extrabold text-zinc-900 dark:text-zinc-100">
            {configuredCount} <span className="text-xs text-zinc-400 font-normal">/ 9 chaves</span>
          </div>
          <div className="text-[10px] text-zinc-500">Persistidas em ~/.config/gemini-gui/api-keys.env (600)</div>
        </div>

        <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Ciclo Diário</span>
            <Clock className="w-3.5 h-3.5 text-blue-500" />
          </div>
          <div className="text-xl font-extrabold text-zinc-900 dark:text-zinc-100">
            {lastCycleDate || 'Não executado'}
          </div>
          <div className="text-[10px] text-zinc-500">1 teste único por chave × modelo a cada 24h</div>
        </div>

        <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Critério de Ranking</span>
            <Zap className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5 pt-1">
            <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300">G1..G6</span>
            <span>→</span>
            <span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300">L1..Ln</span>
          </div>
          <div className="text-[10px] text-zinc-500">Grupo prioritário, desempate por latência real</div>
        </div>
      </div>

      {/* 1. SEÇÃO DE CADASTRO DAS 9 CHAVES (K1..K9) */}
      <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Key className="w-4 h-4 text-amber-500" />
              Cadastro e Gerenciamento das Chaves (K1 a K9)
            </h4>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              Insira ou substitua chaves individualmente. As chaves são protegidas com permissão 600 e nunca aparecem em texto claro.
            </p>
          </div>
          <button
            onClick={handleSaveAllKeys}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition self-start sm:self-auto cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Salvar Todas</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {keyIds.map((keyId) => {
            const info = configuredKeys[keyId] || { keyId, configured: false, maskedKey: '' };
            const isVisible = visibleInputs[keyId] || false;
            const inputVal = inputValues[keyId] || '';

            return (
              <div
                key={keyId}
                className={`p-3 rounded-xl border transition-all ${
                  info.configured
                    ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/20 dark:bg-emerald-950/10'
                    : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-900/30'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold font-mono px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">
                      {keyId}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                        info.configured
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300'
                          : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                      }`}
                    >
                      {info.configured ? `Ativa: ${info.maskedKey}` : 'Vazia'}
                    </span>
                  </div>

                  {info.configured && (
                    <button
                      onClick={() => handleDeleteKey(keyId)}
                      title={`Remover ${keyId}`}
                      className="p-1 text-zinc-400 hover:text-rose-600 transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="space-y-2 mt-2">
                  <div className="relative flex items-center">
                    <input
                      type={isVisible ? 'text' : 'password'}
                      value={inputVal}
                      onChange={(e) => setInputValues({ ...inputValues, [keyId]: e.target.value })}
                      placeholder={info.configured ? 'Substituir chave...' : 'Inserir GEMINI_API_KEY...'}
                      className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg py-1.5 pl-2.5 pr-8 text-xs font-mono text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setVisibleInputs({ ...visibleInputs, [keyId]: !isVisible })}
                      className="absolute right-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
                    >
                      {isVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {inputVal && (
                    <button
                      onClick={() => handleSaveSingleKey(keyId)}
                      className="w-full py-1 bg-zinc-800 hover:bg-zinc-700 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-white rounded-md text-[11px] font-semibold flex items-center justify-center gap-1 transition cursor-pointer"
                    >
                      <Save className="w-3 h-3" />
                      <span>Salvar {keyId}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. RANKING DINÂMICO & HEALTH MONITOR POR MODELO */}
      <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-500" />
              Ranking Dinâmico e Estado Operacional por Modelo
            </h4>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              Selecione o modelo para inspecionar a fila de prioridade das chaves, grupos de disponibilidade e latências medidas.
            </p>
          </div>
        </div>

        {/* Abas de Modelos */}
        <div className="flex flex-wrap gap-1.5 border-b border-zinc-200 dark:border-zinc-800 pb-2">
          {models.map((mod) => {
            const isSelected = selectedModelFilter === mod;
            return (
              <button
                key={mod}
                onClick={() => setSelectedModelFilter(mod)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                }`}
              >
                <Cpu className="w-3 h-3" />
                <span>{mod}</span>
              </button>
            );
          })}
        </div>

        {/* Tabela do Ranking para o Modelo Selecionado (Respeita estritamente a ordem do backend) */}
        {currentRankings.length === 0 ? (
          <div className="p-6 text-center text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50/50 dark:bg-zinc-900/30 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800">
            Nenhuma chave avaliada ainda para o modelo <strong className="font-mono">{selectedModelFilter}</strong>.
            <div className="mt-2">
              <button
                onClick={handleRunBattery}
                disabled={isTestingBattery || configuredCount === 0}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                Executar Bateria de Testes Agora
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-800 rounded-xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-zinc-50 dark:bg-zinc-900/80 border-b border-zinc-200 dark:border-zinc-800 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  <th className="py-2.5 px-3">Posição</th>
                  <th className="py-2.5 px-3">Chave</th>
                  <th className="py-2.5 px-3">Grupo Atual</th>
                  <th className="py-2.5 px-3">Latência Atual</th>
                  <th className="py-2.5 px-3">Grupo Diário</th>
                  <th className="py-2.5 px-3">Latência Diária</th>
                  <th className="py-2.5 px-3">Último Status / Erro</th>
                  <th className="py-2.5 px-3">Último Sucesso</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 font-mono">
                {currentRankings.map((row, idx) => {
                  const isTested = Boolean(row.isTested || row.status?.lastTestAt);
                  const currentGroup = row.group || row.status?.currentGroup || null;
                  const currentLatency = row.latency ?? row.status?.currentLatency ?? null;
                  const latencyRank = row.latencyRank && row.latencyRank !== '-' ? row.latencyRank : '-';

                  const groupInfo = (isTested && currentGroup)
                    ? (GROUP_INFO[currentGroup] || GROUP_INFO.G1)
                    : {
                        label: 'Sem classificação',
                        desc: 'Aguardando teste real do ciclo diário',
                        badgeClass: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-300 dark:border-zinc-700',
                        borderClass: 'border-zinc-500',
                      };

                  const isTopRanked = idx === 0 && isTested && currentGroup === 'G1';
                  const positionLabel = `#${row.overallRank || idx + 1}`;

                  return (
                    <tr
                      key={row.keyId}
                      className={`hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 transition ${
                        isTopRanked ? 'bg-emerald-50/30 dark:bg-emerald-950/10' : ''
                      }`}
                    >
                      <td className="py-2.5 px-3 font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-[10px]">
                          {positionLabel}
                        </span>
                        {isTopRanked && (
                          <span className="text-[9px] font-sans px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 font-bold">
                            Titular
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-bold text-zinc-900 dark:text-zinc-100">
                        {row.keyId}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${groupInfo.badgeClass}`}
                        >
                          {(isTested && currentGroup) ? `${currentGroup} - ${groupInfo.label}` : 'Sem classificação'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-zinc-800 dark:text-zinc-200">
                        <span className="text-blue-600 dark:text-blue-400 font-bold mr-1.5">
                          {isTested ? latencyRank : '-'}
                        </span>
                        <span>{(isTested && currentLatency !== null) ? `${currentLatency} ms` : 'Sem teste'}</span>
                      </td>
                      <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-400 text-[11px]">
                        {(isTested && row.status?.dailyGroup) ? row.status.dailyGroup : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-400 text-[11px]">
                        {(isTested && row.status?.dailyLatency !== null && row.status?.dailyLatency !== undefined)
                          ? `${row.status.dailyLatency} ms`
                          : 'Sem teste'}
                      </td>
                      <td className="py-2.5 px-3 font-sans text-[11px] text-zinc-500 truncate max-w-xs">
                        {!isTested ? (
                          <span className="text-zinc-400 font-normal">Sem teste</span>
                        ) : row.status?.lastError ? (
                          <span className="text-rose-600 dark:text-rose-400 font-medium truncate block" title={row.status.lastError}>
                            ⚠️ {row.status.errorCode || ''}: {row.status.lastError}
                          </span>
                        ) : (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">✓ 200 OK</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-sans text-[10px] text-zinc-400">
                        {(isTested && row.status?.lastSuccessAt) ? new Date(row.status.lastSuccessAt).toLocaleTimeString() : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 3. GUIA DE NOMENCLATURA & GRUPOS OFICIAIS */}
      <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30 space-y-3">
        <h5 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5 text-blue-500" />
          Guia Oficial de Nomenclatura e Grupos (G1..G6 / L1..Ln)
        </h5>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
          {Object.entries(GROUP_INFO).map(([grp, info]) => (
            <div key={grp} className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
              <div className="font-bold text-zinc-900 dark:text-zinc-100">{info.label}</div>
              <div className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">{info.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

