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

  // Look for the exact generateContentStream setLatestApiRequest pattern or already patched marker
  const alreadyPatchedMarker = /\/\/ __REAL_FINAL_API_REQUEST_CAPTURED__[\s\S]*?process\.stdout\.write\(JSON\.stringify\(_captureEvent\) \+ "\\n"\);\s*\}\s*catch \(_err\) \{\}/;
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
          process.stdout.write(JSON.stringify(_captureEvent) + "\\n");
        } catch (_err) {}`;

  if (alreadyPatchedMarker.test(content)) {
    content = content.replace(alreadyPatchedMarker, streamReplacement);
  } else if (originalTargetPattern.test(content)) {
    content = content.replace(originalTargetPattern, streamReplacement);
  } else {
    console.log(`[patch] Pattern not found in: ${fileName}`);
    return;
  }

  // Also patch generateContent (non-stream) if present
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
        process.stdout.write(JSON.stringify(_captureEvent) + "\\n");
      } catch (_err) {}`;
    });
  }

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`[patch] Successfully patched: ${fileName}`);
}

for (const file of filesToPatch) {
  patchFile(file);
}
