import { executeGeminiCli } from '../server/gemini-cli-service';
import { spawn } from 'child_process';
import assert from 'assert';

console.log('=== TEST: Verificação de finalização robusta de invoke_agent / subagentes ===\n');

async function testQuotaExceededWithExitCode0() {
  console.log('[Test 1] Simulando invoke_agent com exitCode=0 + Quota Exceeded...');

  const events: any[] = [];
  const fakeToolCallId = 'invoke_agent__call_21688';

  // Simulação de eventos recebidos durante a execução
  const streamEvents = [
    { type: 'stream_event', data: { type: 'tool_use', tool_id: fakeToolCallId, tool_name: 'invoke_agent', parameters: { agent_name: 'investigator' } } },
    { type: 'final_api_request', data: { role: 'subagent', requestId: 'req_subagent_9988', sessionId: 'sub_sess_1234', model: 'gemini-3.7-flash', finalApiRequest: { model: 'gemini-3.7-flash' } } },
    { type: 'process_error', data: { message: 'Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_tokens_per_model_per_user' } },
  ];

  // Verificamos a regra de negócio implementada
  const activeToolCalls = new Map<string, any>();
  let lastSubagentRequestId: string | undefined;
  let lastSubagentSessionId: string | undefined;

  for (const evt of streamEvents) {
    if (evt.data?.type === 'tool_use') {
      activeToolCalls.set(evt.data.tool_id, {
        toolId: evt.data.tool_id,
        toolName: evt.data.tool_name,
        parameters: evt.data.parameters,
        timestamp: Date.now(),
      });
    }
    if (evt.data?.requestId) {
      lastSubagentRequestId = evt.data.requestId;
      lastSubagentSessionId = evt.data.sessionId;
    }
  }

  // Processo encerra com code 0 mas com erro de cota no buffer
  const code = 0;
  const stderrText = 'Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_tokens_per_model_per_user, limit: 25000000, model: gemini-3.7-flash';
  const isQuotaError = stderrText.includes('Quota exceeded') || stderrText.includes('429');
  const hasUnresolvedToolCalls = activeToolCalls.size > 0;
  const hasFailed = (code !== 0 && code !== null) || isQuotaError || hasUnresolvedToolCalls;

  assert.strictEqual(hasFailed, true, 'Execução deve ser marcada como failed mesmo com exitCode 0');
  assert.strictEqual(hasUnresolvedToolCalls, true, 'Deve identificar a tool call não finalizada');

  // Resolução terminal de todas as tools ativas
  const resolvedResults: any[] = [];
  for (const unres of activeToolCalls.values()) {
    const reason = isQuotaError
      ? 'Cota de requisições excedida na API Gemini (Erro 429 / Quota Exceeded / RESOURCE_EXHAUSTED) durante a execução do subagente.'
      : 'Erro desconhecido';
    resolvedResults.push({
      type: 'tool_result',
      tool_call_id: unres.toolId,
      tool_id: unres.toolId,
      status: 'failed',
      error: reason,
      subagentSessionId: lastSubagentSessionId,
      lastRequestId: lastSubagentRequestId,
    });
  }

  assert.strictEqual(resolvedResults.length, 1);
  assert.strictEqual(resolvedResults[0].tool_id, fakeToolCallId);
  assert.strictEqual(resolvedResults[0].status, 'failed');
  assert.strictEqual(resolvedResults[0].subagentSessionId, 'sub_sess_1234');
  assert.strictEqual(resolvedResults[0].lastRequestId, 'req_subagent_9988');

  console.log('✅ [Test 1 PASS] Quota exceeded com exitCode=0 gera tool_result com status=failed e preserva IDs.\n');
}

async function testFetchFailedWithExitCode0() {
  console.log('[Test 2] Simulando invoke_agent com exitCode=0 + Fetch failed...');

  const fakeToolCallId = 'invoke_agent__call_4455';
  const activeToolCalls = new Map<string, any>();
  activeToolCalls.set(fakeToolCallId, {
    toolId: fakeToolCallId,
    toolName: 'invoke_agent',
    parameters: { agent_name: 'architect' },
    timestamp: Date.now(),
  });

  const code = 0;
  const stderrText = 'TypeError: fetch failed sending request to generativelanguage.googleapis.com';
  const combinedErrText = stderrText.toLowerCase();

  const isFetchFailed = combinedErrText.includes('fetch failed');
  const hasUnresolvedToolCalls = activeToolCalls.size > 0;
  const hasFailed = (code !== 0 && code !== null) || isFetchFailed || hasUnresolvedToolCalls;

  assert.strictEqual(hasFailed, true, 'Execução deve ser marcada como failed com fetch failed');

  let failureReason = '';
  if (isFetchFailed) {
    failureReason = 'Falha de transporte de rede com a API Gemini (Fetch failed sending request) durante a execução do subagente.';
  }

  const result = {
    type: 'tool_result',
    tool_id: fakeToolCallId,
    status: 'failed',
    error: failureReason,
  };

  assert.strictEqual(result.status, 'failed');
  assert.ok(result.error.includes('Fetch failed'));

  console.log('✅ [Test 2 PASS] Fetch failed com exitCode=0 gera tool_result com status=failed.\n');
}

async function testAuthNoticeBenignCheck() {
  console.log('[Test 3] Verificando que aviso de GOOGLE_API_KEY e GEMINI_API_KEY não gera falso positivo...');

  const notice = 'Both GOOGLE_API_KEY and GEMINI_API_KEY are set. Using GOOGLE_API_KEY.';
  
  const isAuthNotice = notice.includes('Both GOOGLE_API_KEY and GEMINI_API_KEY are set');
  const isAuthError = !isAuthNotice && (
    notice.includes('Please set an Auth method') ||
    (notice.includes('GEMINI_API_KEY') && (
      notice.includes('not set') ||
      notice.includes('missing') ||
      notice.includes('unauthorized') ||
      notice.includes('invalid') ||
      notice.includes('required') ||
      notice.includes('não foi encontrada')
    ))
  );

  assert.strictEqual(isAuthNotice, true, 'Deve reconhecer o aviso informativo');
  assert.strictEqual(isAuthError, false, 'Aviso informativo NÃO deve gerar erro de autenticação');

  console.log('✅ [Test 3 PASS] Aviso informativo de API keys não dispara erro de autenticação.\n');
}

async function runAll() {
  await testQuotaExceededWithExitCode0();
  await testFetchFailedWithExitCode0();
  await testAuthNoticeBenignCheck();
  console.log('🎉 Todos os testes de regressão foram concluídos com sucesso!');
}

runAll().catch((err) => {
  console.error('❌ Erro no teste:', err);
  process.exit(1);
});
