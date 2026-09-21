import fs from 'node:fs';
import path from 'node:path';
import { SkillConfig } from '../src/types.js';
import { getGuiDataDir } from './paths-service.js';

const DEFAULT_SKILLS: SkillConfig[] = [
  {
    name: 'debugging',
    description: 'Diagnóstico e correção de bugs com validação empírica e preservação de estado válido.',
    content: `reproduzir/confirmar problema → identificar causa com evidências → inspecionar código/dependências/contexto → corrigir causa raiz → executar testes/validação → se falhar, preservar estado válido, diagnosticar, corrigir e testar novamente → nunca declarar resolução sem validação real.`,
    enabled: true,
    statusGrade: 'CONFIGURED',
  },
  {
    name: 'code-review',
    description: 'Revisão crítica baseada em evidências, avaliando correção, arquitetura, segurança e manutenção.',
    content: `compreender intenção/contexto → verificar correção, arquitetura, segurança, manutenção e regressões → priorizar por impacto → apresentar evidências concretas → corrigir quando solicitado → validar correções → não inventar problemas especulativos.`,
    enabled: true,
    statusGrade: 'CONFIGURED',
  },
  {
    name: 'testing',
    description: 'Criação, execução e análise de suítes de testes com validação baseada em evidências.',
    content: `identificar comportamento esperado → selecionar/criar testes relevantes → executar → analisar resultados/falhas → corrigir quando solicitado → executar novamente → não declarar validação sem evidência.`,
    enabled: true,
    statusGrade: 'CONFIGURED',
  },
  {
    name: 'project-conventions',
    description: 'Inspeção e aplicação estrita das convenções existentes no projeto sem criar regras desnecessárias.',
    content: `inspecionar estrutura/código/configuração → identificar padrões reais do projeto → priorizar convenções existentes → aplicar → não criar novas convenções sem necessidade → apontar conflitos e preservar decisão existente até confirmação.`,
    enabled: true,
    statusGrade: 'CONFIGURED',
  },
];

export function getSkillsDirectory(customDir?: string): string {
  const base = customDir || getGuiDataDir();
  return path.join(base, '.gemini', 'skills');
}

export function ensureSkillsSeeded(targetDir?: string): SkillConfig[] {
  const skillsDir = getSkillsDirectory(targetDir);
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
  }

  const existingSkills = loadSkills(targetDir);
  if (existingSkills.length === 0) {
    for (const skill of DEFAULT_SKILLS) {
      saveSkillToFile(skill, targetDir);
    }
    return DEFAULT_SKILLS;
  }
  return existingSkills;
}

export function loadSkills(targetDir?: string): SkillConfig[] {
  const skillsDir = getSkillsDirectory(targetDir);
  if (!fs.existsSync(skillsDir)) {
    return [];
  }

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  const list: SkillConfig[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillFilePath = path.join(skillsDir, entry.name, 'SKILL.md');
      if (fs.existsSync(skillFilePath)) {
        try {
          const raw = fs.readFileSync(skillFilePath, 'utf8');
          const parsed = parseSkillMarkdown(raw, entry.name);
          if (parsed) list.push(parsed);
        } catch {
          // Continue
        }
      }
    }
  }

  return list.length > 0 ? list : DEFAULT_SKILLS;
}

export function saveSkillToFile(skill: SkillConfig, targetDir?: string) {
  const skillsDir = getSkillsDirectory(targetDir);
  const skillFolder = path.join(skillsDir, skill.name);
  if (!fs.existsSync(skillFolder)) {
    fs.mkdirSync(skillFolder, { recursive: true });
  }

  const fileContent = [
    '---',
    `name: ${skill.name}`,
    `description: "${skill.description.replace(/"/g, '\\"')}"`,
    '---',
    '',
    skill.content,
  ].join('\n');

  fs.writeFileSync(path.join(skillFolder, 'SKILL.md'), fileContent, 'utf8');
}

export function deleteSkill(name: string, targetDir?: string): boolean {
  const skillFolder = path.join(getSkillsDirectory(targetDir), name);
  if (fs.existsSync(skillFolder)) {
    fs.rmSync(skillFolder, { recursive: true, force: true });
    return true;
  }
  return false;
}

function parseSkillMarkdown(content: string, folderName: string): SkillConfig | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return {
      name: folderName,
      description: folderName,
      content,
      enabled: true,
      statusGrade: 'CONFIGURED',
    };
  }

  const fm = match[1];
  const body = match[2].trim();
  const fields: Record<string, string> = {};

  for (const line of fm.split('\n')) {
    const sep = line.indexOf(':');
    if (sep > 0) {
      const key = line.slice(0, sep).trim();
      let val = line.slice(sep + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      fields[key] = val;
    }
  }

  return {
    name: fields['name'] || folderName,
    description: fields['description'] || folderName,
    content: body,
    enabled: fields['enabled'] !== 'false',
    statusGrade: 'CONFIGURED',
  };
}

export function resetDefaultSkills(targetDir?: string): SkillConfig[] {
  const skillsDir = getSkillsDirectory(targetDir);
  if (fs.existsSync(skillsDir)) {
    fs.rmSync(skillsDir, { recursive: true, force: true });
  }
  fs.mkdirSync(skillsDir, { recursive: true });
  for (const skill of DEFAULT_SKILLS) {
    saveSkillToFile(skill, targetDir);
  }
  return DEFAULT_SKILLS;
}

export function overwriteSkills(skills: SkillConfig[], targetDir?: string): void {
  const skillsDir = getSkillsDirectory(targetDir);
  if (fs.existsSync(skillsDir)) {
    fs.rmSync(skillsDir, { recursive: true, force: true });
  }
  fs.mkdirSync(skillsDir, { recursive: true });
  for (const skill of skills) {
    saveSkillToFile(skill, targetDir);
  }
}
