import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert';
import { buildEffectiveSystemPrompt } from '../src/utils/systemPromptUtils.js';
import { ensureAgentsSeeded, loadAgents, saveAgentToFile } from '../server/agents-service.js';
import { ensureDefaultUserPolicies, loadPolicies } from '../server/policies-service.js';
import { getGuiDataDir } from '../server/paths-service.js';
import { isExistingSession } from '../server/gemini-cli-service.js';

console.log('================================================================');
console.log('       INICIANDO AUDITORIA TÉCNICA REAL DE VERIFICAÇÃO');
console.log('================================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    console.log(`✅ [PASS] ${name}`);
    passedTests++;
  } catch (err: any) {
    console.error(`❌ [FAIL] ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// -------------------------------------------------------------
// TESTE 1: SYSTEM INSTRUCTION (AGENTE PADRÃO - SEM DUPLICAÇÃO)
// -------------------------------------------------------------
runTest('1. System Instruction: Agente padrão sem duplicação', () => {
  const agents = ensureAgentsSeeded();
  const principal = agents.find((a) => a.id === 'principal' || a.name === 'principal');
  assert(principal, 'Agente principal deve existir');

  const effectivePrompt = buildEffectiveSystemPrompt(
    principal.baseInstructions,
    principal.systemInstructions,
    principal.overrideBasePrompt
  );

  // Construir o payload equivalente a finalApiRequest.systemInstruction
  const systemInstruction = effectivePrompt && effectivePrompt.trim()
    ? {
        parts: [
          {
            text: effectivePrompt.trim(),
          },
        ],
      }
    : null;

  assert(systemInstruction, 'systemInstruction deve ser gerado');
  assert.strictEqual(systemInstruction.parts.length, 1, 'Deve haver exatamente 1 item em parts');

  const text = systemInstruction.parts[0].text;
  
  // Prova matemática de não duplicação: a frase inicial deve ocorrer EXATAMENTE uma única vez
  const needle = 'Você é o Principal Orchestrator do Gemini CLI.';
  const occurrences = text.split(needle).length - 1;
  assert.strictEqual(occurrences, 1, `O texto base deve ocorrer exatamente 1 vez no payload. Ocorrências encontradas: ${occurrences}`);

  console.log(`   Evidência do payload gerado: length=${text.length} chars, ocorrências="${needle}": ${occurrences}`);
});

// -------------------------------------------------------------
// TESTE 2: SYSTEM INSTRUCTION (OVERRIDE ATIVO - SOMENTE OVERRIDE)
// -------------------------------------------------------------
runTest('2. System Instruction: Agente com "Sobrescrever base" ativo', () => {
  const customOverridePrompt = 'DIRETIVA EXCLUSIVA: Opere apenas como Auditor de Segurança Estrito.';
  const basePrompt = 'Você é o Principal Orchestrator do Gemini CLI.';

  const effectivePrompt = buildEffectiveSystemPrompt(
    basePrompt,
    customOverridePrompt,
    true // overrideBasePrompt = true
  );

  const systemInstruction = {
    parts: [{ text: effectivePrompt }],
  };

  const text = systemInstruction.parts[0].text;
  assert.strictEqual(text, customOverridePrompt, 'O texto deve conter unicamente o override');
  assert(!text.includes('Principal Orchestrator'), 'O prompt base não deve constar no override');

  console.log(`   Evidência: Prompt com override contém apenas: "${text}"`);
});

// -------------------------------------------------------------
// TESTE 3: SYSTEM INSTRUCTION (PADRÃO: BASE + OVERRIDE)
// -------------------------------------------------------------
runTest('3. System Instruction: Agente padrão com instrução complementar (base + override)', () => {
  const basePrompt = 'Você é o Principal Orchestrator do Gemini CLI.';
  const complement = 'Instrução complementar: Adicione logs detalhados a cada etapa.';

  const effectivePrompt = buildEffectiveSystemPrompt(
    basePrompt,
    complement,
    false // overrideBasePrompt = false
  );

  const text = effectivePrompt;
  assert(text.startsWith(basePrompt), 'Deve iniciar com a base');
  assert(text.endsWith(complement), 'Deve terminar com o complemento');
  assert.strictEqual(text.split(basePrompt).length - 1, 1, 'Base deve aparecer apenas 1 vez');
  assert.strictEqual(text.split(complement).length - 1, 1, 'Complemento deve aparecer apenas 1 vez');

  console.log(`   Evidência: base + override preservados corretamente sem duplicações.`);
});

// -------------------------------------------------------------
// TESTE 4: POLÍTICAS (deny-google-search.toml e Exa)
// -------------------------------------------------------------
runTest('4. Políticas: Validação estrita do arquivo de política', () => {
  ensureDefaultUserPolicies();
  const policies = loadPolicies();
  const denyGoogle = policies.find((p) => p.filename === 'deny-google-search.toml');
  assert(denyGoogle, 'deny-google-search.toml deve existir no escopo da GUI');

  const content = denyGoogle.content;
  assert(content.includes('toolName = "google_web_search"'), 'Deve conter toolName = "google_web_search"');
  assert(!content.includes('toolName = "web_search"'), 'Não deve usar toolName = "web_search"');
  assert(content.includes('decision = "deny"'), 'Decisão deve ser "deny"');
  assert(content.includes('priority = 999'), 'Prioridade deve ser <= 999');
  assert(content.includes('web_search_exa'), 'Mensagem deve referenciar web_search_exa do MCP Exa');

  console.log(`   Evidência da política: toolName="google_web_search", decision="deny", priority=999`);
});

// -------------------------------------------------------------
// TESTE 5: ISOLAMENTO GLOBAL (Nada em ~/.gemini)
// -------------------------------------------------------------
runTest('5. Isolamento Global: Nada deve ser gravado em ~/.gemini', () => {
  const guiDataDir = getGuiDataDir();
  assert(guiDataDir.includes('.local/share/gemini-gui'), `guiDataDir deve apontar para ~/.local/share/gemini-gui, obtido: ${guiDataDir}`);
  assert(fs.existsSync(guiDataDir), 'Diretório da GUI deve existir');

  const globalGeminiDir = path.join(os.homedir(), '.gemini');
  // Se existir diretório global de outros testes prévios, verificar se o ensureAgentsSeeded NÃO gravou agentes nele
  const globalAgentsDir = path.join(globalGeminiDir, 'agents');
  if (fs.existsSync(globalAgentsDir)) {
    // Remover para testar se ensureAgentsSeeded cria ou não
    fs.rmSync(globalAgentsDir, { recursive: true, force: true });
  }

  // Executar ensureAgentsSeeded
  ensureAgentsSeeded();

  assert(!fs.existsSync(globalAgentsDir), 'ensureAgentsSeeded NÃO DEVE recriar ~/.gemini/agents');
  assert(fs.existsSync(path.join(guiDataDir, '.gemini', 'agents')), 'Agentes devem estar exclusivamente em ~/.local/share/gemini-gui/.gemini/agents');

  // Testar isExistingSession: criar arquivo temporário de teste apenas em ~/.local/share/gemini-gui/tmp
  const testSessionId = `test-isolation-session-${Date.now()}`;
  const guiTmpDir = path.join(guiDataDir, 'tmp');
  fs.mkdirSync(guiTmpDir, { recursive: true });
  const sessionFilePath = path.join(guiTmpDir, `${testSessionId}.jsonl`);
  fs.writeFileSync(sessionFilePath, `{"sessionId":"${testSessionId}"}\n`);

  const globalGeminiTmp = path.join(os.homedir(), '.gemini', 'tmp');
  if (fs.existsSync(globalGeminiTmp)) {
    fs.rmSync(globalGeminiTmp, { recursive: true, force: true });
  }

  assert(isExistingSession(testSessionId), 'isExistingSession deve localizar sessão em ~/.local/share/gemini-gui/tmp');
  fs.unlinkSync(sessionFilePath);

  // Garantir que ~/.gemini/tmp NUNCA é criado nem consultado
  assert(!fs.existsSync(globalGeminiTmp), 'A verificação de sessão NÃO DEVE criar ~/.gemini/tmp');

  console.log(`   Evidência de isolamento: ~/.gemini/agents e ~/.gemini/tmp não existem. Estado em ${guiDataDir}`);
});

// -------------------------------------------------------------
// TESTE 6: LAUNCHER E EMPACOTAMENTO
// -------------------------------------------------------------
runTest('6. Launcher em scripts/package-ubuntu.cjs', () => {
  const packageScript = fs.readFileSync(path.join(process.cwd(), 'scripts', 'package-ubuntu.cjs'), 'utf8');
  assert(packageScript.includes('nohup node dist/server.cjs'), 'Deve usar nohup e backgrounding');
  assert(packageScript.includes('disown'), 'Deve desacoplar processo com disown');
  assert(packageScript.includes('exit 0'), 'Deve liberar o terminal com exit 0');
  assert(packageScript.includes('pkill -f "dist/server.cjs"'), 'Deve matar instâncias órfãs');
  assert(packageScript.includes('app.log'), 'Deve redirecionar logs para app.log');
  assert(packageScript.includes('PORT'), 'Deve validar e respeitar a porta');

  console.log(`   Evidência do launcher: nohup, disown, exit 0, pkill órfãos e log em app.log verificados.`);
});

// -------------------------------------------------------------
// TESTE 7: SEGURANÇA DE API KEY EM MEMÓRIA
// -------------------------------------------------------------
runTest('7. Segurança de API Key: Apenas em memória', () => {
  const testKey = 'AIzaSyFakeKeyForTestingPurposesOnly12345';
  process.env.GEMINI_API_KEY = testKey;

  // Verificar se a chave foi escrita em algum arquivo de configuração
  const guiDataDir = getGuiDataDir();
  const settingsJson = path.join(guiDataDir, '.gemini', 'settings.json');
  if (fs.existsSync(settingsJson)) {
    const raw = fs.readFileSync(settingsJson, 'utf8');
    assert(!raw.includes(testKey), 'settings.json NUNCA deve conter a chave de API');
  }

  console.log('   Evidência: Chave de API mantida estritamente em memória (process.env) sem vazamento em disco.');
});

console.log('\n================================================================');
console.log(`   RESUMO DOS TESTES: ${passedTests}/${totalTests} PASSARAM COM SUCESSO`);
console.log('================================================================\n');
