import {
  classifyToolActivity,
  generateActivityTitle,
  normalizeActivities,
} from '../src/utils/activityTraceUtils.js';
import { ToolCallStep } from '../src/types.js';

console.log('🧪 Iniciando Bateria de Testes do Activity Trace / Execution Timeline...\n');

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, testName: string, details?: any) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${testName}`, details || '');
  }
}

// =========================================================================
// TESTE 1: Leitura de Arquivo Real
// =========================================================================
console.log('--- Teste 1: Leitura de Arquivo (view_file) ---');
const fileReadTool: ToolCallStep = {
  id: 'call_read_1',
  toolName: 'view_file',
  parameters: { AbsolutePath: '/src/App.tsx' },
  status: 'completed',
  timestamp: '2026-09-22T02:00:00.000Z',
  startedAt: 1000,
  completedAt: 1150,
  durationMs: 150,
  result: 'File content 1-100 lines...',
};
const activities1 = normalizeActivities({
  toolCalls: [fileReadTool],
  isStreaming: false,
});
assert(activities1.length === 1, 'Normalizou exatamente 1 atividade');
assert(activities1[0].type === 'file_read', 'Classificou como file_read');
assert(activities1[0].filePath === '/src/App.tsx', 'Extraiu caminho do arquivo real');
assert(activities1[0].title === "Leu arquivo 'App.tsx'", `Título correto: "${activities1[0].title}"`);
assert(activities1[0].durationMs === 150, 'Preservou duração real de 150ms');

// =========================================================================
// TESTE 2: Execução de Comando Shell Real
// =========================================================================
console.log('\n--- Teste 2: Execução de Comando Shell (run_command) ---');
const cmdTool: ToolCallStep = {
  id: 'call_cmd_1',
  toolName: 'run_command',
  parameters: { CommandLine: 'npm run build', Cwd: '.' },
  status: 'completed',
  timestamp: '2026-09-22T02:00:01.000Z',
  startedAt: 2000,
  completedAt: 3200,
  durationMs: 1200,
  result: 'Build succeeded in 1.2s',
};
const activities2 = normalizeActivities({
  toolCalls: [cmdTool],
  isStreaming: false,
});
assert(activities2.length === 1, 'Normalizou comando');
assert(activities2[0].type === 'command', 'Classificou como command');
assert(activities2[0].command === 'npm run build', 'Extraiu CommandLine real');
assert(activities2[0].title === 'Executou comando `npm run build`', `Título: "${activities2[0].title}"`);
assert(activities2[0].result === 'Build succeeded in 1.2s', 'Preservou resultado real');

// =========================================================================
// TESTE 3: Edição de Arquivo Real
// =========================================================================
console.log('\n--- Teste 3: Edição de Arquivo (edit_file) ---');
const editTool: ToolCallStep = {
  id: 'call_edit_1',
  toolName: 'edit_file',
  parameters: { TargetFile: '/src/components/ChatView.tsx', Instruction: 'Update layout' },
  status: 'completed',
  timestamp: '2026-09-22T02:00:02.000Z',
  startedAt: 4000,
  completedAt: 4400,
  durationMs: 400,
  result: 'Successfully applied changes',
};
const activities3 = normalizeActivities({
  toolCalls: [editTool],
  isStreaming: false,
});
assert(activities3.length === 1, 'Normalizou edição');
assert(activities3[0].type === 'file_edit', 'Classificou como file_edit');
assert(activities3[0].filePath === '/src/components/ChatView.tsx', 'Extraiu TargetFile real');
assert(activities3[0].title === "Editou arquivo 'ChatView.tsx'", `Título: "${activities3[0].title}"`);

// =========================================================================
// TESTE 4: Busca Web Exa (Access Search Web) - SEM DESALINHAMENTO
// =========================================================================
console.log('\n--- Teste 4: Busca Web Exa (Verificação de não desalinhamento) ---');
const exaTool: ToolCallStep = {
  id: 'call_exa_1',
  toolName: 'access search web',
  parameters: { query: 'latest gemini 2.5 flash release notes' },
  status: 'completed',
  timestamp: '2026-09-22T02:00:03.000Z',
  startedAt: 5000,
  completedAt: 5800,
  durationMs: 800,
  result: 'Found 5 web sources with details...',
};
const activities4 = normalizeActivities({
  toolCalls: [exaTool],
  isStreaming: false,
});
assert(activities4.length === 1, 'Normalizou busca Exa');
assert(activities4[0].type === 'web_search', 'Classificou estritamente como web_search (NÃO confundido com file_read)');
assert(activities4[0].searchQuery === 'latest gemini 2.5 flash release notes', 'Extraiu query de busca real');
assert(activities4[0].title.includes('Busca Web via Exa'), `Título contextual: "${activities4[0].title}"`);

// =========================================================================
// TESTE 5: Delegação de Subagente (invoke_agent)
// =========================================================================
console.log('\n--- Teste 5: Delegação para Subagente (invoke_agent) ---');
const invokeAgentTool: ToolCallStep = {
  id: 'call_agent_1',
  toolName: 'invoke_agent',
  parameters: { targetAgent: 'CodeArchitect', prompt: 'Review system design' },
  status: 'completed',
  timestamp: '2026-09-22T02:00:04.000Z',
  startedAt: 6000,
  completedAt: 7500,
  durationMs: 1500,
  result: 'Architecture reviewed and approved',
};
const activities5 = normalizeActivities({
  toolCalls: [invokeAgentTool],
  isStreaming: false,
});
assert(activities5.length === 1, 'Normalizou invoke_agent');
assert(activities5[0].type === 'invoke_agent', 'Classificou como invoke_agent');
assert(activities5[0].targetAgent === 'CodeArchitect', 'Extraiu subagente alvo');
assert(activities5[0].title === "Delegação para o agente 'CodeArchitect' concluída", `Título: "${activities5[0].title}"`);

// =========================================================================
// TESTE 6: Evento de Thinking com Duração (Sem expor pensamento privado)
// =========================================================================
console.log('\n--- Teste 6: Thinking / Raciocínio com Duração ---');
const rawEventsWithThinking = [
  { type: 'agent_thought_chunk', thought_level: 'high', timestamp: '2026-09-22T02:00:00.000Z' },
  { type: 'result', stats: { thoughtDurationMs: 2400, thoughtTokens: 180 } },
];
const activities6 = normalizeActivities({
  rawEvents: rawEventsWithThinking,
  isStreaming: false,
});
const thinkingAct = activities6.find((a) => a.type === 'thinking');
assert(Boolean(thinkingAct), 'Identificou evento de thinking');
assert(thinkingAct?.title === 'Raciocínio concluído (2.4s)', `Título do thinking com duração: "${thinkingAct?.title}"`);
assert(thinkingAct?.durationMs === 2400, 'Duração de 2.4s preservada');
assert(thinkingAct?.result === undefined, 'Nunca expôs cadeia de pensamento privada');

// =========================================================================
// TESTE 7: Tratamento de Erro Real do Runtime
// =========================================================================
console.log('\n--- Teste 7: Erro Real do Runtime ---');
const errorTool: ToolCallStep = {
  id: 'call_err_1',
  toolName: 'run_command',
  parameters: { CommandLine: 'cat non_existent_file.txt' },
  status: 'failed',
  timestamp: '2026-09-22T02:00:05.000Z',
  error: 'cat: non_existent_file.txt: No such file or directory',
};
const activities7 = normalizeActivities({
  toolCalls: [errorTool],
  isStreaming: false,
});
assert(activities7.length === 1, 'Normalizou tool com erro');
assert(activities7[0].status === 'failed', 'Status marcado como failed');
assert(activities7[0].error === 'cat: non_existent_file.txt: No such file or directory', 'Preservou mensagem exata do erro');

// =========================================================================
// TESTE 8: Cancelamento Real (SIGINT)
// =========================================================================
console.log('\n--- Teste 8: Cancelamento Real (SIGINT) ---');
const rawEventsCancel = [
  { type: 'cancelled', signal: 'SIGINT', timestamp: '2026-09-22T02:05:00.000Z' },
];
const activities8 = normalizeActivities({
  rawEvents: rawEventsCancel,
  isStreaming: false,
});
const cancelAct = activities8.find((a) => a.type === 'cancelled');
assert(Boolean(cancelAct), 'Identificou evento de cancelamento');
assert(cancelAct?.status === 'cancelled', 'Status cancelled');
assert(cancelAct?.title === 'Execução cancelada pelo usuário', `Título: "${cancelAct?.title}"`);

// =========================================================================
// TESTE 9: Camada 1 - Ação REAL em execução no momento
// =========================================================================
console.log('\n--- Teste 9: Camada 1 - Ação REAL em execução ---');
const runningTool: ToolCallStep = {
  id: 'call_active_1',
  toolName: 'edit_file',
  parameters: { TargetFile: '/src/types.ts' },
  status: 'running',
  timestamp: '2026-09-22T02:00:06.000Z',
};
const activitiesRunning = normalizeActivities({
  toolCalls: [fileReadTool, runningTool],
  isStreaming: true,
});
const activeAction = activitiesRunning.find((a) => a.status === 'running');
assert(Boolean(activeAction), 'Camada 1 identificou ação em execução');
assert(activeAction?.title === "Editando arquivo 'types.ts'...", `Título da ação em andamento: "${activeAction?.title}"`);

// =========================================================================
// RESULTADO FINAL
// =========================================================================
console.log(`\n======================================================`);
console.log(`Relatório Final: ${passedTests}/${totalTests} testes passaram com sucesso!`);
if (passedTests === totalTests) {
  console.log('🎉 Todos os testes unitários e de integração passaram perfeitamente!');
} else {
  console.error('❌ Falhas encontradas nos testes.');
  process.exit(1);
}
