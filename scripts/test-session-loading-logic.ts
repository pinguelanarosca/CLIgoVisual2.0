import { getMostRecentValidSession, isValidSessionId } from '../src/utils/sessionUtils.js';
import { SessionItem } from '../src/types.js';

function runTests() {
  console.log('=== TESTE DE LÓGICA DE CARREGAMENTO E RECUPERAÇÃO DE SESSÕES (App.tsx) ===\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${desc}`);
      failed++;
    }
  }

  // 1. Testes com listas vazias / nulas / indefinidas
  console.log('1. Casos Limítrofes (Null, Undefined, Vazio)');
  assert(getMostRecentValidSession(null) === null, 'Retorna null para lista null');
  assert(getMostRecentValidSession(undefined) === null, 'Retorna null para lista undefined');
  assert(getMostRecentValidSession([]) === null, 'Retorna null para lista vazia');
  assert(isValidSessionId('any-id', []) === false, 'isValidSessionId retorna false para lista vazia');
  assert(isValidSessionId(null, []) === false, 'isValidSessionId retorna false para id null');

  // 2. Ordenação cronológica pelo mais recente
  console.log('\n2. Ordenação Cronológica e Seleção da Mais Recente');
  const sampleSessions: SessionItem[] = [
    {
      id: 'sess-old',
      title: 'Conversa Antiga',
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:05:00.000Z',
      messageCount: 2,
      messages: [],
      statusGrade: 'CONFIGURED',
    },
    {
      id: 'sess-mid',
      title: 'Conversa Intermediária',
      createdAt: '2026-09-15T12:00:00.000Z',
      updatedAt: '2026-09-15T12:30:00.000Z',
      messageCount: 4,
      messages: [],
      statusGrade: 'CONFIGURED',
    },
    {
      id: 'sess-newest',
      title: 'Conversa Mais Recente',
      createdAt: '2026-09-29T18:00:00.000Z',
      updatedAt: '2026-09-29T19:45:00.000Z',
      messageCount: 6,
      messages: [],
      statusGrade: 'CONFIGURED',
    },
  ];

  const mostRecent = getMostRecentValidSession(sampleSessions);
  assert(mostRecent?.id === 'sess-newest', 'Seleciona corretamente sess-newest como a mais recente');

  // 3. Recuperação com identificador inválido excluído
  console.log('\n3. Recuperação Automática com Identificador Inválido Excluído');
  const invalidId = '522b42f4-00d8-44c6-9a0f-5c3669cdc81d';

  // Quando o identificador inválido nem sequer está na lista
  const fallbackWhenNotInList = getMostRecentValidSession(sampleSessions, invalidId);
  assert(
    fallbackWhenNotInList?.id === 'sess-newest',
    'Quando o id inválido não está na lista, seleciona a sessão válida mais recente (sess-newest)'
  );

  // Quando o identificador inválido é exatamente o sess-newest que acabou de falhar
  const fallbackWhenNewestFails = getMostRecentValidSession(sampleSessions, 'sess-newest');
  assert(
    fallbackWhenNewestFails?.id === 'sess-mid',
    'Quando a sessão mais recente é o identificador que falhou, retrocede para a próxima válida (sess-mid)'
  );

  // 4. Priorização de sessões não-arquivadas (ativas)
  console.log('\n4. Prioridade para Sessões Ativas (Não Arquivadas)');
  const sessionsWithArchived: SessionItem[] = [
    {
      id: 'sess-active-older',
      title: 'Sessão Ativa Anterior',
      updatedAt: '2026-09-20T10:00:00.000Z',
      createdAt: '2026-09-20T10:00:00.000Z',
      isArchived: false,
      messageCount: 1,
      messages: [],
      statusGrade: 'CONFIGURED',
    },
    {
      id: 'sess-archived-newer',
      title: 'Sessão Arquivada Recente',
      updatedAt: '2026-09-28T10:00:00.000Z',
      createdAt: '2026-09-28T10:00:00.000Z',
      isArchived: true,
      messageCount: 1,
      messages: [],
      statusGrade: 'CONFIGURED',
    },
  ];

  const activePriority = getMostRecentValidSession(sessionsWithArchived);
  assert(
    activePriority?.id === 'sess-active-older',
    'Prioriza sessão ativa (sess-active-older) mesmo se houver arquivada com data mais recente'
  );

  // Se todas forem arquivadas, deve usar a arquivada como fallback em vez de crash
  const onlyArchived: SessionItem[] = [
    {
      id: 'archived-1',
      title: 'Arquivada 1',
      updatedAt: '2026-09-10T10:00:00.000Z',
      createdAt: '2026-09-10T10:00:00.000Z',
      isArchived: true,
      messageCount: 1,
      messages: [],
      statusGrade: 'CONFIGURED',
    },
    {
      id: 'archived-2',
      title: 'Arquivada 2 (Mais Recente)',
      updatedAt: '2026-09-12T10:00:00.000Z',
      createdAt: '2026-09-12T10:00:00.000Z',
      isArchived: true,
      messageCount: 1,
      messages: [],
      statusGrade: 'CONFIGURED',
    },
  ];

  const archivedFallback = getMostRecentValidSession(onlyArchived);
  assert(
    archivedFallback?.id === 'archived-2',
    'Se todas as sessões estiverem arquivadas, usa a arquivada mais recente como fallback sem crash'
  );

  // 5. Robustez contra objetos corrompidos
  console.log('\n5. Robustez contra Dados Corrompidos / Malformados');
  const malformedList = [
    null as any,
    undefined as any,
    { id: '' } as any,
    { id: '   ' } as any,
    { noId: true } as any,
    {
      id: 'valid-sess',
      title: 'Sessão Válida',
      updatedAt: 'invalid-date',
      createdAt: '2026-09-10T00:00:00.000Z',
      messages: [],
      statusGrade: 'CONFIGURED',
    } as SessionItem,
  ];

  const resilient = getMostRecentValidSession(malformedList);
  assert(resilient?.id === 'valid-sess', 'Ignora itens malformados e seleciona a sessão válida sem crash');

  // 6. Simulação do Cenário do Usuário (Erro 5: "Invalid session identifier 522b42f4-00d8-44c6-9a0f-5c3669cdc81d")
  console.log('\n6. Simulação do Cenário Real do Usuário');
  const userRealSessions: SessionItem[] = [
    {
      id: 'f43be2d6-550b-4384-a934-460201d58e89',
      title: 'Refatoração da GUI',
      updatedAt: '2026-09-29T04:30:00.000Z',
      createdAt: '2026-09-29T04:00:00.000Z',
      messageCount: 0,
      messages: [],
      statusGrade: 'CONFIGURED',
    },
    {
      id: '522b42f4-00d8-44c6-9a0f-5c3669cdc81d', // Sessão que foi deletada ou não existe em chats/
      title: 'Sessão Inexistente no Disco',
      updatedAt: '2026-09-29T05:00:00.000Z',
      createdAt: '2026-09-29T05:00:00.000Z',
      messageCount: 0,
      messages: [],
      statusGrade: 'CONFIGURED',
    },
    {
      id: '1b85c05a-0e72-4626-8332-ac2e55f936e9',
      title: 'Chat Recente Válido',
      updatedAt: '2026-09-29T04:55:00.000Z',
      createdAt: '2026-09-29T04:10:00.000Z',
      messageCount: 0,
      messages: [],
      statusGrade: 'CONFIGURED',
    },
  ];

  // O usuário tenta carregar/retomar "522b42f4-00d8-44c6-9a0f-5c3669cdc81d", mas o CLI acusa erro
  const recoveryTarget = getMostRecentValidSession(userRealSessions, '522b42f4-00d8-44c6-9a0f-5c3669cdc81d');
  assert(
    recoveryTarget?.id === '1b85c05a-0e72-4626-8332-ac2e55f936e9',
    'Alterna automaticamente do identificador 522b42f4-... para a sessão válida mais recente (1b85c05a-...)'
  );

  console.log(`\nResultado dos Testes: ${passed} passaram, ${failed} falharam.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
