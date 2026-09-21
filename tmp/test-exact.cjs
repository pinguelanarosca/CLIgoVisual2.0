const { spawn } = require("child_process");
const fs = require("fs");
const crypto = require("crypto");
const t0 = performance.now();

const tempSettings = "/tmp/test-settings-compare.json";
fs.writeFileSync(tempSettings, JSON.stringify({
  mcpServers: {
    github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: {} },
    exa: {
      url: "https://mcp.exa.ai/mcp",
      type: "http",
      trust: true,
      headers: {
        "x-api-key": process.env.EXA_API_KEY || "",
        "Authorization": "Bearer " + (process.env.EXA_API_KEY || ""),
        "Accept": "application/json, text/event-stream"
      },
      env: { "EXA_API_KEY": process.env.EXA_API_KEY || "" }
    }
  },
  modelConfigs: {
    customAliases: {
      principal: {
        modelConfig: {
          model: "gemini-3.5-flash-lite",
          generateContentConfig: { temperature: 0.2, topP: 0.95, topK: 40 }
        }
      }
    }
  },
  policyPaths: ["/root/.local/share/gemini-gui/.gemini/policies"],
  adminPolicyPaths: ["/root/.local/share/gemini-gui/.gemini/policies"]
}));

const systemPromptFile = "/tmp/test-system.md";
fs.writeFileSync(systemPromptFile, "Você é o Principal Orchestrator do Gemini CLI.");

const prompt = `[CONTEXTO DO PROJETO E WORKSPACE]
Você está executando dentro do diretório do projeto: "/app/applet".
Diretórios autorizados do projeto: /app/applet.
Sempre inspecione e responda com base nos arquivos localizados neste diretório.
---

Qual a versão do projeto declarada no package.json? Use read_file para verificar.`;

const child = spawn("node", [
  "/app/applet/node_modules/.bin/gemini",
  "-p", prompt,
  "-o", "stream-json",
  "--skip-trust",
  "--policy", "/root/.local/share/gemini-gui/.gemini/policies",
  "--admin-policy", "/root/.local/share/gemini-gui/.gemini/policies",
  "--policy", "/app/applet/.gemini/policies",
  "--admin-policy", "/app/applet/.gemini/policies",
  "--policy", "/root/.local/share/gemini-gui/.gemini/web-preview-policy.toml",
  "-m", "gemini-3.5-flash-lite",
  "--approval-mode", "default",
  "--include-directories", "/app/applet",
  "--session-id", crypto.randomUUID()
], {
  cwd: "/app/applet",
  env: {
    ...process.env,
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    GEMINI_CLI_SYSTEM_SETTINGS_PATH: tempSettings,
    GEMINI_SYSTEM_MD: systemPromptFile
  }
});

let lastTime = t0;
child.stdout.on("data", (d) => {
  const now = performance.now();
  const elapsed = (now - t0).toFixed(0);
  const delta = (now - lastTime).toFixed(0);
  lastTime = now;
  const str = d.toString().trim();
  for (const line of str.split("\n")) {
    try {
      const p = JSON.parse(line.trim());
      console.log(`[STDOUT ${elapsed}ms (+${delta}ms)] type=${p.type} name=${p.name || p.tool_name || p.role || ""} status=${p.status || ""} content=${(p.content || "").substring(0, 40)}`);
    } catch {
      console.log(`[STDOUT ${elapsed}ms (+${delta}ms)] ${line.substring(0, 100)}`);
    }
  }
});

child.stderr.on("data", (d) => {
  const now = performance.now();
  const elapsed = (now - t0).toFixed(0);
  const delta = (now - lastTime).toFixed(0);
  lastTime = now;
  console.log(`[STDERR ${elapsed}ms (+${delta}ms)] ${d.toString().trim().substring(0, 120)}`);
});

child.on("close", (code) => {
  console.log(`[CLOSE ${(performance.now() - t0).toFixed(0)}ms] exitCode=${code}`);
  try { fs.unlinkSync(tempSettings); fs.unlinkSync(systemPromptFile); } catch {}
});
