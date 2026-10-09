const fs = require('fs');
const path = require('path');

const bundleDir = process.env.GEMINI_GUI_PATCH_BUNDLE_DIR || path.resolve(__dirname, '../node_modules/@google/gemini-cli/bundle');

const filesToPatch = [
  'chunk-YSBB75DZ.js',
  'chunk-S4PJ76PA.js',
  'chunk-SM627E5R.js'
];

function patchFile(fileName) {
  const filePath = path.join(bundleDir, fileName);
  if (!fs.existsSync(filePath)) {
    console.log(`[patch] File not found: ${filePath}`);
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');

  // 1. Final API request capture in generateContentStream
  const alreadyPatchedMarker = /\/\/ __REAL_FINAL_API_REQUEST_CAPTURED__[\s\S]*?if\s*\(role\s*!==\s*'subagent'\)\s*\{\s*process\.stdout\.write\(JSON\.stringify\(_captureEvent\)\s*\+\s*"\\n"\);\s*\}\s*\}\s*catch \(_err\) \{\}/;
  const oldPatchedMarker = /\/\/ __REAL_FINAL_API_REQUEST_CAPTURED__[\s\S]*?process\.stdout\.write\(JSON\.stringify\(_captureEvent\)\s*\+\s*"\\n"\);\s*\}\s*catch \(_err\) \{\}/;
  const originalTargetPattern = /if\s*\(\/########\\d\+\$\/\.test\(userPromptId\)\)\s*\{\s*this\.config\.setLatestApiRequest\(req\);\s*\}/;

  const streamReplacement = `// __REAL_FINAL_API_REQUEST_CAPTURED__
        this.config.setLatestApiRequest(req);
        try {
          const _restPayload = typeof convertToRestPayload === 'function' ? convertToRestPayload(req) : {};
          const _realFinalApiRequest = {
            model: req.model,
            ..._restPayload
          };
          const _captureEvent = {
            type: "final_api_request",
            timestamp: new Date().toISOString(),
            sessionId: this.config?.getSessionId?.() || undefined,
            promptId: userPromptId,
            requestId: userPromptId || ('req_' + Date.now()),
            model: req.model,
            role,
            finalApiRequest: _realFinalApiRequest
          };
          if (process.env.GEMINI_CLI_REQUEST_DUMP_DIR) {
            try {
              const _fs = await import('node:fs');
              const _p = await import('node:path');
              const _dir = process.env.GEMINI_CLI_REQUEST_DUMP_DIR;
              if (!_fs.existsSync(_dir)) _fs.mkdirSync(_dir, { recursive: true });
              const _f = _p.join(_dir, \`req-\${Date.now()}-\${Math.random().toString(36).slice(2, 7)}.json\`);
              _fs.writeFileSync(_f, JSON.stringify(_captureEvent, null, 2), 'utf8');
            } catch {}
          }
          if (role !== 'subagent') {
            process.stdout.write(JSON.stringify(_captureEvent) + "\\n");
          }
        } catch (_err) {}`;

  if (alreadyPatchedMarker.test(content)) {
    content = content.replace(alreadyPatchedMarker, streamReplacement);
  } else if (oldPatchedMarker.test(content)) {
    content = content.replace(oldPatchedMarker, streamReplacement);
  } else if (originalTargetPattern.test(content)) {
    content = content.replace(originalTargetPattern, streamReplacement);
  }

  // 2. generateContent (non-stream)
  const generateContentPattern = /spanMetadata\.input = req\.contents;\s*const startTime = Date\.now\(\);\s*const contents = toContents\(req\.contents\);\s*const serverDetails = this\._getEndpointUrl\(req, "generateContent"\);\s*this\.logApiRequest\(contents, req\.model, userPromptId, role, req\.config, serverDetails\);/;

  if (generateContentPattern.test(content) && !content.includes('// __REAL_FINAL_API_REQUEST_GENERATE_CONTENT__')) {
    content = content.replace(generateContentPattern, (match) => {
      return `${match}
      // __REAL_FINAL_API_REQUEST_GENERATE_CONTENT__
      try {
        if (this.config?.setLatestApiRequest) {
          this.config.setLatestApiRequest(req);
        }
        const _restPayload = typeof convertToRestPayload === 'function' ? convertToRestPayload(req) : {};
        const _realFinalApiRequest = {
          model: req.model,
          ..._restPayload
        };
        const _captureEvent = {
          type: "final_api_request",
          timestamp: new Date().toISOString(),
          sessionId: this.config?.getSessionId?.() || undefined,
          promptId: userPromptId,
          requestId: userPromptId || ('req_' + Date.now()),
          model: req.model,
          role,
          finalApiRequest: _realFinalApiRequest
        };
        if (role !== 'subagent') {
          process.stdout.write(JSON.stringify(_captureEvent) + "\\n");
        }
      } catch (_err) {}`;
    });
  }

  // 3. LocalAgentExecutor executeTurn - destructure textResponse and treat text response as completion when functionCalls.length === 0
  const callModelDestructurePattern = /const\s*\{\s*functionCalls,\s*modelToUse\s*\}\s*=\s*await\s*promptIdContext\.run\(\s*promptId,\s*async\s*\(\)\s*=>\s*this\.callModel\(/;
  if (callModelDestructurePattern.test(content)) {
    content = content.replace(callModelDestructurePattern, `const { functionCalls, textResponse, modelToUse } = await promptIdContext.run(
      promptId,
      async () => this.callModel(`);
  }

  const executeTurnNoCallsPattern = /if\s*\(functionCalls\.length\s*===\s*0\)\s*\{\s*[\s\S]*?return\s*\{\s*status:\s*"stop",\s*terminateReason:\s*(?:AgentTerminateMode\.ERROR_NO_COMPLETE_TASK_CALL|"ERROR_NO_COMPLETE_TASK_CALL"),\s*finalResult:\s*null\s*\};\s*\}/;

  const executeTurnReplacement = `if (functionCalls.length === 0) {
      let _extractedResult = (typeof textResponse === 'string' && textResponse.trim()) ? textResponse.trim() : "";
      if (!_extractedResult) {
        try {
          const _hist = chat.getHistory(true);
          const _lastTurn = _hist && _hist[_hist.length - 1];
          if (_lastTurn && _lastTurn.parts) {
            _extractedResult = _lastTurn.parts.filter(p => !p.thought && p.text).map(p => p.text).join('\\n').trim();
          }
        } catch {}
      }
      if (_extractedResult) {
        return {
          status: "stop",
          terminateReason: "GOAL",
          finalResult: _extractedResult
        };
      }
      this.emitActivity("ERROR", {
        error: \`Agent stopped calling tools but did not call '\${COMPLETE_TASK_TOOL_NAME}' to finalize the session.\`,
        context: "protocol_violation",
        errorType: "GENERIC"
      });
      return {
        status: "stop",
        terminateReason: "ERROR_NO_COMPLETE_TASK_CALL",
        finalResult: null
      };
    }`;

  if (executeTurnNoCallsPattern.test(content)) {
    content = content.replace(executeTurnNoCallsPattern, executeTurnReplacement);
  }

  // 4. LocalAgentExecutor executeFinalWarningTurn - accept finalResult if provided
  const recoveryTurnCheckPattern = /if\s*\(turnResult\.status\s*===\s*"stop"\s*&&\s*turnResult\.terminateReason\s*===\s*AgentTerminateMode\.GOAL\)\s*\{\s*this\.emitActivity\("THOUGHT_CHUNK",\s*\{\s*text:\s*"Graceful recovery succeeded\."\s*\}\);\s*success2\s*=\s*true;\s*return\s*turnResult\.finalResult\s*\?\?\s*""\s*;\s*\}/;

  const recoveryTurnCheckReplacement = `if (turnResult.status === "stop" && (turnResult.terminateReason === AgentTerminateMode.GOAL || Boolean(turnResult.finalResult))) {
        this.emitActivity("THOUGHT_CHUNK", {
          text: "Graceful recovery succeeded."
        });
        success2 = true;
        return turnResult.finalResult ?? "Task completed.";
      }`;

  if (recoveryTurnCheckPattern.test(content)) {
    content = content.replace(recoveryTurnCheckPattern, recoveryTurnCheckReplacement);
  }

  // 5. LocalAgentExecutor runInternal fallback when ERROR_NO_COMPLETE_TASK_CALL occurs
  const errorNoCompleteTaskBranchPattern = /else\s*if\s*\(terminateReason\s*===\s*AgentTerminateMode\.ERROR_NO_COMPLETE_TASK_CALL\)\s*\{\s*finalResult\s*=\s*finalResult\s*\|\|\s*`Agent stopped calling tools but did not call '\$\{COMPLETE_TASK_TOOL_NAME\}'\.`;\s*this\.emitActivity\("ERROR",\s*\{\s*error:\s*finalResult,\s*context:\s*"protocol_violation",\s*errorType:\s*SubagentActivityErrorType\.GENERIC\s*\}\);\s*\}/;

  const errorNoCompleteTaskBranchReplacement = `else if (terminateReason === AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL) {
            try {
              const _hist = chat.getHistory(true);
              const _lastAssistant = _hist?.slice().reverse().find((h) => h.role === "model" || h.role === "assistant");
              const _lastText = _lastAssistant?.parts?.filter((p) => !p.thought && p.text)?.map((p) => p.text)?.join("\\n");
              if (_lastText && _lastText.trim()) {
                terminateReason = AgentTerminateMode.GOAL;
                finalResult = _lastText.trim();
              }
            } catch {}
            if (terminateReason !== AgentTerminateMode.GOAL) {
              finalResult = finalResult || \`Agent stopped calling tools but did not call '\${COMPLETE_TASK_TOOL_NAME}'.\`;
              this.emitActivity("ERROR", {
                error: finalResult,
                context: "protocol_violation",
                errorType: SubagentActivityErrorType.GENERIC
              });
            }
          }`;

  if (errorNoCompleteTaskBranchPattern.test(content)) {
    content = content.replace(errorNoCompleteTaskBranchPattern, errorNoCompleteTaskBranchReplacement);
  }

  content = patchWebSearch(content);
  content = patchRuntime(content);
  content = patchMcpErrors(content);

  content = patchLocalTools(content);
  // 8. Fast failover patch: reduce internal CLI retries from 10 attempts (300s) to 2 fast attempts (1-2s)
  // so that GUI Key Pool Failover and Model Fallback trigger immediately on 503/429 errors.
  content = content.replace(/DEFAULT_MAX_ATTEMPTS\s*=\s*10;/g, 'DEFAULT_MAX_ATTEMPTS = 2;');
  content = content.replace(/initialDelayMs:\s*5e3,/g, 'initialDelayMs: 1e3,');
  content = content.replace(/maxDelayMs:\s*3e4,/g, 'maxDelayMs: 3e3,');

  const syntax = require('node:child_process').spawnSync(process.execPath, ['--input-type=module', '--check'], { input: content, encoding: 'utf8' });
  if (syntax.status !== 0) throw new Error(`Invalid patched bundle ${fileName}: ${syntax.stderr}`);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`[patch] Successfully patched: ${fileName}`);
}

function patchMcpErrors(content) {
  if (content.includes('__GUI_EXA_MCP_ERROR_V1__')) return content;
  const start = content.indexOf('var DiscoveredMCPToolInvocation = class');
  const end = content.indexOf('var DiscoveredMCPTool =', start);
  if (start < 0 || end < 0) return content;
  const section = content.slice(start, end);
  const boundary = '    if (this.isMCPToolError(rawResponseParts)) {';
  if (!section.includes(boundary)) throw new Error('Unknown MCP tool-result boundary');
  const patched = section.replace(boundary, `    // __GUI_EXA_MCP_ERROR_V1__
    if (process.env.GEMINI_GUI_RUNTIME_MODULE) {
      const runtime = await import(process.env.GEMINI_GUI_RUNTIME_MODULE);
      runtime.normalizeExaMcpError(this.serverName, this.serverToolName, rawResponseParts);
    }
${boundary}`);
  return content.slice(0, start) + patched + content.slice(end);
}

function patchWebSearch(content) {
  // Some installed versions had a catch inserted without a nested try, leaving
  // both invalid syntax and a fabricated success. Rebuild only this boundary,
  // retaining the exact native call arguments and the result-processing code.
  const start = content.indexOf('var WebSearchToolInvocation = class');
  const end = content.indexOf('var WebSearchTool =', start);
  if (start < 0 || end < 0) return content;
  let section = content.slice(start, end);
  const tryStart = section.indexOf('    try {');
  const resultStart = section.indexOf('      const responseText = getResponseText(response);');
  if (tryStart < 0 || resultStart < tryStart) throw new Error('Unknown WebSearchToolInvocation boundary');
  const originalCall = section.slice(tryStart, resultStart).match(/response = await geminiClient\.generateContent\(([\s\S]*?)\);/);
  if (!originalCall) throw new Error('Unknown native web-search call');
  section = section.slice(0, tryStart) + `    try {
      let response;
      try {
        response = await geminiClient.generateContent(${originalCall[1]});
      } catch (_searchErr) {
        // __GUI_EXA_FALLBACK_V2__
        if (!process.env.GEMINI_GUI_RUNTIME_MODULE) throw _searchErr;
        const runtime = await import(process.env.GEMINI_GUI_RUNTIME_MODULE);
        return await runtime.fallbackWebSearch(this.context, this.params.query, signal, _searchErr);
      }
` + section.slice(resultStart);
  return content.slice(0, start) + section + content.slice(end);
}

function patchLocalTools(content) {
  // V8 limits argument count, regardless of recursion depth.
  content = content.replaceAll('allEntries.push(...entries);', 'for (const entry of entries) allEntries.push(entry);');
  if (!content.includes('__GUI_HOME_SEARCH_SCOPE_V1__')) {
    for (const className of ['GrepToolInvocation', 'GrepToolInvocation2', 'GlobToolInvocation']) {
      const start = content.indexOf('var ' + className + ' = class');
      if (start < 0) continue;
      const end = content.indexOf('\n};', start);
      const section = content.slice(start, end);
      const method = section.match(/async execute\((?:\{[\s\S]*?\}|[\w, ]*)\) \{/);
      if (!method) throw new Error('Unknown search execution boundary: ' + className);
      const offset = start + method.index + method[0].length;
      content = content.slice(0, offset) + `
    // __GUI_HOME_SEARCH_SCOPE_V1__
    if (process.env.GEMINI_GUI_RUNTIME_MODULE && !this.params.dir_path && this.config.storage.isWorkspaceHomeDir()) {
      const message = "Busca local no diretório pessoal requer dir_path específico. Para pesquisa web, use a ferramenta de busca web.";
      return { llmContent: message, returnDisplay: "Defina o diretório da busca local.", error: { type: "LOCAL_SEARCH_SCOPE_REQUIRED", message } };
    }
` + content.slice(offset);
    }
  }
  return content;
}

function provisionRipgrep() {
  const name = `rg-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`;
  const target = path.join(bundleDir, name);
  if (fs.existsSync(target)) return;
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    const source = path.join(directory, process.platform === 'win32' ? 'rg.exe' : 'rg');
    try {
      fs.accessSync(source, fs.constants.X_OK);
      const check = require('node:child_process').spawnSync(source, ['--version'], { encoding: 'utf8' });
      if (check.status !== 0 || !check.stdout.startsWith('ripgrep ')) continue;
      fs.copyFileSync(source, target); fs.chmodSync(target, 0o755);
      console.log('[patch] Provisioned native ripgrep: ' + name); return;
    } catch {}
  }
  console.warn('[patch] ripgrep unavailable: install the system ripgrep package.');
}

function patchRuntime(content) {
  if (!content.includes('__GUI_SUBAGENT_ACTIVITIES_V1__') && !content.includes('__GUI_SUBAGENT_ACTIVITIES_V2__')) {
    content = content.replace('  emitActivity(type2, data) {', `  emitActivity(type2, data) {
    // __GUI_SUBAGENT_ACTIVITIES_V1__
    if (process.env.GEMINI_GUI_RUNTIME_MODULE) {
      const common = { agentId: this.definition.name, invocationId: this.agentId, timestamp: new Date().toISOString() };
      let event;
      if (type2 === "THOUGHT_CHUNK") event = { type: "analysis_summary", activityId: "analysis:" + this.agentId, summary: data.text, ...common };
      if (type2 === "TOOL_CALL_START") event = { type: "tool_use", tool_id: data.callId, tool_name: data.name, parameters: data.args, ...common };
      if (type2 === "TOOL_CALL_END") event = { type: "tool_result", tool_id: data.id, tool_name: data.name, output: data.output, status: "success", ...common };
      if (type2 === "ERROR" && data.callId) event = { type: "tool_result", tool_id: data.callId, tool_name: data.name, error: data.error, status: "failed", ...common };
      if (event) process.stdout.write(JSON.stringify(event) + "\\n");
    }`);
  }

  if (!content.includes('__GUI_SUBAGENT_ACTIVITIES_V2__')) {
    content = content.replace(/    \/\/ __GUI_SUBAGENT_ACTIVITIES_V1__[\s\S]*?(?=    if \(this.onActivity\))/, `    // __GUI_SUBAGENT_ACTIVITIES_V2__
    this.guiRuntime?.emitAgentActivity(type2, data, { agentId: this.definition.name, invocationId: this.agentId, parentToolCallId: this.parentCallId });
`);
  }

  if (!content.includes('__GUI_DELEGATION_SCOPE_V1__')) {
    content = content.replace('  async run(inputs, signal) {', `  // __GUI_DELEGATION_SCOPE_V1__
  async run(inputs, signal) {
    if (!process.env.GEMINI_GUI_RUNTIME_MODULE) return this.guiRun(inputs, signal);
    const runtime = await import(process.env.GEMINI_GUI_RUNTIME_MODULE);
    return runtime.runDelegation(this.definition.name, this.agentId, inputs, signal, () => this.guiRun(inputs, signal));
  }
  async guiRun(inputs, signal) {`);
    content = content.replace('    return this.agents.get(name3);', `    // __GUI_AGENT_REGISTRY_V1__
    if (process.env.GEMINI_GUI_RUNTIME_MODULE && process.env.GEMINI_GUI_ALLOWED_AGENTS) {
      const aliases = JSON.parse(process.env.GEMINI_GUI_AGENT_ALIASES || '{}');
      const allowed = JSON.parse(process.env.GEMINI_GUI_ALLOWED_AGENTS);
      name3 = aliases[name3] || name3;
      if (!allowed.includes(name3)) return undefined;
    }
    return this.agents.get(name3);`);
    content = content.replace('    return Array.from(this.agents.values());', `    const definitions = Array.from(this.agents.values());
    if (!process.env.GEMINI_GUI_RUNTIME_MODULE || !process.env.GEMINI_GUI_ALLOWED_AGENTS) return definitions;
    const allowed = JSON.parse(process.env.GEMINI_GUI_ALLOWED_AGENTS);
    return definitions.filter(definition => allowed.includes(definition.name));`);
    content = content.replace('    return Array.from(this.agents.keys());', '    return this.getAllDefinitions().map(definition => definition.name);');
  }

  if (!content.includes('__GUI_WEB_QUOTA_HANDOFF_V1__')) {
    const start = content.indexOf('  async generateContent(modelConfigKey, contents, abortSignal, role) {');
    const retry = content.indexOf('      const result2 = await retryWithBackoff(apiCall, {', start);
    if (start >= 0 && retry > start) content = content.slice(0, retry) + `      // __GUI_WEB_QUOTA_HANDOFF_V1__
      if (process.env.GEMINI_GUI_RUNTIME_MODULE && modelConfigKey.model === "web-search") return await apiCall();
` + content.slice(retry);
  }

  if (!content.includes('__GUI_INVOKE_RUNTIME_V1__')) {
    content = content.replace('  async callModel(chat, message, signal, promptId) {', `  // __GUI_INVOKE_RUNTIME_V1__
  async callModel(chat, message, signal, promptId) {
    if (!process.env.GEMINI_GUI_RUNTIME_MODULE) return this.guiCallModel(chat, message, signal, promptId);
    const runtime = await import(process.env.GEMINI_GUI_RUNTIME_MODULE);
    return runtime.runWithAgent(this.definition.name, this.agentId, () => this.guiCallModel(chat, message, signal, promptId));
  }
  async guiCallModel(chat, message, signal, promptId) {`);
  }
  if (!content.includes('__GUI_SDK_RUNTIME_V1__')) {
    const start = content.indexOf('      const googleGenAI = new GoogleGenAI({');
    const finishText = '      return new LoggingContentGenerator(googleGenAI.models, gcConfig);';
    const end = content.indexOf(finishText, start);
    if (start >= 0 && end > start) {
      let creation = content.slice(start, end).replace('const googleGenAI = new GoogleGenAI({', 'const guiSdkOptions = {');
      creation = creation.replace(/\}\);\s*$/, '};\n');
      content = content.slice(0, start) + creation + `      // __GUI_SDK_RUNTIME_V1__
      const googleGenAI = new GoogleGenAI(guiSdkOptions);
      let guiModels = googleGenAI.models;
      if (process.env.GEMINI_GUI_RUNTIME_MODULE && config2.authType === AuthType2.USE_GEMINI) {
        const runtime = await import(process.env.GEMINI_GUI_RUNTIME_MODULE);
        guiModels = runtime.wrapModels(guiModels, (key) => {
          const options = { ...guiSdkOptions, apiKey: key, httpOptions: { ...guiSdkOptions.httpOptions, headers: { ...guiSdkOptions.httpOptions.headers } } };
          if (options.httpOptions.headers.Authorization) options.httpOptions.headers.Authorization = 'Bearer ' + key;
          return new GoogleGenAI(options).models;
        }, baseUrl || 'https://generativelanguage.googleapis.com', apiVersionEnv || 'v1beta');
      }
      return new LoggingContentGenerator(guiModels, gcConfig);` + content.slice(end + finishText.length);
    }
  }
  if (!content.includes('__GUI_OAUTH_RUNTIME_V1__')) {
    content = content.replace(/return new LoggingContentGenerator\((new ModelMappingContentGenerator\(await createCodeAssistContentGenerator\([^\n]+?), gcConfig\);/, `// __GUI_OAUTH_RUNTIME_V1__
      let guiNative = $1;
      if (process.env.GEMINI_GUI_RUNTIME_MODULE) guiNative = (await import(process.env.GEMINI_GUI_RUNTIME_MODULE)).wrapModels(guiNative);
      return new LoggingContentGenerator(guiNative, gcConfig);`);
  }
  if (!content.includes('__GUI_FOLDER_CONTEXT_BOUND_V1__')) {
    const start = content.indexOf('async function readFullStructure(rootPath, options) {');
    const end = content.indexOf('function formatStructure(', start);
    if (start >= 0 && end > start) {
      const section = content.slice(start, end).replace('const rawEntries = await fs46.readdir(currentPath, { withFileTypes: true });', `// __GUI_FOLDER_CONTEXT_BOUND_V1__
      const rawEntries = [];
      const iterator = await fs46.opendir(currentPath);
      for await (const entry of iterator) {
        rawEntries.push(entry);
        if (process.env.GEMINI_GUI_RUNTIME_MODULE && rawEntries.length > options.maxItems) { folderInfo.hasMoreFiles = true; folderInfo.hasMoreSubfolders = true; break; }
      }`);
      content = content.slice(0, start) + section + content.slice(end);
    }
  }
  // __GUI_TERMINAL_DELEGATION_V2__: correlate the executor's terminal result to invoke_agent.
  content = content.replace('() => this.guiRun(inputs, signal));', '() => this.guiRun(inputs, signal), this.parentCallId);');
  if (!content.includes('__GUI_DELEGATION_CONFIG_V1__')) {
    content = content.replace('return runtime.runDelegation(this.definition.name, this.agentId, inputs, signal, () => this.guiRun(inputs, signal), this.parentCallId);', `// __GUI_DELEGATION_CONFIG_V1__
    this.guiRuntime = runtime;
    return runtime.runDelegation(this.definition.name, this.agentId, inputs, signal, () => this.guiRun(inputs, signal), this.parentCallId, this.context.config);`);
  }
  if (!content.includes('__GUI_MANAGED_RETRY_BOUNDARY_V1__')) {
    content = content.replace('      throwIfAborted();\n      let classifiedError = classifyGoogleError(error40);', `      throwIfAborted();
      // __GUI_MANAGED_RETRY_BOUNDARY_V1__
      if (process.env.GEMINI_GUI_RUNTIME_MODULE && (error40?.guiManaged || String(error40?.code || '').startsWith('GUI_'))) throw error40;
      let classifiedError = classifyGoogleError(error40);`);
  }
  // The principal receives a genuine tool failure instead of a successful tool containing an error string.
  if (!content.includes('error: { message: errorMessage, type: "EXECUTION_FAILED" },')) content = content.replace('llmContent: `Subagent \'${this.definition.name}\' failed. Error: ${errorMessage}`,', 'llmContent: `Subagent \'${this.definition.name}\' failed. Error: ${errorMessage}`,\n        error: { message: errorMessage, type: "EXECUTION_FAILED" },');
  return content;
}
module.exports = { patchRuntime, patchWebSearch, patchLocalTools, patchMcpErrors };
if (require.main === module) {
  provisionRipgrep();
  for (const file of filesToPatch) patchFile(file);
}
