import {
  exportFullSystemBackup,
  restoreSystemBackup,
  resetSystemToFactoryDefaults,
} from '../server/backup-reset-service.js';
import { loadAgents, saveAgentToFile } from '../server/agents-service.js';
import { getSessions, saveSession } from '../server/projects-and-dirs-service.js';
import { loadSkills } from '../server/skills-service.js';
import { loadCommands } from '../server/commands-service.js';
import { loadMcpSettings } from '../server/mcp-service.js';
import { loadPolicies } from '../server/policies-service.js';

console.log('🧪 Iniciando testes de verificação para Backup, Restauração e Padrões de Fábrica...');

async function runTests() {
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, desc: string) {
    total++;
    if (condition) {
      console.log(`  ✅ [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${desc}`);
      process.exit(1);
    }
  }

  // TEST 1: Export Full Backup
  console.log('\n--- 1. Testando Exportação de Backup Completo ---');
  const fullBackup = exportFullSystemBackup();
  assert(!!fullBackup, 'Backup gerado com sucesso');
  assert(fullBackup.version === '2.0.0', 'Versão do backup é 2.0.0');
  assert(Array.isArray(fullBackup.agents), 'Agentes incluídos no backup');
  assert(Array.isArray(fullBackup.skills), 'Skills incluídas no backup');
  assert(Array.isArray(fullBackup.commands), 'Comandos incluídos no backup');
  assert(Array.isArray(fullBackup.mcpServers), 'Servidores MCP incluídos no backup');
  assert(Array.isArray(fullBackup.policies), 'Políticas incluídas no backup');
  assert(fullBackup.metadata.exportedSections.length >= 8, 'Metadados contêm seções exportadas');

  // TEST 2: Export Selective Backup
  console.log('\n--- 2. Testando Exportação Seletiva de Backup ---');
  const selectiveBackup = exportFullSystemBackup(['agents', 'chatHistory']);
  assert(!!selectiveBackup.agents, 'Agentes presentes no backup seletivo');
  assert(Array.isArray(selectiveBackup.sessions), 'Sessões presentes no backup seletivo');
  assert(!selectiveBackup.skills, 'Skills ausentes no backup seletivo');
  assert(!selectiveBackup.commands, 'Comandos ausentes no backup seletivo');

  // TEST 3: Add Custom Data, Backup, Modify, Restore
  console.log('\n--- 3. Testando Ciclo de Backup -> Modificação -> Restauração ---');
  const testSessionId = `test_session_${Date.now()}`;
  saveSession({
    id: testSessionId,
    title: 'Sessão de Teste Automatizado',
    messages: [
      { id: '1', role: 'user', content: 'Olá mundo backup', timestamp: new Date().toISOString() },
      { id: '2', role: 'assistant', content: 'Resposta de teste backup', timestamp: new Date().toISOString() },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: 2,
    statusGrade: 'CONFIGURED',
  });

  const customAgentName = `custom_agent_test_${Date.now()}`;
  saveAgentToFile({
    id: customAgentName,
    name: customAgentName,
    displayName: 'Agente de Teste Backup',
    description: 'Agente criado para teste',
    role: 'Agente Especialista',
    systemInstructions: 'Prompt de teste de backup',
    model: 'gemini-2.5-flash',
    tools: ['*'],
    enabled: true,
    kind: 'local',
    statusGrade: 'CONFIGURED',
  });

  // Export state with custom data
  const customBackup = exportFullSystemBackup();
  assert(
    customBackup.sessions?.some((s) => s.id === testSessionId) ?? false,
    'Sessão personalizada incluída no backup'
  );
  assert(
    customBackup.agents?.some((a) => a.name === customAgentName) ?? false,
    'Agente personalizado incluído no backup'
  );

  // Overwrite with factory reset to test restoring
  console.log('\n--- 4. Testando Restauração de Padrões de Fábrica ---');
  const resetResult = resetSystemToFactoryDefaults();
  assert(resetResult.success, 'Reset de fábrica executado com sucesso');

  const postResetSessions = getSessions();
  const postResetAgents = loadAgents();
  assert(postResetSessions.length === 0, 'Histórico de chat limpo após reset de fábrica');
  assert(!postResetAgents.some((a) => a.name === customAgentName), 'Agente personalizado removido pelo reset');
  assert(postResetAgents.length > 0, 'Agentes padrão restaurados');

  // Restore the custom backup
  console.log('\n--- 5. Testando Restauração e Sobrescrita de Backup ---');
  const restoreRes = restoreSystemBackup(customBackup, {
    generalSettings: true,
    agents: true,
    chatHistory: true,
    skills: true,
    commands: true,
    mcpServers: true,
    policies: true,
    projects: true,
    authorizedDirs: true,
  });
  assert(restoreRes.success, 'Restauração de backup concluída com sucesso');

  const restoredSessions = getSessions();
  const restoredAgents = loadAgents();
  assert(
    restoredSessions.some((s) => s.id === testSessionId),
    'Sessão restaurada com sucesso a partir do backup'
  );
  assert(
    restoredAgents.some((a) => a.name === customAgentName),
    'Agente restaurado com sucesso a partir do backup'
  );

  // Clean up test session and reset to clean state
  resetSystemToFactoryDefaults();

  console.log(`\n🎉 Todos os ${passed}/${total} testes de Backup, Restauração e Reset de Fábrica passaram com sucesso!`);
}

runTests().catch((err) => {
  console.error('Erro fatal nos testes:', err);
  process.exit(1);
});
