const fs = require('fs');
const path = require('path');

const bundleDir = path.resolve(__dirname, '../node_modules/@google/gemini-cli/bundle');

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

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`[patch] Successfully patched: ${fileName}`);
}

for (const file of filesToPatch) {
  patchFile(file);
}
