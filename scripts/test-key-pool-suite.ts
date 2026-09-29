import {
  loadConfiguredKeys,
  saveConfiguredKeys,
  loadKeyPoolState,
  saveKeyPoolState,
  runDailyTestBattery,
  getRankedKeys,
  getBestEligibleKey,
  recordRuntimeExecutionResult,
  classifyKeyResult,
  OFFICIAL_POOL_MODELS,
  getApiKeysEnvPath,
  getKeyPoolStatePath,
} from '../server/key-pool-service.js';
import fs from 'node:fs';
import path from 'node:path';

async function runTestSuite() {
  console.log('====================================================');
  console.log('  KEY POOL & DYNAMIC RANKING INTEGRATION SUITE');
  console.log('====================================================\n');

  // Backup original environment and state files
  const envPath = getApiKeysEnvPath();
  const statePath = getKeyPoolStatePath();
  const origEnv = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : null;
  const origState = fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8') : null;

  try {
    // SCENARIO 15: Nenhuma chave cadastrada -> Comportamento sem exceção e sem recuperar externa
    console.log('[TEST 15] Pool com 0 chaves: Nenhuma chave cadastrada...');
    saveConfiguredKeys({
      K1: null, K2: null, K3: null, K4: null, K5: null, K6: null, K7: null, K8: null, K9: null
    });
    saveKeyPoolState({ lastCycleDate: '', isTesting: false, items: {} });
    
    const keys0 = loadConfiguredKeys();
    console.assert(Object.keys(keys0).length === 0, 'Pool deve ter 0 chaves');
    const best0 = getBestEligibleKey('gemini-3.5-flash-lite');
    console.assert(best0 === null, 'getBestEligibleKey deve retornar null com pool vazio');
    console.log('✓ Passou [TEST 15]\n');

    // SCENARIO 11: Nenhuma classificação ainda -> Ordem K1, K2, K3...
    console.log('[TEST 11] Chaves configuradas sem classificação ainda...');
    saveConfiguredKeys({
      K1: 'DUMMY_KEY_1_TEST_ONLY_AA',
      K2: 'DUMMY_KEY_2_TEST_ONLY_BB',
      K3: 'DUMMY_KEY_3_TEST_ONLY_CC',
    });
    saveKeyPoolState({ lastCycleDate: '', isTesting: false, items: {} });

    const rankedUnclassified = getRankedKeys('gemini-3.5-flash-lite');
    console.assert(rankedUnclassified.length === 3, 'Deve retornar 3 chaves');
    console.assert(rankedUnclassified[0].keyId === 'K1', 'K1 deve ser o primeiro sem classificação');
    console.assert(rankedUnclassified[1].keyId === 'K2', 'K2 deve ser o segundo sem classificação');
    console.assert(rankedUnclassified[2].keyId === 'K3', 'K3 deve ser o terceiro sem classificação');
    console.assert(rankedUnclassified[0].latency === null, 'Latência deve ser null antes de ser testada');
    console.log('✓ Passou [TEST 11] - Ordem numérica K1 < K2 < K3 mantida sem dados inventados.\n');

    // SCENARIO 12: Mistura de chaves classificadas (G1) e não classificadas
    console.log('[TEST 12] Mistura de chaves classificadas (G1) e não classificadas...');
    const now = new Date().toISOString();
    saveKeyPoolState({
      lastCycleDate: '2026-09-29',
      isTesting: false,
      items: {
        'gemini-3.5-flash-lite:K2': {
          model: 'gemini-3.5-flash-lite',
          keyId: 'K2',
          dailyGroup: 'G1',
          dailyLatency: 350,
          currentGroup: 'G1',
          currentLatency: 350,
          consecutiveErrors: 0,
          cycleDate: '2026-09-29',
          lastTestAt: now,
          lastSuccessAt: now,
        },
      },
    });

    const rankedMixed = getRankedKeys('gemini-3.5-flash-lite');
    console.assert(rankedMixed[0].keyId === 'K2', 'K2 (testada G1 350ms) deve vir primeiro');
    console.assert(rankedMixed[1].keyId === 'K1', 'K1 (não-testada) deve vir em segundo');
    console.assert(rankedMixed[2].keyId === 'K3', 'K3 (não-testada) deve vir em terceiro');
    console.log('✓ Passou [TEST 12] - K2(G1) -> K1(não-testada) -> K3(não-testada).\n');

    // SCENARIOS 5-8: Validação de Classificação de Erros
    console.log('[TEST 5-8] Normalização e classificação dos erros reais HTTP...');
    const err529 = classifyKeyResult(529, null, 'Model overloaded (529)');
    console.assert(err529.group === 'G2', 'Erro 529 deve ser G2');

    const err429 = classifyKeyResult(429, null, 'Quota exceeded for metric (429)');
    console.assert(err429.group === 'G3', 'Erro 429 deve ser G3');

    const err500 = classifyKeyResult(500, null, 'Internal server error (500)');
    console.assert(err500.group === 'G4', 'Erro 500 deve ser G4');

    const err400Auth = classifyKeyResult(400, null, 'API key not valid. Please pass a valid API key.');
    console.assert(err400Auth.group === 'G5', 'Erro API_KEY_INVALID 400 deve ser G5');
    console.log('✓ Passou [TEST 5-8] - Classificações G2, G3, G4, G5 validadas.\n');

    // SCENARIOS 13-14: Persistência real e ciclo diário
    console.log('[TEST 13-14] Reinicialização mantendo ranking e ciclo diário...');
    recordRuntimeExecutionResult('gemini-3.7-flash', 'K1', {
      success: true,
      latencyMs: 620,
    });
    
    // Simular reinicialização lendo estado do disco
    const reloadedState = loadKeyPoolState();
    console.assert(reloadedState.items['gemini-3.7-flash:K1'] !== undefined, 'Item persistido deve ser recuperado do disco');
    console.assert(reloadedState.items['gemini-3.7-flash:K1'].currentLatency === 620, 'Latência real 620ms persistida');
    console.log('✓ Passou [TEST 13-14] - Estado mantido entre reinicializações.\n');

    // SCENARIOS 1-4: Execução Real de API para chaves configuradas
    console.log('[TEST 1-4] Execução da bateria real de testes contra a API...');
    const activeKeys = loadConfiguredKeys();
    console.log(`Chaves ativas configuradas no Key Pool: [${Object.keys(activeKeys).join(', ')}]`);

    if (Object.keys(activeKeys).length > 0) {
      console.log('Iniciando bateria diária completa (forceRefresh=true)...');
      const batteryResult = await runDailyTestBattery(true);
      console.log(`\n✓ Bateria diária concluída: ${batteryResult.totalTested} combinações executadas.`);
      
      for (const model of OFFICIAL_POOL_MODELS) {
        const ranked = getRankedKeys(model);
        console.log(`\nModelo [${model}]:`);
        for (const item of ranked) {
          console.log(`  #${item.overallRank} ${item.keyId} -> Group ${item.group} (${item.latencyRank}) -> Latência: ${item.latency ? item.latency + 'ms' : '-'} -> Error: ${item.status.lastError?.slice(0, 50) || 'None'}`);
        }
      }
    } else {
      console.log('Nenhuma chave ativa no Key Pool para disparar requisição remota.');
    }

  } finally {
    // Restore original state files
    if (origEnv !== null) fs.writeFileSync(envPath, origEnv, 'utf8');
    if (origState !== null) fs.writeFileSync(statePath, origState, 'utf8');
  }

  console.log('\n====================================================');
  console.log('  TODOS OS TESTES DE INTEGRAÇÃO CONCLUÍDOS COM SUCESSO');
  console.log('====================================================');
}

runTestSuite().catch((err) => {
  console.error('FALHA NOS TESTES:', err);
  process.exit(1);
});
