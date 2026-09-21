import 'dotenv/config';
import { discoverApiKeyFromLoginEnv } from './server/env-discovery.js';
discoverApiKeyFromLoginEnv();
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer as createViteServer } from 'vite';
import { getGuiDataDir } from './server/paths-service.js';

// Safe directory resolution compatible with both CommonJS (compiled dist/server.cjs) and ESM (tsx)
const getAppDir = (): string => {
  try {
    if (typeof __dirname !== 'undefined' && __dirname) {
      return __dirname;
    }
  } catch {}
  return process.cwd();
};

// Attempt to load .env from fallback locations if process.env.GEMINI_API_KEY is not set
const fallbackEnvPaths = [
  path.join(process.cwd(), '.env'),
  path.join(getGuiDataDir(), '.env'),
  '/opt/gemini-gui/.env',
];
for (const envFile of fallbackEnvPaths) {
  if (fs.existsSync(envFile)) {
    try {
      const raw = fs.readFileSync(envFile, 'utf-8');
      for (const line of raw.split('\n')) {
        const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)?\s*$/);
        if (match && !process.env[match[1]]) {
          process.env[match[1]] = (match[2] || '').trim().replace(/^['"]|['"]$/g, '');
        }
      }
    } catch {}
  }
}
import { detectCliStatus, executeGeminiCli, cancelActiveExecution, cancelExecutionById, setCustomCliPath, validateGeminiApiKey } from './server/gemini-cli-service.js';
import { ensureAgentsSeeded, loadAgents, saveAgentToFile, deleteAgent, resetAllAgentsToDefault } from './server/agents-service.js';
import { ensureSkillsSeeded, loadSkills, saveSkillToFile, deleteSkill } from './server/skills-service.js';
import { ensureCommandsSeeded, loadCommands, saveCommandToFile, deleteCommand } from './server/commands-service.js';
import { loadMcpSettings, saveMcpSettings, testMcpServer } from './server/mcp-service.js';
import { loadPolicies, savePolicy, deletePolicy, renamePolicy, syncPoliciesToSettings, ensureDefaultUserPolicies } from './server/policies-service.js';
import {
  getAuthorizedDirs,
  addAuthorizedDir,
  removeAuthorizedDir,
  getProjects,
  createProject,
  updateProject,
  deleteProject,
  getSessions,
  saveSession,
  deleteSession,
  inspectFilesAndDiffs,
  readFileContent,
  readFileContentAsync,
} from './server/projects-and-dirs-service.js';
import { checkAudioModelsAvailability, transcribeAudio, synthesizeSpeech } from './server/audio-service.js';
import { getSystemValidationMatrix, buildPackagingArtifacts } from './server/packaging-service.js';
import {
  getGitStatus,
  checkRemoteGitUpdates,
  performGitUpdate,
  generateManualUpdateCommands,
  performRebuild,
  scheduleServerRestart,
  DEFAULT_GIT_REPO_URL,
  DEFAULT_GIT_BRANCH,
} from './server/git-updater-service.js';
import {
  sysLog,
  getLogs,
  clearLogs,
  exportLogsText,
  registerSseClient,
  addLog,
} from './server/logger-service.js';
import {
  exportFullSystemBackup,
  restoreSystemBackup,
  resetSystemToFactoryDefaults,
} from './server/backup-reset-service.js';
import { sendError } from './server/error-service.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = process.env.HOST || '127.0.0.1';

