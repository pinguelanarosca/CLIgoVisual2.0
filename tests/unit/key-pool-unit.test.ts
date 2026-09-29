import {
  classifyKeyResult,
  GROUP_PRIORITY,
  KeyGroup,
  OFFICIAL_POOL_MODELS,
} from '../../server/key-pool-service.js';

function runUnitTests() {
  console.log('====================================================');
  console.log('  KEY POOL UNIT TESTS (Classification & Sorting)');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, message: string) {
    total++;
    if (!condition) {
      console.error(`❌ FAIL: ${message}`);
      throw new Error(`Unit Test Failed: ${message}`);
    }
    passed++;
    console.log(`✓ PASS: ${message}`);
  }

  // 1. Classification G1
  assert(classifyKeyResult(200, null, 'OK').group === 'G1', '200 OK deve ser G1');
  assert(classifyKeyResult(null, null, '').group === 'G1', 'Sem erro/status deve ser G1');

  // 2. Classification G2 (Sobrecarga / 529)
  assert(classifyKeyResult(529, null, 'Overloaded').group === 'G2', '529 Overloaded deve ser G2');
  assert(classifyKeyResult(null, null, 'Model overloaded').group === 'G2', 'Mensagem "model overloaded" deve ser G2');

  // 3. Classification G3 (Rate limit / Quota / 429)
  assert(classifyKeyResult(429, null, 'Quota exceeded').group === 'G3', '429 Rate limit deve ser G3');
  assert(classifyKeyResult(null, null, 'RESOURCE_EXHAUSTED').group === 'G3', 'RESOURCE_EXHAUSTED deve ser G3');

  // 4. Classification G4 (5xx Infraestrutura)
  assert(classifyKeyResult(500, null, 'Internal server error').group === 'G4', '500 deve ser G4');
  assert(classifyKeyResult(503, null, 'Service unavailable').group === 'G4', '503 deve ser G4');

  // 5. Classification G5 (Auth / 401 / 403 / API_KEY_INVALID)
  assert(classifyKeyResult(401, null, 'Unauthenticated').group === 'G5', '401 deve ser G5');
  assert(classifyKeyResult(403, null, 'Forbidden').group === 'G5', '403 deve ser G5');
  assert(classifyKeyResult(400, null, 'API key not valid. Please pass a valid API key.').group === 'G5', 'API key not valid deve ser G5');

  // 6. Classification G6 (400 / 404 Parâmetro / Incompatível)
  assert(classifyKeyResult(400, null, 'invalid_argument: unknown field').group === 'G6', '400 invalid_argument sem auth deve ser G6');
  assert(classifyKeyResult(404, null, 'Model not found').group === 'G6', '404 not found deve ser G6');

  // 7. Group priorities
  assert(GROUP_PRIORITY['G1'] < GROUP_PRIORITY['G2'], 'G1 prioridade maior que G2');
  assert(GROUP_PRIORITY['G2'] < GROUP_PRIORITY['G3'], 'G2 prioridade maior que G3');
  assert(GROUP_PRIORITY['G3'] < GROUP_PRIORITY['G4'], 'G3 prioridade maior que G4');
  assert(GROUP_PRIORITY['G4'] < GROUP_PRIORITY['G5'], 'G4 prioridade maior que G5');
  assert(GROUP_PRIORITY['G5'] < GROUP_PRIORITY['G6'], 'G5 prioridade maior que G6');

  // 8. Official Models Array
  assert(OFFICIAL_POOL_MODELS.length >= 8, 'Deve conter pelo menos 8 modelos oficiais');
  assert(OFFICIAL_POOL_MODELS.includes('gemini-3.5-flash-lite'), 'Contém gemini-3.5-flash-lite');

  console.log(`\n====================================================`);
  console.log(`  UNIT TESTS COMPLETED: ${passed}/${total} PASSED`);
  console.log(`====================================================\n`);
}

runUnitTests();
