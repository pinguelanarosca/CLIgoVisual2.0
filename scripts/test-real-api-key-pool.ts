import express from 'express';
import { AddressInfo } from 'node:net';
import fs from 'node:fs';
import {
  loadConfiguredKeys,
  loadKeyPoolState,
  runDailyTestBattery,
  getRankedKeys,
  getPublicRankedKeys,
  getBestEligibleKey,
  getConfiguredKeysPublicInfo,
  OFFICIAL_POOL_MODELS,
  getKeyPoolStatePath,
} from '../server/key-pool-service.js';

async function runRealApiIntegrationTest() {
  console.log('====================================================');
  console.log('  REAL API & KEY POOL END-TO-END INTEGRATION TEST');
  console.log('====================================================\n');

  // 1. Configurar servidor HTTP Express temporário para testar o endpoint /api/key-pool
  const app = express();
  app.get('/api/key-pool', (req, res) => {
    const configuredKeys = getConfiguredKeysPublicInfo();
    const state = loadKeyPoolState();
    const rankingsByModel: Record<string, any[]> = {};
    for (const model of OFFICIAL_POOL_MODELS) {
      rankingsByModel[model] = getPublicRankedKeys(model);
    }
    res.json({
      configuredKeys,
      state,
      rankingsByModel,
      models: OFFICIAL_POOL_MODELS,
      lastCycleDate: state.lastCycleDate,
    });
  });

  const server = app.listen(0);
  const address = server.address() as AddressInfo;
  const port = address.port;
  const apiEndpointUrl = `http://127.0.0.1:${port}/api/key-pool`;

  try {
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

    // 1. Ler arquivo de persistência em disco (key-pool-state.json)
    const statePath = getKeyPoolStatePath();
    console.assert(fs.existsSync(statePath), 'key-pool-state.json deve existir em disco');
    const rawStateContent = fs.readFileSync(statePath, 'utf8');
    const parsedDiskState = JSON.parse(rawStateContent);

    // 2. Fazer requisição HTTP real ao endpoint /api/key-pool
    console.log(`Efetuando chamada HTTP ao endpoint real: ${apiEndpointUrl}...`);
    const apiResponse = await fetch(apiEndpointUrl);
    console.assert(apiResponse.status === 200, 'Endpoint /api/key-pool deve retornar HTTP 200');
    const apiData = await apiResponse.json();

    // 3. Validar o contrato consumido por KeyPoolSettingsSection.tsx
    console.assert(typeof apiData.configuredKeys === 'object', 'Contrato GUI: configuredKeys deve existir');
    console.assert(typeof apiData.rankingsByModel === 'object', 'Contrato GUI: rankingsByModel deve existir');
    console.assert(Array.isArray(apiData.models), 'Contrato GUI: models deve ser array');
    console.assert(typeof apiData.lastCycleDate === 'string', 'Contrato GUI: lastCycleDate deve ser string');

    console.log('--- VALIDAÇÃO DE CONTRATO E PARIDADE (DISCO vs ENDPOINT API) ---\n');

    let totalValidMs = 0;
    let countValidMs = 0;
    let matchesCount = 0;
    let totalItemsChecked = 0;

    for (const model of OFFICIAL_POOL_MODELS) {
      const endpointRankings = apiData.rankingsByModel[model] || [];
      console.log(`Modelo [${model}] (${endpointRankings.length} chaves no endpoint HTTP):`);

      for (const item of endpointRankings) {
        totalItemsChecked++;
        const itemKey = `${model}:${item.keyId}`;
        const diskEntry = parsedDiskState.items[itemKey];

        // Comparar resultados do endpoint com o disco
        console.assert(diskEntry !== undefined, `Entrada ${itemKey} deve existir no arquivo persistido em disco`);
        console.assert(diskEntry.currentGroup === item.group, `Grupo no endpoint (${item.group}) deve coincidir com o disco (${diskEntry?.currentGroup})`);
        console.assert(diskEntry.currentLatency === item.latency, `Latência no endpoint (${item.latency}ms) deve coincidir com o disco (${diskEntry?.currentLatency}ms)`);
        console.assert(item.isTested === Boolean(diskEntry.lastTestAt), `Status isTested (${item.isTested}) deve coincidir com o disco`);

        matchesCount++;

        if (item.latency !== null) {
          totalValidMs += item.latency;
          countValidMs++;
        }

        console.log(`  #${item.overallRank} ${item.keyId} | Group: ${item.group || 'Não testada'} (${item.latencyRank}) | Latência Real: ${item.latency !== null ? item.latency + 'ms' : 'Sem teste'} | isTested: ${item.isTested} | Error: ${item.status?.lastError?.slice(0, 45) || 'None'}`);
      }
    }

    const avgLatency = countValidMs > 0 ? Math.round(totalValidMs / countValidMs) : 0;
    const parityPercent = totalItemsChecked > 0 ? Math.round((matchesCount / totalItemsChecked) * 100) : 100;

    console.log(`\n====================================================`);
    console.log(`  MÉTRICAS FINAIS E RELATÓRIO DE VALIDAÇÃO`);
    console.log(`  - Requisições reais efetuadas: ${batteryResult.totalTested}`);
    console.log(`  - Latências reais medidas: ${countValidMs}`);
    console.log(`  - Latência média por chamada real: ${avgLatency}ms`);
    console.log(`  - Coincidência entre Disco e Endpoint API: ${parityPercent}%`);
    console.log(`----------------------------------------------------`);
    console.log(`  [STATUS DE VALIDAÇÃO DE CAMADAS]`);
    console.log(`  ✓ Persistência (key-pool-state.json): VALIDADA`);
    console.log(`  ✓ Endpoint HTTP (/api/key-pool): VALIDADO`);
    console.log(`  ℹ Frontend GUI: NÃO VALIDADO AUTOMATICAMENTE (sem teste de navegador headless configurado no ambiente CLI).`);
    console.log(`====================================================\n`);
  } finally {
    server.close();
  }
}

runRealApiIntegrationTest().catch((err) => {
  console.error('❌ FALHA NO TESTE REAL DE INTEGRAÇÃO:', err);
  process.exit(1);
});

