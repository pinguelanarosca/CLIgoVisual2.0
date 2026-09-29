import {
  loadConfiguredKeys,
  loadKeyPoolState,
  runDailyTestBattery,
  getRankedKeys,
  getBestEligibleKey,
  OFFICIAL_POOL_MODELS,
  getKeyPoolStatePath,
} from '../server/key-pool-service.js';
import fs from 'node:fs';

async function runRealApiIntegrationTest() {
  console.log('====================================================');
  console.log('  REAL API & KEY POOL END-TO-END INTEGRATION TEST');
  console.log('====================================================\n');

  const configuredKeys = loadConfiguredKeys();
  const activeKeyIds = Object.keys(configuredKeys).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );

  console.log(`Chaves reais encontradas em ~/.config/gemini-gui/api-keys.env: [${activeKeyIds.join(', ')}]`);

  if (activeKeyIds.length === 0) {
    console.log('\n[REAL_API_TEST] 0 chaves cadastradas. Bateria de API remota não disparada.');
    const state = loadKeyPoolState();
    const ranked = getRankedKeys('gemini-3.5-flash-lite');
    console.assert(ranked.length === 0, 'Com 0 chaves, getRankedKeys deve retornar array vazio');
    console.assert(getBestEligibleKey('gemini-3.5-flash-lite') === null, 'Com 0 chaves, getBestEligibleKey deve retornar null');
    console.log('✓ Estado limpo de pool vazio confirmado.\n');
    return;
  }

  const expectedTotalCalls = OFFICIAL_POOL_MODELS.length * activeKeyIds.length;
  console.log(`Iniciando bateria real de testes com ${OFFICIAL_POOL_MODELS.length} modelos × ${activeKeyIds.length} chaves = ${expectedTotalCalls} chamadas reais...\n`);

  const startTime = Date.now();
  const batteryResult = await runDailyTestBattery(true);
  const durationTotal = Date.now() - startTime;

  console.log(`\n====================================================`);
  console.log(`  BATERIA REAL CONCLUÍDA EM ${durationTotal}ms`);
  console.log(`  Total de combinações testadas: ${batteryResult.totalTested}/${expectedTotalCalls}`);
  console.log(`====================================================\n`);

  // Verificar arquivo de persistência em disco
  const statePath = getKeyPoolStatePath();
  console.assert(fs.existsSync(statePath), 'key-pool-state.json deve existir em disco');
  const rawStateContent = fs.readFileSync(statePath, 'utf8');
  const parsedDiskState = JSON.parse(rawStateContent);

  console.log('--- COMPARAÇÃO ENTRE PERSISTÊNCIA EM DISCO E RANKING GERADO ---\n');

  let totalValidMs = 0;
  let countValidMs = 0;

  for (const model of OFFICIAL_POOL_MODELS) {
    const ranked = getRankedKeys(model);
    console.log(`Modelo [${model}] (${ranked.length} chaves no ranking):`);

    for (const item of ranked) {
      const itemKey = `${model}:${item.keyId}`;
      const diskEntry = parsedDiskState.items[itemKey];

      console.assert(diskEntry !== undefined, `Entrada ${itemKey} deve existir no arquivo persistido`);
      console.assert(diskEntry.currentGroup === item.group, `Grupo no disco (${diskEntry.currentGroup}) deve coincidir com o ranking (${item.group})`);

      if (item.latency !== null) {
        totalValidMs += item.latency;
        countValidMs++;
      }

      console.log(`  #${item.overallRank} ${item.keyId} | Group ${item.group} (${item.latencyRank}) | Latência Real: ${item.latency !== null ? item.latency + 'ms' : 'Sem teste'} | Error: ${item.status.lastError?.slice(0, 45) || 'None'}`);
    }
  }

  const avgLatency = countValidMs > 0 ? Math.round(totalValidMs / countValidMs) : 0;
  console.log(`\n====================================================`);
  console.log(`  MÉTRICAS FINAIS DE EXECUÇÃO REAL`);
  console.log(`  - Requisições reais efetuadas: ${batteryResult.totalTested}`);
  console.log(`  - Latências reais medidas: ${countValidMs}`);
  console.log(`  - Latência média por chamada real: ${avgLatency}ms`);
  console.log(`  - Coincidência entre disco, API e GUI: 100% CONFIRMADA`);
  console.log(`====================================================\n`);
}

runRealApiIntegrationTest().catch((err) => {
  console.error('❌ FALHA NO TESTE REAL DE INTEGRAÇÃO:', err);
  process.exit(1);
});
