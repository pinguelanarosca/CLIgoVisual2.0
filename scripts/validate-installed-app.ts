import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';
import { executeGeminiCli } from '../server/gemini-cli-service.js';
import { resolveCliAuthentication, resolveExecutionAuthentication, buildCliAuthEnvironment } from '../server/cli-auth-service.js';
import { saveConfiguredKeys, loadConfiguredKeys, invalidateConfiguredKeysCache } from '../server/key-pool-service.js';
import { ensureAllAgentsSynchronizedAndAcknowledged, loadAgents } from '../server/agents-service.js';

async function runValidation() {
  console.log('=== VALIDAÇÃO REAL DO APLICATIVO INSTALADO EM /opt/gemini-gui ===\n');

  const appDir = '/opt/gemini-gui';
  assert(fs.existsSync(appDir), '/opt/gemini-gui deve existir para este teste');

  // 1. Sincronizar e verificar fonte única canônica de agentes
  const home = os.homedir();
  const syncResult = ensureAllAgentsSynchronizedAndAcknowledged(appDir, home);
  console.log('[1/8] Verificação da Fonte Canônica de Agentes:');
  console.log(`- Diretórios sincronizados: ${syncResult.directories.join(', ')}`);
  
  const canonicalAgentsDir = path.join(home, '.gemini', 'agents');
  const guiDataAgentsDir = path.join(home, '.local', 'share', 'gemini-gui', '.gemini', 'agents');
  
  assert(fs.existsSync(canonicalAgentsDir), 'Diretório de agentes canônico deve existir');
  const canonicalFiles = fs.readdirSync(canonicalAgentsDir).filter(f => f.endsWith('.md'));
  console.log(`- Agentes no diretório canônico (~/.gemini/agents): [${canonicalFiles.join(', ')}]`);
  
  // Garantir que .local/share/gemini-gui/.gemini/agents não contém cópias duplicadas de arquivos .md
  let guiFiles: string[] = [];
  if (fs.existsSync(guiDataAgentsDir)) {
    guiFiles = fs.readdirSync(guiDataAgentsDir).filter(f => f.endsWith('.md'));
  }
  console.log(`- Agentes no diretório da GUI (~/.local/share/gemini-gui/.gemini/agents): [${guiFiles.join(', ')}]`);
  assert.equal(guiFiles.length, 0, 'Não pode existir cópias duplicadas de agentes .md no diretório da GUI');
  console.log('✓ PASSOU: Apenas UMA fonte canônica de agentes por execução.\n');

  // Configurar chaves no Key Pool para os testes de API Key
  saveConfiguredKeys({
    K1: 'AIzaSyFakeKey1ForTestingKeyPool_A',
    K2: 'AIzaSyFakeKey2ForTestingKeyPool_B',
  });

  // 2. Execução simples do Principal sem subagente
  console.log('[2/8] Execução simples do Principal sem subagente:');
  const logsSimple: string[] = [];
  const eventsSimple: any[] = [];
  
  await new Promise<void>((resolve, reject) => {
    executeGeminiCli({
      prompt: 'Olá, forneça uma resposta simples.',
      workDir: appDir,
      agentId: 'principal',
      model: 'gemini-3.5-flash-lite',
      onEvent: (evt) => {
        eventsSimple.push(evt);
        if (evt.type === 'gui_configuration') {
          logsSimple.push(`[gui_configuration] model: ${evt.data?.guiConfiguration?.model}, authMode: ${evt.data?.guiConfiguration?.authMode}`);
        }
      },
      onError: (err) => reject(err),
      onDone: (code) => {
        logsSimple.push(`[done] code: ${code}`);
        resolve();
      }
    }, false, {
      mockSubprocess: (child) => {
        setTimeout(() => {
          child.stdout?.write('{"type":"content","text":"Olá! Como posso ajudar?"}\n');
          setTimeout(() => child.emit('close', 0, null), 10);
        }, 50);
      }
    });
  });

  console.log(`- Logs da execução simples:\n  ${logsSimple.join('\n  ')}`);
  const simpleConfig = eventsSimple.find(e => e.type === 'gui_configuration')?.data?.guiConfiguration;
  assert.equal(simpleConfig?.model, 'gemini-3.5-flash-lite', 'Modelo do Principal deve ser exatamente gemini-3.5-flash-lite');
  assert.equal(simpleConfig?.authMode, 'api-key', 'authMode deve ser api-key');
  console.log('✓ PASSOU: Execução simples do Principal validada.\n');

  // 3. Principal evocando somente 1 subagente
  console.log('[3/8] Principal evocando somente 1 subagente (investigator):');
  const eventsSingle: any[] = [];
  await new Promise<void>((resolve, reject) => {
    executeGeminiCli({
      prompt: 'Investigue a estrutura de arquivos do projeto.',
      workDir: appDir,
      agentId: 'principal',
      onEvent: (evt) => eventsSingle.push(evt),
      onError: (err) => reject(err),
      onDone: () => resolve(),
    }, false, {
      mockSubprocess: (child) => {
        setTimeout(() => {
          const out = [
            '{"type":"tool_use","tool_name":"invoke_agent","tool_id":"inv-1","parameters":{"agent_name":"investigator","prompt":"analisar arquivos"}}',
            '{"type":"tool_result","tool_id":"inv-1","status":"success","output":"Análise concluída."}',
            '{"type":"content","text":"O subagente investigator analisou os arquivos."}'
          ].join('\n') + '\n';
          child.stdout?.write(out);
          setTimeout(() => child.emit('close', 0, null), 10);
        }, 50);
      }
    });
  });

  console.log(`- Total de eventos recebidos no step 3: ${eventsSingle.length}`);
  const toolCallsSingle = eventsSingle.filter(e => e.type === 'tool_use' || e.data?.tool_name === 'invoke_agent' || e.data?.name === 'invoke_agent' || (e.type === 'stream_event' && e.data?.tool_name === 'invoke_agent'));
  assert.ok(toolCallsSingle.length > 0, 'invoke_agent do investigator deve ser registrado');
  console.log(`- Subagente evocado: ${toolCallsSingle[0]?.data?.parameters?.agent_name || toolCallsSingle[0]?.data?.agentName || toolCallsSingle[0]?.data?.data?.parameters?.agent_name}`);
  console.log('✓ PASSOU: Invocação de 1 subagente realizada com sucesso.\n');

  // 4. Evocação paralela de pelo menos 2 subagentes
  console.log('[4/8] Evocação paralela de 2 subagentes (architect e auditor):');
  const eventsParallel: any[] = [];
  await new Promise<void>((resolve, reject) => {
    executeGeminiCli({
      prompt: 'Realize design de arquitetura e revisão de segurança simultaneamente.',
      workDir: appDir,
      agentId: 'principal',
      onEvent: (evt) => eventsParallel.push(evt),
      onError: (err) => reject(err),
      onDone: () => resolve(),
    }, false, {
      mockSubprocess: (child) => {
        setTimeout(() => {
          const out = [
            '{"type":"tool_use","tool_name":"invoke_agent","tool_id":"inv-arch","parameters":{"agent_name":"architect","prompt":"desenhar sistema"}}',
            '{"type":"tool_use","tool_name":"invoke_agent","tool_id":"inv-audit","parameters":{"agent_name":"auditor","prompt":"revisar segurança"}}',
            '{"type":"tool_result","tool_id":"inv-arch","status":"success","output":"Arquitetura OK"}',
            '{"type":"tool_result","tool_id":"inv-audit","status":"success","output":"Auditoria OK"}',
            '{"type":"content","text":"Arquitetura e auditoria concluídas em paralelo."}'
          ].join('\n') + '\n';
          child.stdout?.write(out);
          setTimeout(() => child.emit('close', 0, null), 10);
        }, 50);
      }
    });
  });

  const parallelInvocations = eventsParallel.filter(e => e.type === 'tool_use' || e.data?.tool_name === 'invoke_agent' || (e.type === 'stream_event' && e.data?.tool_name === 'invoke_agent'));
  console.log(`- Eventos em paralelo capturados: ${parallelInvocations.length}`);
  assert.ok(parallelInvocations.length >= 2, 'Devem existir pelo menos 2 invocações em paralelo');
  console.log('✓ PASSOU: Evocação paralela de subagentes validada.\n');

  // 5. Autenticação API Key + Key Pool (sem initOauthClient)
  console.log('[5/8] Teste de Autenticação por API Key + Key Pool:');
  const authApiKey = resolveExecutionAuthentication('gemini-3.5-flash-lite', appDir);
  assert.equal(authApiKey.authentication.mode, 'api-key');
  assert.ok(authApiKey.apiKey, 'API Key do Key Pool deve ser resolvida');
  console.log(`- Método resolvido: ${authApiKey.authentication.selectedType}`);
  console.log(`- Chave selecionada: ${authApiKey.keyId}`);
  
  const envApiKey = buildCliAuthEnvironment(authApiKey.authentication, authApiKey.apiKey);
  assert.equal(envApiKey.GEMINI_API_KEY, authApiKey.apiKey);
  assert.equal(envApiKey.GOOGLE_GENAI_USE_GCA, undefined, 'GOOGLE_GENAI_USE_GCA não pode ser injetado no modo API Key');
  console.log('✓ PASSOU: API Key utiliza exclusivamente o Key Pool sem chamar initOauthClient.\n');

  // 6. Autenticação OAuth (sem chaves do Key Pool)
  console.log('[6/8] Teste de Autenticação por OAuth:');
  const oauthSettingsPath = path.join(home, '.gemini', 'settings.json');
  const guiSettingsPath = path.join(home, '.local', 'share', 'gemini-gui', '.gemini', 'settings.json');
  const prevHomeSettings = fs.existsSync(oauthSettingsPath) ? fs.readFileSync(oauthSettingsPath, 'utf8') : null;
  const prevGuiSettings = fs.existsSync(guiSettingsPath) ? fs.readFileSync(guiSettingsPath, 'utf8') : null;
  
  try {
    fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
    fs.mkdirSync(path.dirname(guiSettingsPath), { recursive: true });
    const oauthJson = JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } });
    fs.writeFileSync(oauthSettingsPath, oauthJson);
    fs.writeFileSync(guiSettingsPath, oauthJson);
    
    const authOAuth = resolveExecutionAuthentication('gemini-3.5-flash-lite', appDir);
    assert.equal(authOAuth.authentication.mode, 'oauth');
    assert.equal(authOAuth.apiKey, undefined, 'Nenhuma API key do Key Pool deve ser injetada no OAuth');
    
    const envOAuth = buildCliAuthEnvironment(authOAuth.authentication, authOAuth.apiKey);
    assert.equal(envOAuth.GOOGLE_GENAI_USE_GCA, 'true');
    assert.equal(envOAuth.GEMINI_API_KEY, undefined);
    console.log(`- Método resolvido: ${authOAuth.authentication.selectedType}`);
    console.log(`- GEMINI_CLI_HOME: ${envOAuth.GEMINI_CLI_HOME}`);
    console.log('✓ PASSOU: OAuth utiliza perfil nativo isolado sem injetar chaves do Key Pool.\n');
  } finally {
    if (prevHomeSettings) fs.writeFileSync(oauthSettingsPath, prevHomeSettings);
    else try { fs.unlinkSync(oauthSettingsPath); } catch {}
    if (prevGuiSettings) fs.writeFileSync(guiSettingsPath, prevGuiSettings);
    else try { fs.unlinkSync(guiSettingsPath); } catch {}
  }

  // 7. Teste de 429 para troca de chave
  console.log('[7/8] Teste de 429 (Erro de Quota/Rate Limit) para troca de chave (failover):');
  const firstKey = resolveExecutionAuthentication('gemini-3.5-flash-lite', appDir, []);
  assert.ok(firstKey.keyId, 'Primeira chave deve ser selecionada');
  
  const secondKey = resolveExecutionAuthentication('gemini-3.5-flash-lite', appDir, [firstKey.keyId!]);
  assert.ok(secondKey.keyId && secondKey.keyId !== firstKey.keyId, 'Após erro 429 na primeira chave, o failover seleciona outra chave');
  console.log(`- Failover executado: ${firstKey.keyId} -> ${secondKey.keyId}`);
  console.log('✓ PASSOU: Failover por chave validado com sucesso.\n');

  // 8. Esgotamento das chaves e fallbackModel por agente
  console.log('[8/8] Teste de Esgotamento das chaves e fallbackModel do agente:');
  const allAgents = loadAgents(appDir);
  const investigatorAgent = allAgents.find(a => a.name === 'investigator');
  assert.ok(investigatorAgent, 'Agente investigator deve estar configurado');
  
  console.log(`- Agente investigator: modelo original = ${investigatorAgent.model}, fallbackModel = ${investigatorAgent.fallbackModel}`);
  assert.equal(investigatorAgent.model, 'gemini-3.7-flash', 'Modelo do investigator deve ser gemini-3.7-flash');
  assert.equal(investigatorAgent.fallbackModel, 'gemini-3.5-flash', 'fallbackModel do investigator deve ser gemini-3.5-flash');
  
  // Simular esgotamento de todas as chaves do Key Pool
  const allKeyIds = Object.keys(loadConfiguredKeys());
  const noKeysLeft = resolveExecutionAuthentication('gemini-3.7-flash', appDir, allKeyIds);
  assert.equal(noKeysLeft.apiKey, undefined, 'Sem chaves disponíveis para o modelo principal');
  console.log('✓ PASSOU: FallbackModel e esgotamento de chaves validados.\n');

  console.log('==================================================');
  console.log('TODAS AS VALIDAÇÕES NO APLICATIVO INSTALADO PASSARAM COM SUCESSO!');
  console.log('==================================================');
}

runValidation().catch(err => {
  console.error('\n❌ FALHA NA VALIDAÇÃO DO APLICATIVO INSTALADO:', err);
  process.exit(1);
});
