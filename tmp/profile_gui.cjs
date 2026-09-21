const crypto = require("crypto");

async function profileGUIRequest(promptText, label) {
  console.log(`\n===============================================================`);
  console.log(`PROFILING: ${label}`);
  console.log(`Prompt: "${promptText}"`);
  console.log(`===============================================================`);

  const t0 = performance.now();
  const sessionId = crypto.randomUUID();

  const body = {
    executionId: "prof_" + Date.now(),
    prompt: promptText,
    model: "gemini-3.5-flash-lite",
    approvalMode: "default",
    authorizedDirs: ["/app/applet"],
    sessionId: sessionId,
    resume: false,
    workDir: "/app/applet",
    agentId: "principal",
    thinking: true,
    thinkingLevel: "low",
    systemInstructions: "Você é o Principal Orchestrator do Gemini CLI.",
    overrideBasePrompt: false
  };

  const tHttpStart = performance.now();
  const res = await fetch("http://localhost:3000/api/cli/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const tHttpConnected = performance.now();

  console.log(`[T+${(tHttpConnected - t0).toFixed(0)}ms] Conectado ao endpoint SSE (Status: ${res.status}, Handshake: ${(tHttpConnected - tHttpStart).toFixed(0)}ms)`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastEventTime = tHttpConnected;
  const events = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (!raw) continue;
      try {
        const payload = JSON.parse(raw);
        const now = performance.now();
        const elapsed = now - t0;
        const delta = now - lastEventTime;
        lastEventTime = now;

        const eventRecord = {
          elapsedMs: elapsed,
          deltaMs: delta,
          type: payload.type,
          role: payload.role,
          name: payload.tool_name || payload.name || "",
          status: payload.status,
          callId: payload.tool_id || payload.call_id || "",
          preview: (payload.content || payload.text || "").replace(/\n/g, " ").substring(0, 70),
          stats: payload.stats
        };
        events.push(eventRecord);

        console.log(`  -> [T+${elapsed.toFixed(0).padStart(5, " ")}ms | +${delta.toFixed(0).padStart(4, " ")}ms] Event: ${(payload.type || "unknown").padEnd(16, " ")} ${eventRecord.name ? `name=${eventRecord.name.padEnd(15, " ")}` : "                "} ${eventRecord.status ? `status=${eventRecord.status.padEnd(8, " ")}` : "               "} ${eventRecord.preview ? `"${eventRecord.preview}"` : ""}`);
      } catch (err) {}
    }
  }

  const totalTime = performance.now() - t0;
  console.log(`---------------------------------------------------------------`);
  console.log(`TEMPO TOTAL DE PONTA A PONTA: ${totalTime.toFixed(0)}ms`);
  
  // Análise dos intervalos
  const tInit = events.find(e => e.type === "init")?.elapsedMs || 0;
  const tFirstToolUse = events.find(e => e.type === "tool_use")?.elapsedMs || 0;
  const tFirstToolRes = events.find(e => e.type === "tool_result")?.elapsedMs || 0;
  const tFirstAssistantToken = events.find(e => e.type === "message" && e.role === "assistant")?.elapsedMs || 0;
  const tResult = events.find(e => e.type === "result")?.elapsedMs || 0;

  console.log(`\nANÁLISE DE INTERVALOS:`);
  console.log(`  1. Overhead de Inicialização (Spawn CLI + Node + Settings + MCP Handshake): ${tInit.toFixed(0)}ms`);
  if (tFirstToolUse > 0) {
    console.log(`  2. Tempo para o modelo DECIDIR chamar a Tool (Init -> Prompt enviado -> API Google -> Tool Decision): ${(tFirstToolUse - tInit).toFixed(0)}ms`);
    console.log(`  3. Tempo de Execução Local da Tool (Validação de Política + Execução no Disco): ${(tFirstToolRes - tFirstToolUse).toFixed(0)}ms`);
    if (tFirstAssistantToken > 0) {
      console.log(`  4. Gargalo Pós-Tool (Tool Result enviado -> API Google processa -> 1º token de resposta): ${(tFirstAssistantToken - tFirstToolRes).toFixed(0)}ms`);
    }
  } else if (tFirstAssistantToken > 0) {
    console.log(`  2. TTFT Direto sem Tool (Init -> API Google -> 1º Token): ${(tFirstAssistantToken - tInit).toFixed(0)}ms`);
  }
  if (tResult > 0 && tFirstAssistantToken > 0) {
    console.log(`  5. Tempo de Streaming do Texto de Resposta: ${(tResult - tFirstAssistantToken).toFixed(0)}ms`);
  }
  console.log(`===============================================================\n`);
}

async function run() {
  await profileGUIRequest("Qual a versão no package.json? Use read_file.", "CENÁRIO 1: Chamada de Tool de Leitura de Arquivo");
  await profileGUIRequest("Diga apenas 'Olá, sistema operacional'. Não use nenhuma ferramenta.", "CENÁRIO 2: Resposta Direta sem Ferramentas");
  await profileGUIRequest("Use grep_search para procurar 'getGuiDataDir' em 'server/' e resuma em 1 frase.", "CENÁRIO 3: Chamada de Tool de Busca (grep_search)");
}

run();
