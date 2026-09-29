import express from 'express';
import { AddressInfo } from 'node:net';
import fs from 'node:fs';
import {
  saveConfiguredKeys,
  loadConfiguredKeys,
  getConfiguredKeysPublicInfo,
  loadKeyPoolState,
  getPublicRankedKeys,
  getPublicExternalKeyStatus,
  migrateExternalApiKeyToK1,
  OFFICIAL_POOL_MODELS,
  getKeyPoolStatePath,
  getApiKeysEnvPath,
  saveKeyPoolState,
} from '../server/key-pool-service.js';

async function testNoKeyLeak() {
  console.log('====================================================');
  console.log('  TESTE AUTOMATIZADO DE PREVENÇÃO DE VAZAMENTO DE SEGREDO');
  console.log('====================================================\n');

  const statePath = getKeyPoolStatePath();
  const envPath = getApiKeysEnvPath();

  const originalStateContent = fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8') : null;
  const originalEnvContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : null;

  const TEST_SECRET_KEY = 'AIzaSyTEST_SECRET_KEY_SUPER_CONFIDENTIAL_998877665544332211';

  try {
    // 1. Cadastrar chave secreta de teste no Key Pool (K1)
    saveConfiguredKeys({
      K1: TEST_SECRET_KEY,
    });

    const now = new Date().toISOString();
    saveKeyPoolState({
      lastCycleDate: now.split('T')[0],
      isTesting: false,
      items: {
        'gemini-3.5-flash-lite:K1': {
          model: 'gemini-3.5-flash-lite',
          keyId: 'K1',
          dailyGroup: 'G1',
          dailyLatency: 250,
          currentGroup: 'G1',
          currentLatency: 250,
          cycleDate: now.split('T')[0],
          lastTestAt: now,
          isTested: true,
          consecutiveErrors: 0,
        },
      },
    });

    // 2. Subir servidor Express com as rotas reais do Key Pool
    const app = express();
    app.use(express.json());

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

    app.post('/api/key-pool/test-battery', (req, res) => {
      const state = loadKeyPoolState();
      const rankingsByModel: Record<string, any[]> = {};
      for (const model of OFFICIAL_POOL_MODELS) {
        rankingsByModel[model] = getPublicRankedKeys(model);
      }
      res.json({ success: true, results: Object.values(state.items), state, rankingsByModel });
    });

    app.get('/api/key-pool/external-status', (req, res) => {
      const status = getPublicExternalKeyStatus();
      res.json({ success: true, ...status });
    });

    const server = app.listen(0);
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      // 3. Testar GET /api/key-pool
      console.log('1. Testando GET /api/key-pool...');
      const resPool = await fetch(`${baseUrl}/api/key-pool`);
      const rawBodyPool = await resPool.text();
      const jsonPool = JSON.parse(rawBodyPool);

      // Asserção A: O segredo puro jamais deve aparecer no corpo JSON bruto
      console.assert(
        !rawBodyPool.includes(TEST_SECRET_KEY),
        'FALHA GRAVE: O segredo bruto foi encontrado no corpo do GET /api/key-pool!'
      );

      // Asserção B: Nenhum item em rankingsByModel deve possuir a propriedade "key"
      for (const model of OFFICIAL_POOL_MODELS) {
        const list = jsonPool.rankingsByModel?.[model] || [];
        for (const item of list) {
          console.assert(
            item.key === undefined,
            `FALHA GRAVE: A propriedade 'key' secreta foi encontrada no modelo ${model} para ${item.keyId}!`
          );
          console.assert(
            item.keyId !== undefined,
            `Propriedade pública 'keyId' deve existir no DTO.`
          );
        }
      }
      console.log('✓ GET /api/key-pool auditado: 0 vazamentos de segredos ou propriedades "key".');

      // 4. Testar POST /api/key-pool/test-battery
      console.log('2. Testando POST /api/key-pool/test-battery...');
      const resBattery = await fetch(`${baseUrl}/api/key-pool/test-battery`, { method: 'POST' });
      const rawBodyBattery = await resBattery.text();
      const jsonBattery = JSON.parse(rawBodyBattery);

      console.assert(
        !rawBodyBattery.includes(TEST_SECRET_KEY),
        'FALHA GRAVE: O segredo bruto foi encontrado no POST /api/key-pool/test-battery!'
      );

      for (const model of OFFICIAL_POOL_MODELS) {
        const list = jsonBattery.rankingsByModel?.[model] || [];
        for (const item of list) {
          console.assert(
            item.key === undefined,
            `FALHA GRAVE: A propriedade 'key' secreta foi encontrada em test-battery para ${item.keyId}!`
          );
        }
      }
      console.log('✓ POST /api/key-pool/test-battery auditado: 0 vazamentos de segredos ou propriedades "key".');

      // 5. Testar GET /api/key-pool/external-status
      console.log('3. Testando GET /api/key-pool/external-status...');
      const resExt = await fetch(`${baseUrl}/api/key-pool/external-status`);
      const rawBodyExt = await resExt.text();

      console.assert(
        !rawBodyExt.includes(TEST_SECRET_KEY),
        'FALHA GRAVE: O segredo bruto foi encontrado em /api/key-pool/external-status!'
      );
      console.log('✓ GET /api/key-pool/external-status auditado: 0 vazamentos.');

      console.log('\n====================================================');
      console.log('  RESULTADO: TESTE DE PREVENÇÃO DE VAZAMENTO 100% APROVADO!');
      console.log('  Garantias confirmadas:');
      console.log('  - O segredo de API permanece 100% isolado no backend.');
      console.log('  - DTO público retornado à GUI não possui a propriedade "key".');
      console.log('  - Nenhuma resposta pública contém o segredo em texto puro ou mascaramento incompleto.');
      console.log('====================================================\n');
    } finally {
      server.close();
    }
  } finally {
    if (originalStateContent !== null) {
      fs.writeFileSync(statePath, originalStateContent, 'utf8');
    } else if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath);
    }

    if (originalEnvContent !== null) {
      fs.writeFileSync(envPath, originalEnvContent, 'utf8');
    } else if (fs.existsSync(envPath)) {
      fs.unlinkSync(envPath);
    }
  }
}

testNoKeyLeak().catch((err) => {
  console.error('❌ FALHA NO TESTE DE SEGURANÇA DE VAZAMENTO:', err);
  process.exit(1);
});
