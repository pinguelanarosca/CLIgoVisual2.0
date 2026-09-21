import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadAgents, resetAllAgentsToDefault, overwriteAgents } from './agents-service.js';
import { loadSkills, resetDefaultSkills, overwriteSkills } from './skills-service.js';
import { loadCommands, resetDefaultCommands, overwriteCommands } from './commands-service.js';
import { loadMcpSettings, resetDefaultMcp, overwriteMcp, getSettingsFilePath } from './mcp-service.js';
import { loadPolicies, resetDefaultPolicies, overwritePolicies } from './policies-service.js';
import {
  getSessions,
  getProjects,
  getAuthorizedDirs,
  overwriteProjects,
  overwriteSessions,
  overwriteAuthorizedDirs,
  resetProjectsAndSessions,
} from './projects-and-dirs-service.js';
import { clearLogs, sysLog } from './logger-service.js';
import { getGuiDataDir } from './paths-service.js';
import { AgentConfig, SkillConfig, CommandConfig, McpConfig, PolicyConfig, ProjectItem, SessionItem } from '../src/types.js';

export interface BackupExportData {
  version: string;
  appName: string;
  createdAt: string;
  metadata: {
    totalSessions: number;
    totalAgents: number;
    totalSkills: number;
    totalCommands: number;
    totalMcpServers: number;
    totalPolicies: number;
    totalProjects: number;
    exportedSections: string[];
  };
  generalSettings?: {
    theme?: 'dark' | 'light';
    approvalMode?: string;
    cliPath?: string;
    modelConfigs?: Record<string, any>;
  };
  agents?: AgentConfig[];
  sessions?: SessionItem[];
  skills?: SkillConfig[];
  commands?: CommandConfig[];
  mcpServers?: McpConfig[];
  policies?: PolicyConfig[];
  projects?: ProjectItem[];
  authorizedDirs?: string[];
  audioSettings?: any;
  contextSettings?: any;
}

export function exportFullSystemBackup(allowedSections?: string[]): BackupExportData {
  const sections = allowedSections && allowedSections.length > 0
    ? new Set(allowedSections)
    : new Set([
        'generalSettings',
        'agents',
        'sessions',
        'chatHistory',
        'skills',
        'commands',
        'mcpServers',
        'policies',
        'projects',
        'authorizedDirs',
        'audioSettings',
        'contextSettings',
      ]);

  const allAgents = loadAgents();
  const allSessions = getSessions();
  const allSkills = loadSkills();
  const allCommands = loadCommands();
  const allMcp = loadMcpSettings();
  const allPolicies = loadPolicies();
  const allProjects = getProjects();
  const allDirs = getAuthorizedDirs().map((d) => d.path);

  // Read settings.json for general configurations
  let settingsJson: any = {};
  const settingsFile = getSettingsFilePath();
  if (fs.existsSync(settingsFile)) {
    try {
      settingsJson = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    } catch {
      settingsJson = {};
    }
  }

  const exportData: BackupExportData = {
    version: '2.0.0',
    appName: 'Gemini CLI Visual GUI',
    createdAt: new Date().toISOString(),
    metadata: {
      totalSessions: allSessions.length,
      totalAgents: allAgents.length,
      totalSkills: allSkills.length,
      totalCommands: allCommands.length,
      totalMcpServers: allMcp.length,
      totalPolicies: allPolicies.length,
      totalProjects: allProjects.length,
      exportedSections: Array.from(sections),
    },
  };

  if (sections.has('generalSettings')) {
    exportData.generalSettings = {
      theme: 'dark',
      approvalMode: settingsJson.approvalMode || 'default',
      cliPath: settingsJson.cliPath,
      modelConfigs: settingsJson.modelConfigs || {},
    };
  }

  if (sections.has('agents')) {
    exportData.agents = allAgents;
  }

  if (sections.has('sessions') || sections.has('chatHistory')) {
    exportData.sessions = allSessions;
  }

  if (sections.has('skills')) {
    exportData.skills = allSkills;
  }

  if (sections.has('commands')) {
    exportData.commands = allCommands;
  }

  if (sections.has('mcpServers')) {
    exportData.mcpServers = allMcp;
  }

  if (sections.has('policies')) {
    exportData.policies = allPolicies;
  }

  if (sections.has('projects')) {
    exportData.projects = allProjects;
  }

  if (sections.has('authorizedDirs')) {
    exportData.authorizedDirs = allDirs;
  }

  sysLog.info('SYSTEM', `Backup completo exportado (${exportData.metadata.exportedSections.length} seções incluídas)`);
  return exportData;
}