async function startServer() {
  const app = express();

  // Generous limit for audio base64 uploads
  app.use(express.json({ limit: '25mb' }));

  // Request logger middleware for API operations
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') && req.path !== '/api/logs/stream') {
      const start = Date.now();
      const originalEnd = res.end;
      res.end = function (...args: any[]) {
        const duration = Date.now() - start;
        const isSpammy = req.path === '/api/logs' && req.method === 'GET';
        if (!isSpammy) {
          const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
          sysLog[level](
            'API',
            `HTTP ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`,
            { statusCode: res.statusCode, durationMs: duration }
          );
        }
        return originalEnd.apply(res, args);
      } as any;
    }
    next();
  });

  // Seed default agents, skills, commands, MCP, policies
  ensureAgentsSeeded();
  ensureSkillsSeeded();
  ensureCommandsSeeded();
  loadMcpSettings();
  ensureDefaultUserPolicies();
  syncPoliciesToSettings();

  // Seed custom web preview policy to prevent tool blocks in headless/preview mode
  try {
    const geminiDir = path.join(getGuiDataDir(), '.gemini');
    if (!fs.existsSync(geminiDir)) {
      fs.mkdirSync(geminiDir, { recursive: true });
    }
    const policyFile = path.join(geminiDir, 'web-preview-policy.toml');
    if (!fs.existsSync(policyFile)) {
      const policyContent = `# Web Preview Environment Policy to allow essential development tools in headless execution.
# This prevents tools from being blocked by default non-interactive / headless checks.

[[rule]]
toolName = [
  "replace",
  "run_shell_command",
  "write_file",
  "activate_skill",
  "web_fetch"
]
decision = "allow"
priority = 90
`;
      fs.writeFileSync(policyFile, policyContent, 'utf8');
      sysLog.info('SYSTEM', 'Política de visualização web (.gemini/web-preview-policy.toml) semeada com sucesso.');
    }
  } catch (err: any) {
    console.error('Falha ao semear a política de visualização web:', err?.message);
  }

  // --- API ROUTES ---

  // 0. Application Bootstrap Endpoint
  app.get('/api/bootstrap', async (req, res) => {
    try {
      const [
        cliStatus,
        projects,
        authorizedDirs,
        agents,
        skills,
        commands,
        mcpServers,
        policies,
      ] = await Promise.all([
        detectCliStatus(false),
        getProjects(),
        getAuthorizedDirs(),
        loadAgents(),
        loadSkills(),
        loadCommands(),
        loadMcpSettings(),
        loadPolicies(),
      ]);

      const activeProject = projects.find((p) => p.id === (projects[0]?.id)) || projects[0] || null;

      res.json({
        cliStatus,
        projects,
        authorizedDirs,
        activeProjectId: activeProject?.id,
        agents,
        skills,
        commands,
        mcpServers,
        policies,
      });
    } catch (err: any) {
      return sendError(res, 500, 'BOOTSTRAP_ERROR', 'Falha ao carregar dados iniciais do aplicativo.', {
        message: err?.message,
      });
    }
  });

  // 1. Status & CLI Information
  app.get('/api/status', async (req, res) => {
    const forceFresh = req.query.fresh === 'true' || req.query.fresh === '1';
    const model = typeof req.query.model === 'string' && req.query.model.trim() ? req.query.model.trim() : 'gemini-3.1-flash-lite';
    const status = await detectCliStatus(forceFresh, model);
    res.json(status);
  });

  app.get('/api/api-key/validate', async (req, res) => {
    const model = typeof req.query.model === 'string' && req.query.model.trim() ? req.query.model.trim() : 'gemini-3.1-flash-lite';
    const result = await validateGeminiApiKey(true, model);
    res.json(result);
  });

  app.post('/api/cli/config', (req, res) => {
    const { cliPath } = req.body;
    if (typeof cliPath === 'string') {
      setCustomCliPath(cliPath);
    }
    res.json({ success: true });
  });

  app.post('/api/cli/update', async (req, res) => {
    try {
      const execAsync = promisify(exec);
      let stdout = '';
      let stderr = '';

      // 1. Desinstalar versão local anterior do Gemini CLI
      try {
        await execAsync('npm uninstall @google/gemini-cli', {
          cwd: process.cwd(),
          timeout: 60000,
        });
      } catch (unerr: any) {
        console.warn('Aviso ao desinstalar versão local anterior:', unerr?.message);
      }

      // 2. Instalar versão mais recente do @google/gemini-cli
      try {
        const resLocal = await execAsync('npm install @google/gemini-cli@latest --no-audit --no-fund --legacy-peer-deps', {
          cwd: process.cwd(),
          timeout: 120000,
          env: { ...process.env, PATH: process.env.PATH },
        });
        stdout = resLocal.stdout || '';
        stderr = resLocal.stderr || '';
      } catch (localErr: any) {
        console.error('Erro no install padrao, tentando fallback com --force:', localErr?.message);
        const resForce = await execAsync('npm install @google/gemini-cli@latest --force --no-audit --no-fund', {
          cwd: process.cwd(),
          timeout: 120000,
          env: { ...process.env, PATH: process.env.PATH },
        });
        stdout = resForce.stdout || '';
        stderr = resForce.stderr || '';
      }

      let globalNotice = '';
      try {
        await execAsync('npm install -g @google/gemini-cli@latest --no-audit --no-fund --legacy-peer-deps', {
          timeout: 120000,
          env: { ...process.env, PATH: process.env.PATH },
        });
      } catch (globalErr: any) {
        console.warn('Aviso ao atualizar Gemini CLI globalmente:', globalErr?.message);
        if (globalErr?.message?.includes('EACCES') || globalErr?.message?.includes('permission')) {
          globalNotice = 'Atenção: A atualização global do sistema necessita de permissão (EACCES). Para atualizar o CLI global do seu sistema Ubuntu, execute no terminal: "sudo npm install -g @google/gemini-cli@latest". O aplicativo utilizará a versão local atualizada.';
        } else {
          globalNotice = `Aviso ao atualizar CLI global: ${globalErr?.message || 'Permissão negada'}. O aplicativo utilizará a versão local do projeto.`;
        }
      }

      // Reset custom CLI path so system picks up the newly installed binary
      setCustomCliPath('');

      const newStatus = await detectCliStatus(true);
      if (globalNotice) {
        newStatus.globalUpdateNotice = globalNotice;
      }

      res.json({
        success: true,
        version: newStatus.version,
        status: newStatus,
        globalNotice,
        stdout,
        stderr,
        message: `Gemini CLI atualizado com sucesso para v${newStatus.version}!`,
      });
    } catch (err: any) {
      console.error('Falha ao atualizar o CLI:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Falha ao atualizar o Gemini CLI',
      });
    }
  });

  app.post('/api/config/api-key', (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return res.status(400).json({ error: 'Chave de API não pode ser vazia.' });
    }
    const cleanKey = apiKey.trim();
    process.env.GEMINI_API_KEY = cleanKey;
    process.env.GOOGLE_GENAI_API_KEY = cleanKey;
    process.env.GOOGLE_API_KEY = cleanKey;

    try {
      const guiDir = getGuiDataDir();
      fs.mkdirSync(guiDir, { recursive: true });
      const envPath = path.join(guiDir, '.env');
      fs.writeFileSync(envPath, `GEMINI_API_KEY=${cleanKey}\nGOOGLE_GENAI_API_KEY=${cleanKey}\nGOOGLE_API_KEY=${cleanKey}\n`, { mode: 0o600 });
    } catch {}

    res.json({ success: true, authConfigured: true });
  });

  // 2. Real Execution via Server-Sent Events (SSE)
  app.post('/api/cli/execute', (req, res) => {
    const {
      executionId,
      prompt,
      model,
      approvalMode,
      authorizedDirs,
      sessionId,
      resume,
      workDir,
      agentId,
      backupAgentId,
      isBackupExecution,
      temperature,
      topP,
      topK,
      maxOutputTokens,
      thinking,
      thinkingLevel,
      thinking_level,
      systemInstructions,
      overrideBasePrompt,
      baseInstructions,
    } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt é obrigatório.' });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const sendSse = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const execution = executeGeminiCli({
      executionId,
      prompt,
      model,
      approvalMode,
      authorizedDirs,
      sessionId,
      resume: Boolean(resume),
      workDir,
      agentId,
      backupAgentId,
      isBackupExecution: Boolean(isBackupExecution),
      temperature,
      topP,
      topK,
      maxOutputTokens,
      thinking,
      thinkingLevel,
      thinking_level,
      systemInstructions,
      overrideBasePrompt,
      baseInstructions,
      onEvent: (evt) => {
        const payload =
          typeof evt.data === 'object' && evt.data !== null
            ? { executionId, type: evt.type, ...evt.data }
            : { executionId, type: evt.type, data: evt.data };
        sendSse(evt.type, payload);
      },
      onDone: (exitCode, signal) => {
        sendSse('done', { executionId, exitCode, signal });
        res.end();
      },
      onError: (err) => {
        sendSse('error', { executionId, message: err.message });
        res.end();
      },
    });

    sendSse('start', { timestamp: new Date().toISOString(), executionId: execution.executionId });

    res.on('close', () => {
      if (!res.writableEnded) {
        execution.cancel();
      }
    });
  });

  app.post('/api/cli/cancel', (req, res) => {
    const { executionId } = req.body || {};
    const cancelled = cancelExecutionById(executionId);
    res.json({ success: cancelled, executionId });
  });

  // 3. Agents
  app.get('/api/agents', (req, res) => {
    const agents = loadAgents();
    res.json(agents);
  });

  app.post('/api/agents', (req, res) => {
    const agent = req.body;
    if (!agent || !agent.name) {
      return res.status(400).json({ error: 'Dados do agente inválidos.' });
    }
    saveAgentToFile(agent);
    sysLog.info('AGENT', `Agente salvo/atualizado: "${agent.displayName || agent.name}" (ID: ${agent.id || agent.name})`, { model: agent.model });
    res.json({ success: true, agents: loadAgents() });
  });

  app.delete('/api/agents/:name', (req, res) => {
    const { name } = req.params;
    const ok = deleteAgent(name);
    sysLog.warn('AGENT', `Agente removido: "${name}"`, { success: ok });
    res.json({ success: ok, agents: loadAgents() });
  });

  app.post('/api/agents/reset-defaults', (req, res) => {
    const agents = resetAllAgentsToDefault();
    sysLog.info('AGENT', 'Todos os agentes foram restaurados para o padrão de fábrica.', { count: agents.length });
    res.json({ success: true, agents });
  });

  // 4. Skills
  app.get('/api/skills', (req, res) => {
    const skills = loadSkills();
    res.json(skills);
  });

  app.post('/api/skills', (req, res) => {
    const skill = req.body;
    if (!skill || !skill.name) {
      return res.status(400).json({ error: 'Dados da skill inválidos.' });
    }
    saveSkillToFile(skill);
    sysLog.info('SKILL', `Skill salva/atualizada: "${skill.name}"`);
    res.json({ success: true, skills: loadSkills() });
  });

  app.delete('/api/skills/:name', (req, res) => {
    const { name } = req.params;
    const ok = deleteSkill(name);
    sysLog.warn('SKILL', `Skill removida: "${name}"`, { success: ok });
    res.json({ success: ok, skills: loadSkills() });
  });

  // 5. Commands
  app.get('/api/commands', (req, res) => {
    const commands = loadCommands();
    res.json(commands);
  });

  app.post('/api/commands', (req, res) => {
    const cmd = req.body;
    if (!cmd || !cmd.name) {
      return res.status(400).json({ error: 'Dados do comando inválidos.' });
    }
    saveCommandToFile(cmd);
    sysLog.info('COMMAND', `Comando salvo/atualizado: "${cmd.name}"`);
    res.json({ success: true, commands: loadCommands() });
  });

  app.delete('/api/commands/:name', (req, res) => {
    const { name } = req.params;
    const ok = deleteCommand(name);
    sysLog.warn('COMMAND', `Comando removido: "${name}"`, { success: ok });
    res.json({ success: ok, commands: loadCommands() });
  });

  // 6. MCP
  app.get('/api/mcp', (req, res) => {
    const servers = loadMcpSettings();
    res.json(servers);
  });

  app.post('/api/mcp', (req, res) => {
    const servers = req.body;
    if (!Array.isArray(servers)) {
      return res.status(400).json({ error: 'Lista esperada de servidores MCP.' });
    }
    saveMcpSettings(servers);
    sysLog.info('MCP', `Configurações de servidores MCP atualizadas (${servers.length} servidores configurados).`);
    res.json({ success: true, servers: loadMcpSettings() });
  });

  app.post('/api/mcp/test', async (req, res) => {
    const mcp = req.body;
    if (!mcp || (!mcp.command && !mcp.httpUrl && !mcp.url)) {
      return res.status(400).json({ success: false, message: 'Configuração MCP inválida.' });
    }
    const result = await testMcpServer(mcp);
    if (result.success) {
      sysLog.success('MCP', `Teste do servidor MCP "${mcp.name}": Conexão estabelecida com sucesso.`, { message: result.message });
    } else {
      sysLog.warn('MCP', `Teste do servidor MCP "${mcp.name}": Falha na conexão - ${result.message}`);
    }
    res.json(result);
  });

  // 7. Policies
  app.get('/api/policies', (req, res) => {
    res.json(loadPolicies());
  });

  app.post('/api/policies', (req, res) => {
    const { filename, content } = req.body;
    if (!filename) return res.status(400).json({ error: 'Filename é obrigatório' });
    const success = savePolicy(filename, content || '');
    res.json({ success });
  });

  app.put('/api/policies/:filename', (req, res) => {
    const { filename } = req.params;
    const { newFilename, content } = req.body;
    if (newFilename && newFilename !== filename) {
      renamePolicy(filename, newFilename);
      if (content !== undefined) {
        savePolicy(newFilename, content);
      }
    } else if (content !== undefined) {
      savePolicy(filename, content);
    }
    res.json({ success: true });
  });

  app.delete('/api/policies/:filename', (req, res) => {
    const { filename } = req.params;
    const success = deletePolicy(filename);
    res.json({ success });
  });

  // 8. Authorized Directories
  app.get('/api/directories', (req, res) => {
    res.json(getAuthorizedDirs());
  });

  app.post('/api/directories', (req, res) => {
    const { path: dirPath } = req.body;
    if (!dirPath) {
      return res.status(400).json({ error: 'Caminho do diretório é obrigatório.' });
    }
    const result = addAuthorizedDir(dirPath);
    res.json(result);
  });

  app.delete('/api/directories', (req, res) => {
    const { path: dirPath } = req.body;
    if (!dirPath) {
      return res.status(400).json({ error: 'Caminho do diretório é obrigatório.' });
    }
    const result = removeAuthorizedDir(dirPath);
    res.json(result);
  });

  // 8. Projects
  app.get('/api/projects', (req, res) => {
    res.json(getProjects());
  });

  app.post('/api/projects', (req, res) => {
    const { name, description, associatedDirs } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Nome do projeto é obrigatório.' });
    }
    const project = createProject(name, description || '', associatedDirs);
    res.json(project);
  });

  app.put('/api/projects/:id', (req, res) => {
    const { id } = req.params;
    const updated = updateProject(id, req.body);
    if (!updated) return res.status(404).json({ error: 'Projeto não encontrado.' });
    res.json(updated);
  });

  app.delete('/api/projects/:id', (req, res) => {
    const { id } = req.params;
    deleteProject(id);
    res.json({ success: true });
  });

  // 9. Sessions & History
  app.get('/api/sessions', (req, res) => {
    const { projectId } = req.query;
    res.json(getSessions(projectId as string));
  });

  app.post('/api/sessions', (req, res) => {
    const session = req.body;
    if (!session || !session.id) {
      return res.status(400).json({ error: 'Sessão inválida.' });
    }
    const saved = saveSession(session);
    res.json(saved);
  });

  app.delete('/api/sessions/:id', (req, res) => {
    const { id } = req.params;
    deleteSession(id);
    res.json({ success: true });
  });

  // 10. Files and Real Diffs
  app.get('/api/files', (req, res) => {
    const { dir } = req.query;
    const result = inspectFilesAndDiffs(dir as string);
    res.json(result);
  });

  app.get('/api/files/read', async (req, res) => {
    const { path: filePath } = req.query;
    if (!filePath) return res.status(400).json({ error: 'Caminho do arquivo é obrigatório' });
    const result = await readFileContentAsync(filePath as string);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  });

  // 11. Audio Interface Layer (STT & TTS)
  app.get('/api/audio/status', async (req, res) => {
    const status = await checkAudioModelsAvailability();
    res.json(status);
  });

  app.post('/api/audio/stt', async (req, res) => {
    const { audioBase64, mimeType, model, apiKey, apiUrl, instructions } = req.body;
    if (!audioBase64) {
      return res.status(400).json({ error: 'Dados de áudio não fornecidos.' });
    }
    const result = await transcribeAudio(audioBase64, mimeType, model, apiKey, apiUrl, instructions);
    res.json(result);
  });

  app.post('/api/audio/tts', async (req, res) => {
    const { text, voice, apiKey, apiUrl, model, instructions } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Texto para narração é obrigatório.' });
    }
    const result = await synthesizeSpeech(text, voice, model, apiKey, apiUrl, instructions);
    res.json(result);
  });

  // 12. Packaging & Status Distinction Matrix
  app.get('/api/packaging/matrix', (req, res) => {
    res.json(getSystemValidationMatrix());
  });

  app.post('/api/packaging/build', (req, res) => {
    const result = buildPackagingArtifacts();
    res.json(result);
  });

  // 13. Git Application Updater & System Lifecycle
  app.get('/api/git/status', (req, res) => {
    try {
      const { repoUrl } = req.query;
      const status = getGitStatus(repoUrl as string);
      res.json(status);
    } catch (err: any) {
      res.status(500).json({
        isGitRepo: false,
        repoUrl: (req.query.repoUrl as string) || DEFAULT_GIT_REPO_URL,
        branch: DEFAULT_GIT_BRANCH,
        hasUncommittedChanges: false,
        uncommittedFilesCount: 0,
        gitAvailable: false,
        error: err.message,
      });
    }
  });

  app.post('/api/git/check-update', async (req, res) => {
    try {
      const { repoUrl, branch } = req.body || {};
      const result = await checkRemoteGitUpdates(repoUrl || DEFAULT_GIT_REPO_URL, branch || DEFAULT_GIT_BRANCH);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({
        hasUpdate: false,
        branch: req.body?.branch || DEFAULT_GIT_BRANCH,
        message: `Falha ao checar atualizações: ${err.message}`,
        error: err.message,
      });
    }
  });

  app.post('/api/git/pull-update', (req, res) => {
    try {
      const { repoUrl, branch, forceSync, installDependencies, runBuild, restartServer } = req.body || {};
      const result = performGitUpdate({
        repoUrl: repoUrl || DEFAULT_GIT_REPO_URL,
        branch: branch || DEFAULT_GIT_BRANCH,
        forceSync: Boolean(forceSync),
        installDependencies: installDependencies !== false,
        runBuild: runBuild !== false,
        restartServer: Boolean(restartServer),
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({
        success: false,
        message: `Erro interno no servidor ao aplicar atualização: ${err.message}`,
        logs: [`❌ Falha no endpoint /api/git/pull-update: ${err.message}`],
      });
    }
  });

  app.post('/api/system/rebuild', (req, res) => {
    try {
      const result = performRebuild();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({
        success: false,
        message: `Falha ao reconstruir: ${err.message}`,
        logs: [`❌ Erro no build: ${err.message}`],
      });
    }
  });

  app.post('/api/system/restart', (req, res) => {
    try {
      const delayMs = typeof req.body?.delayMs === 'number' ? req.body.delayMs : 1500;
      scheduleServerRestart(delayMs);
      res.json({
        success: true,
        message: `Reinício do servidor programado para execução em ${delayMs}ms.`,
        delayMs,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        message: `Falha ao reiniciar servidor: ${err.message}`,
      });
    }
  });

  app.get('/api/git/manual-commands', (req, res) => {
    const { repoUrl, branch } = req.query;
    const cmds = generateManualUpdateCommands(
      (repoUrl as string) || DEFAULT_GIT_REPO_URL,
      (branch as string) || DEFAULT_GIT_BRANCH
    );
    res.json({ commands: cmds });
  });

  // 12. Backup, Restore and Factory Reset
  app.get('/api/system/backup/export', (req, res) => {
    try {
      const sectionsParam = req.query.sections as string;
      const allowedSections = sectionsParam ? sectionsParam.split(',').map((s) => s.trim()) : undefined;
      const backupData = exportFullSystemBackup(allowedSections);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="gemini-gui-backup-${Date.now()}.json"`);
      res.json(backupData);
    } catch (err: any) {
      res.status(500).json({
        success: false,
        message: `Falha ao exportar backup: ${err.message}`,
      });
    }
  });

  app.post('/api/system/backup/restore', (req, res) => {
    try {
      const { backupData, selectedSections } = req.body;
      if (!backupData) {
        return res.status(400).json({
          success: false,
          message: 'Nenhum dado de backup fornecido no corpo da requisição.',
        });
      }
      const sections = selectedSections || {
        agents: true,
        chatHistory: true,
        skills: true,
        commands: true,
        mcpServers: true,
        policies: true,
        projects: true,
        authorizedDirs: true,
        generalSettings: true,
      };
      const result = restoreSystemBackup(backupData, sections);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({
        success: false,
        message: `Falha ao processar restauração: ${err.message}`,
      });
    }
  });

  app.post('/api/system/reset-factory', (req, res) => {
    try {
      const result = resetSystemToFactoryDefaults();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({
        success: false,
        message: `Falha ao restaurar padrões de fábrica: ${err.message}`,
      });
    }
  });

  // 14. Real-time System Logs
  app.get('/api/logs', (req, res) => {
    const { limit, level, category, search } = req.query;
    const list = getLogs({
      limit: limit ? Number(limit) : 500,
      level: level as string,
      category: category as string,
      search: search as string,
    });
    res.json({ logs: list, total: list.length });
  });

  app.post('/api/logs', (req, res) => {
    const { level, category, message, details, source } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Mensagem de log é obrigatória.' });
    }
    const entry = addLog(
      level || 'info',
      category || 'SYSTEM',
      message,
      details,
      source || 'Frontend'
    );
    res.json({ success: true, log: entry });
  });

  app.delete('/api/logs', (req, res) => {
    clearLogs();
    res.json({ success: true, message: 'Logs limpos com sucesso.' });
  });

  app.get('/api/logs/stream', (req, res) => {
    registerSseClient(res);
  });

  app.get('/api/logs/export', (req, res) => {
    const text = exportLogsText();
    const filename = `gemini_gui_logs_${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(text);
  });

  // --- Vite middleware / static files ---
  const isProduction = process.env.NODE_ENV === 'production' || !fs.existsSync(path.join(process.cwd(), 'index.html'));

  if (!isProduction) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        watch: {
          ignored: [
            '**/.gemini/**',
            '**/.gemini-gui*/**',
            '**/.gemini-gui*.*',
            '**/projects-data/**',
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/.env*',
            '**/*.json',
            '**/*.toml',
            '**/*.log',
            '**/logs/**',
            '**/tmp/**',
          ],
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Dynamically search for dist/index.html across common execution directories
    const appDir = getAppDir();
    const candidateDirs = [
      path.join(process.cwd(), 'dist'),
      process.cwd(),
      appDir,
      path.resolve(appDir, '..', 'dist'),
      path.resolve(appDir, '..'),
    ];
    const distPath = candidateDirs.find((dir) => fs.existsSync(path.join(dir, 'index.html'))) || path.join(process.cwd(), 'dist');

    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`Gemini CLI GUI server running at http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal error starting Gemini CLI GUI server:', err);
  process.exit(1);
});
