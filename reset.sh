#!/usr/bin/env bash
set -e

echo "=================================================================="
echo "    GCLI VISUAL INTERFACE - RESET PARA RECÉM-INSTALADO           "
echo "=================================================================="

# Determine user home paths
TARGET_USER_HOME="${HOME:-/root}"
USER_HOMES=("$TARGET_USER_HOME")

if [ -n "$SUDO_USER" ] && [ "$SUDO_USER" != "root" ]; then
    SUDO_HOME=$(eval echo "~$SUDO_USER" 2>/dev/null || true)
    if [ -n "$SUDO_HOME" ]; then
        USER_HOMES+=("$SUDO_HOME")
    fi
fi

echo "Removendo dados e estados persistidos da aplicação..."

# 1. Remover banco de dados de persistência local e dados da GUI
rm -f .gemini-gui-storage.json
for UHOME in "${USER_HOMES[@]}"; do
    if [ -n "$UHOME" ]; then
        rm -rf "$UHOME/.local/share/gemini-gui"
    fi
done

# 2. Remover arquivos temporários de log e empacotamento
rm -f cli-debug.log
rm -f /tmp/gemini-gui-*.log
rm -f /tmp/gemini-client-error-*.json
rm -rf dist-ubuntu

echo "Recriando configurações e sementes iniciais limpas..."
if command -v npx &> /dev/null; then
    npx tsx -e '
      import { ensureDefaultUserPolicies, syncPoliciesToSettings } from "./server/policies-service.js";
      import { ensureAgentsSeeded } from "./server/agents-service.js";
      import { ensureSkillsSeeded } from "./server/skills-service.js";
      import { ensureCommandsSeeded } from "./server/commands-service.js";
      import { loadMcpSettings } from "./server/mcp-service.js";

      ensureAgentsSeeded();
      ensureSkillsSeeded();
      ensureCommandsSeeded();
      loadMcpSettings();
      ensureDefaultUserPolicies();
      syncPoliciesToSettings();
    ' 2>/dev/null || true
fi

echo "=================================================================="
echo "✓ RESET CONCLUÍDO! A aplicação voltou ao estado de recém-instalada."
echo "=================================================================="
