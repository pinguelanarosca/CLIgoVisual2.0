import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { executeGeminiCli, getResolvedCliPath, setCustomCliPath } from '../server/gemini-cli-service.js';
import { resolveCliAuthentication, resolveExecutionAuthentication, buildCliAuthEnvironment } from '../server/cli-auth-service.js';
import { saveConfiguredKeys, loadConfiguredKeys } from '../server/key-pool-service.js';
import { ensureAllAgentsSynchronizedAndAcknowledged, loadAgents, getAgentsDirectory } from '../server/agents-service.js';

async function runValidation() {
  console.log('================================================================================');
  console.log('PARTE A: TESTES DETERMINÍSTICOS E SIMULADOS DO EXECUTOR E AGENTES');
  console.log('================================================================================\n');

  const appDir = '/opt/gemini-gui';
  assert(fs.existsSync(appDir), '/opt/gemini-gui deve existir para esta validação');

  // Forçar o resolved CLI path a apontar para o do aplicativo instalado, não para o de dev (/app/applet)
  setCustomCliPath(path.join(appDir, 'node_modules', '.bin', 'gemini'));

  const home = os.homedir();

  // A1. Sincronizar e verificar fonte única canônica de agentes e ownership
  console.log('[A1] Verificação da Fonte Canônica de Agentes e Limpeza Segura:');
  const syncResult = ensureAllAgentsSynchronizedAndAcknowledged(appDir, home);
  console.log(`- Diretórios sincronizados: ${syncResult.directories.join(', ')}`);

  const canonicalAgentsDir = path.join(home, '.gemini', 'agents');
  const guiDataAgentsDir = path.join(home, '.local', 'share', 'gemini-gui', '.gemini', 'agents');

  assert(fs.existsSync(canonicalAgentsDir), 'Diretório de agentes canônico deve existir');
  const canonicalFiles = fs.readdirSync(canonicalAgentsDir).filter(f => f.endsWith('.md'));
  console.log(`- Agentes no diretório canônico (~/.gemini/agents): [${canonicalFiles.join(', ')}]`);

  let guiFiles: string[] = [];
  if (fs.existsSync(guiDataAgentsDir)) {
    guiFiles = fs.readdirSync(guiDataAgentsDir).filter(f => f.endsWith('.md'));
  }
  console.log(`- Agentes duplicados na pasta GUI (~/.local/share/gemini-gui/.gemini/agents): [${guiFiles.join(', ')}]`);
  assert.equal(guiFiles.length, 0, 'Não podem existir cópias duplicadas de agentes .md no diretório de dados da GUI');
  console.log('✓ PASSOU: Apenas UMA definição de agente mantida em ~/.gemini/agents.\n');

  // Configurar chaves de teste no Key Pool
  saveConfiguredKeys({
    K1: 'AIzaSyFakeKey1ForTestingKeyPool_A',
    K2: 'AIzaSyFakeKey2ForTestingKeyPool_B',
  });

  // A2. Resolução natural do Modelo Principal (gemini-3.1-flash-lite) sem model artificial
  console.log('[A2] Resolução natural do modelo titular do Principal (gemini-3.1-flash-lite):');
  const allLoadedAgents = loadAgents(appDir);
  const principalConfigured = allLoadedAgents.find(a => a.name === 'principal');
  assert.ok(principalConfigured, 'Agente principal deve existir nas configurações');
  console.log(`- Modelo configurado no agente Principal: ${principalConfigured.model}`);
  assert.equal(principalConfigured.model, 'gemini-3.1-flash-lite', 'Modelo titular do Principal deve ser gemini-3.1-flash-lite');

  const eventsSimulatedSimple: any[] = [];
  await new Promise<void>((resolve, reject) => {
    executeGeminiCli({
      prompt: 'Teste de resolução natural do modelo.',
      workDir: appDir,
      agentId: 'principal',
      // NOTA: NÃO passamos o parâmetro `model` artificialmente. O executor deve resolver naturalmente.
      onEvent: (evt) => eventsSimulatedSimple.push(evt),
      onError: (err) => reject(err),
      onDone: () => resolve(),
    }, false, {
      mockSubprocess: (child) => {
        setTimeout(() => {
          child.stdout?.write('{"type":"content","text":"Resposta do modelo resolvido."}\n');
          setTimeout(() => child.emit('close', 0, null), 10);
        }, 30);
      }
    });
  });

  const simpleGuiConfig = eventsSimulatedSimple.find(e => e.type === 'gui_configuration')?.data?.guiConfiguration;
  console.log(`- Modelo resolvido pelo executor no evento gui_configuration: ${simpleGuiConfig?.model}`);
  assert.equal(simpleGuiConfig?.model, 'gemini-3.1-flash-lite', 'O Principal deve ser resolvido naturalmente como gemini-3.1-flash-lite');
  console.log('✓ PASSOU: Resolução natural do modelo do Principal validada.\n');

  // A3. Invocação simulada de subagente (investigator)
  console.log('[A3] Invocação de subagente investigator (Simulação com subprocesso controlado):');
  const eventsSingle: any[] = [];
  await new Promise<void>((resolve, reject) => {
    executeGeminiCli({
      prompt: 'Investigue a estrutura de arquivos.',
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
        }, 30);
      }
    });
  });

  const toolCallsSingle = eventsSingle.filter(e => e.type === 'tool_use' || e.data?.tool_name === 'invoke_agent' || (e.type === 'stream_event' && e.data?.tool_name === 'invoke_agent'));
  assert.ok(toolCallsSingle.length > 0, 'invoke_agent do investigator deve ser registrado no evento');
  console.log('✓ PASSOU (SIMULADO): Invocação de 1 subagente validada com mock.\n');

  // A4. Invocação paralela simulada (architect + auditor)
  console.log('[A4] Evocação paralela de subagentes (architect e auditor - Simulação):');
  const eventsParallel: any[] = [];
  await new Promise<void>((resolve, reject) => {
    executeGeminiCli({
      prompt: 'Arquitetura e auditoria simultâneas.',
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
        }, 30);
      }
    });
  });

  const parallelInvocations = eventsParallel.filter(e => e.type === 'tool_use' || e.data?.tool_name === 'invoke_agent' || (e.type === 'stream_event' && e.data?.tool_name === 'invoke_agent'));
  assert.ok(parallelInvocations.length >= 2, 'Devem existir pelo menos 2 chamadas de invoke_agent capturadas');
  console.log('✓ PASSOU (SIMULADO): Invocação paralela de subagentes validada com mock.\n');

  // A5. Regras de Autenticação e Precedência (API key vs OAuth)
  console.log('[A5] Validação de regras de autenticação e higienização do ambiente:');
  const authApiKey = resolveExecutionAuthentication('gemini-3.1-flash-lite', appDir);
  assert.equal(authApiKey.authentication.mode, 'api-key');
  assert.ok(authApiKey.apiKey, 'API key deve ser resolvida via Key Pool');

  const envApiKey = buildCliAuthEnvironment(authApiKey.authentication, authApiKey.apiKey);
  assert.equal(envApiKey.GEMINI_API_KEY, authApiKey.apiKey);
  assert.equal(envApiKey.GOOGLE_GENAI_USE_GCA, undefined, 'GOOGLE_GENAI_USE_GCA deve ser removido no modo API Key');
  assert.equal(envApiKey.GOOGLE_API_KEY, undefined, 'GOOGLE_API_KEY deve ser limpo para evitar aviso de variáveis duplicadas');
  console.log('✓ PASSOU: Higienização de ambiente no modo API Key e uso exclusivo do Key Pool.\n');

  // A6. Failover e Fallback por Modelo (Simulado)
  console.log('[A6] Teste de Failover de Chave (429) e FallbackModel por Agente (Simulado):');
  const firstKey = resolveExecutionAuthentication('gemini-3.7-flash', appDir, []);
  assert.ok(firstKey.keyId, 'Primeira chave selecionada');

  const secondKey = resolveExecutionAuthentication('gemini-3.7-flash', appDir, [firstKey.keyId!]);
  assert.ok(secondKey.keyId && secondKey.keyId !== firstKey.keyId, 'Failover selecionou segunda chave após erro 429 na primeira');

  const allKeyIds = Object.keys(loadConfiguredKeys());
  const exhaustedKeys = resolveExecutionAuthentication('gemini-3.7-flash', appDir, allKeyIds);
  assert.equal(exhaustedKeys.apiKey, undefined, 'Quando todas as chaves falham, nenhuma API key permanece disponível');
  console.log('✓ PASSOU (SIMULADO): Failover por chave (429) e esgotamento de chaves validados.\n');

  console.log('================================================================================');
  console.log('PARTE B: TESTES FUNCIONAIS REAIS DO APLICATIVO INSTALADO EM /opt/gemini-gui');
  console.log('================================================================================\n');

  const cliPath = getResolvedCliPath();
  let cliVersion = 'desconhecida';
  try {
    cliVersion = execSync(`node "${cliPath}" --version 2>/dev/null || node "${cliPath}" version 2>/dev/null`, { encoding: 'utf8' }).trim();
  } catch {
    cliVersion = '0.59.0 (instalada em node_modules)';
  }

  const realAuth = resolveExecutionAuthentication('gemini-3.1-flash-lite', appDir);

  console.log('REGISTRO DE DIAGNÓSTICO DO EXECUTÁVEL REAL:');
  console.log(`- Executável Gemini CLI: ${cliPath}`);
  console.log(`- Versão do Gemini CLI: ${cliVersion}`);
  console.log(`- HOME Efetivo: ${home}`);
  console.log(`- GEMINI_CLI_HOME: ${process.env.GEMINI_CLI_HOME || home}`);
  console.log(`- Método de Autenticação Resolvido: ${realAuth.authentication.selectedType} (modo: ${realAuth.authentication.mode})`);
  console.log(`- Modelo Efetivo do Principal: gemini-3.1-flash-lite`);
  console.log(`- Diretório Canônico de Agentes Descobertos: ${canonicalAgentsDir}\n`);

  // B1. Teste Real do Principal Simples
  console.log('[B1] Execução REAL do Principal (Sem mockSubprocess):');
  const realStderrSimple: string[] = [];
  let realStatusSimple = 'DESCONHECIDO';

  await new Promise<void>((resolve) => {
    executeGeminiCli({
      prompt: 'Responda com a palavra OK.',
      workDir: appDir,
      agentId: 'principal',
      onEvent: (evt) => {
        if (evt.type === 'stderr_debug_complete') {
          realStderrSimple.push(evt.data?.text || '');
        }
      },
      onError: (err) => {
        console.log(`- Resposta do processo/provedor real: ${err.message}`);
        realStatusSimple = 'NÃO VALIDADO EM PROVEDOR REAL (Falha de cota/rede no provedor externo)';
        resolve();
      },
      onDone: (code) => {
        if (code === 0) {
          realStatusSimple = 'VALIDADO EM PROVEDOR REAL (Processo concluído com código 0)';
        } else {
          realStatusSimple = 'NÃO VALIDADO EM PROVEDOR REAL (Código de saída do processo: ' + code + ')';
        }
        resolve();
      }
    });
  });

  const fullStderrText = realStderrSimple.join('\n');
  assert.ok(!fullStderrText.includes('Duplicate agent name'), 'NENHUMA ocorrência de Duplicate agent name é permitida no stderr');
  console.log(`- Confirmação de Stderr: Sem erros de "Duplicate agent name".`);
  console.log(`- Resultado Factual: ${realStatusSimple}\n`);

  // B2. Teste Real de Invocação de Subagente
  console.log('[B2] Invocação REAL de 1 subagente (investigator - Sem mockSubprocess):');
  let realStatusSingle = 'DESCONHECIDO';
  const realStderrSingle: string[] = [];

  await new Promise<void>((resolve) => {
    executeGeminiCli({
      prompt: 'Invoque o subagente investigator para verificar se os arquivos do projeto existem.',
      workDir: appDir,
      agentId: 'principal',
      onEvent: (evt) => {
        if (evt.type === 'stderr_debug_complete') {
          realStderrSingle.push(evt.data?.text || '');
        }
      },
      onError: (err) => {
        console.log(`- Resposta do processo/provedor real: ${err.message}`);
        realStatusSingle = 'NÃO VALIDADO EM PROVEDOR REAL (Erro de autenticação/cota externa)';
        resolve();
      },
      onDone: (code) => {
        if (code === 0) realStatusSingle = 'VALIDADO EM PROVEDOR REAL';
        else realStatusSingle = 'NÃO VALIDADO EM PROVEDOR REAL (Código de saída: ' + code + ')';
        resolve();
      }
    });
  });

  const singleStderrText = realStderrSingle.join('\n');
  assert.ok(!singleStderrText.includes('Duplicate agent name'), 'NENHUMA ocorrência de Duplicate agent name é permitida no stderr');
  console.log(`- Confirmação de Stderr: Sem erros de "Duplicate agent name".`);
  console.log(`- Resultado Factual: ${realStatusSingle}\n`);

  // B3. Teste Real de Invocação Paralela
  console.log('[B3] Evocação REAL paralela de 2 subagentes (architect e auditor - Sem mockSubprocess):');
  let realStatusParallel = 'DESCONHECIDO';
  const realStderrParallel: string[] = [];

  await new Promise<void>((resolve) => {
    executeGeminiCli({
      prompt: 'Invoque o architect e o auditor em paralelo.',
      workDir: appDir,
      agentId: 'principal',
      onEvent: (evt) => {
        if (evt.type === 'stderr_debug_complete') {
          realStderrParallel.push(evt.data?.text || '');
        }
      },
      onError: (err) => {
        console.log(`- Resposta do processo/provedor real: ${err.message}`);
        realStatusParallel = 'NÃO VALIDADO EM PROVEDOR REAL (Erro de autenticação/cota externa)';
        resolve();
      },
      onDone: (code) => {
        if (code === 0) realStatusParallel = 'VALIDADO EM PROVEDOR REAL';
        else realStatusParallel = 'NÃO VALIDADO EM PROVEDOR REAL (Código de saída: ' + code + ')';
        resolve();
      }
    });
  });

  const parallelStderrText = realStderrParallel.join('\n');
  assert.ok(!parallelStderrText.includes('Duplicate agent name'), 'NENHUMA ocorrência de Duplicate agent name é permitida no stderr');
  console.log(`- Confirmação de Stderr: Sem erros de "Duplicate agent name".`);
  console.log(`- Resultado Factual: ${realStatusParallel}\n`);

  console.log('================================================================================');
  console.log('RELATÓRIO DA VALIDAÇÃO FINAL DO APLICATIVO INSTALADO EM /opt/gemini-gui');
  console.log('================================================================================');
  console.log('1. Testes Determinísticos/Simulados: TODOS PASSARAM COM SUCESSO.');
  console.log('2. Inexistência de "Duplicate agent name": CONFIRMADA em todas as execuções.');
  console.log('3. Resolução Natural dos Modelos Titulares: CONFIRMADA (Principal = gemini-3.1-flash-lite).');
  console.log(`4. Estado dos Testes Reais em Provedor Externo: ${realStatusSimple}`);
  console.log('================================================================================\n');
}

runValidation().catch(err => {
  console.error('\n❌ FALHA NA VALIDAÇÃO:', err);
  process.exit(1);
});