export function restoreSystemBackup(
  backupData: any,
  selectedSections: Record<string, boolean>
): { success: boolean; message: string; restoredSections: string[] } {
  if (!backupData || typeof backupData !== 'object') {
    return {
      success: false,
      message: 'Arquivo de backup inválido ou corrompido (formato não é um objeto JSON válido).',
      restoredSections: [],
    };
  }

  const restoredSections: string[] = [];

  try {
    // 1. Agentes
    if (selectedSections.agents && Array.isArray(backupData.agents) && backupData.agents.length > 0) {
      overwriteAgents(backupData.agents);
      restoredSections.push(`Agentes (${backupData.agents.length})`);
    }

    // 2. Histórico de Conversas e Sessões
    if (
      (selectedSections.chatHistory || selectedSections.sessions) &&
      Array.isArray(backupData.sessions)
    ) {
      overwriteSessions(backupData.sessions);
      restoredSections.push(`Sessões/Histórico (${backupData.sessions.length})`);
    }

    // 3. Skills
    if (selectedSections.skills && Array.isArray(backupData.skills) && backupData.skills.length > 0) {
      overwriteSkills(backupData.skills);
      restoredSections.push(`Skills (${backupData.skills.length})`);
    }

    // 4. Comandos
    if (selectedSections.commands && Array.isArray(backupData.commands) && backupData.commands.length > 0) {
      overwriteCommands(backupData.commands);
      restoredSections.push(`Comandos (${backupData.commands.length})`);
    }

    // 5. Servidores MCP
    if (selectedSections.mcpServers && Array.isArray(backupData.mcpServers)) {
      overwriteMcp(backupData.mcpServers);
      restoredSections.push(`MCP Servers (${backupData.mcpServers.length})`);
    }

    // 6. Políticas de Segurança
    if (selectedSections.policies && Array.isArray(backupData.policies) && backupData.policies.length > 0) {
      overwritePolicies(backupData.policies);
      restoredSections.push(`Políticas (${backupData.policies.length})`);
    }

    // 7. Projetos
    if (selectedSections.projects && Array.isArray(backupData.projects) && backupData.projects.length > 0) {
      overwriteProjects(backupData.projects);
      restoredSections.push(`Projetos (${backupData.projects.length})`);
    }

    // 8. Diretórios Autorizados
    if (selectedSections.authorizedDirs && Array.isArray(backupData.authorizedDirs)) {
      overwriteAuthorizedDirs(backupData.authorizedDirs);
      restoredSections.push(`Diretórios Autorizados (${backupData.authorizedDirs.length})`);
    }

    // 9. Configurações Gerais
    if (selectedSections.generalSettings && backupData.generalSettings) {
      const settingsFile = getSettingsFilePath();
      let currentSettings: any = {};
      if (fs.existsSync(settingsFile)) {
        try {
          currentSettings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
        } catch {}
      }
      currentSettings = {
        ...currentSettings,
        ...(backupData.generalSettings.modelConfigs ? { modelConfigs: backupData.generalSettings.modelConfigs } : {}),
      };
      fs.writeFileSync(settingsFile, JSON.stringify(currentSettings, null, 2), 'utf8');
      restoredSections.push('Configurações Gerais');
    }

    sysLog.info('SYSTEM', `Restauração de backup concluída com sucesso. Seções restauradas: ${restoredSections.join(', ')}`);
    return {
      success: true,
      message: `Restauração concluída com sucesso! ${restoredSections.length} seções foram restauradas e sobrescritas.`,
      restoredSections,
    };
  } catch (err: any) {
    sysLog.error('SYSTEM', 'Falha ao restaurar backup', err);
    return {
      success: false,
      message: `Erro durante a restauração do backup: ${err.message}`,
      restoredSections,
    };
  }
}

export function resetSystemToFactoryDefaults(): { success: boolean; message: string } {
  try {
    // 1. Resetar Agentes
    resetAllAgentsToDefault();

    // 2. Resetar Skills
    resetDefaultSkills();

    // 3. Resetar Comandos
    resetDefaultCommands();

    // 4. Resetar MCPs
    resetDefaultMcp();

    // 5. Resetar Políticas de Segurança
    resetDefaultPolicies();

    // 6. Resetar Projetos, Sessões e Diretórios Autorizados
    resetProjectsAndSessions();

    // 7. Limpar logs
    clearLogs();

    sysLog.warn('SYSTEM', 'Restauração de padrões de fábrica concluída: todas as configurações e históricos foram redefinidos para o estado original.');

    return {
      success: true,
      message: 'Todos os padrões de fábrica foram restaurados com sucesso. Agentes, comandos, skills, políticas e histórico de chat foram redefinidos.',
    };
  } catch (err: any) {
    sysLog.error('SYSTEM', 'Falha ao redefinir para padrões de fábrica', err);
    return {
      success: false,
      message: `Erro ao restaurar padrões de fábrica: ${err.message}`,
    };
  }
}
