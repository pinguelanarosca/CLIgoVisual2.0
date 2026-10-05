import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { SessionItem } from '../src/types.js';
import { getGuiDataDir } from './paths-service.js';
import { sysLog } from './logger-service.js';

let db: DatabaseSync | null = null;
let transactionDepth = 0;
function getDb(): DatabaseSync {
  if (db) return db;
  const dataDir = getGuiDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  const database = new DatabaseSync(path.join(dataDir, 'sessions.db'));
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, projectId TEXT, title TEXT NOT NULL,
      isArchived INTEGER DEFAULT 0, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
      messageCount INTEGER DEFAULT 0, statusGrade TEXT DEFAULT 'VALIDATED', payloadJson TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, sessionId TEXT NOT NULL, role TEXT NOT NULL, content TEXT,
      timestamp TEXT, model TEXT, agentName TEXT, sequence INTEGER NOT NULL, payloadJson TEXT,
      FOREIGN KEY (sessionId) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(projectId);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updatedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(sessionId, sequence ASC);
  `);
  if (!(database.prepare('PRAGMA table_info(sessions)').all() as any[]).some(c => c.name === 'payloadJson')) {
    const backups = path.join(dataDir, 'backups');
    fs.mkdirSync(backups, { recursive: true, mode: 0o700 });
    const backup = path.join(backups, `sessions-before-schema-${Date.now()}.db`);
    database.prepare('VACUUM INTO ?').run(backup);
    fs.chmodSync(backup, 0o600);
    database.exec('ALTER TABLE sessions ADD COLUMN payloadJson TEXT;');
    sysLog.info('SQLITE', `Backup consistente antes da migração: ${backup}`);
  }
  db = database;
  sysLog.info('SQLITE', 'Banco de sessões inicializado.');
  return database;
}

function transaction<T>(operation: () => T): T {
  if (transactionDepth) return operation();
  const database = getDb();
  database.exec('BEGIN IMMEDIATE');
  transactionDepth++;
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally { transactionDepth--; }
}

export function validateSessionPayload(session: any, requireMessages = false): void {
  if (!session || typeof session !== 'object' || typeof session.id !== 'string' || !session.id.trim()) throw new Error('ID de sessão inválido.');
  for (const key of ['title', 'projectId', 'createdAt', 'updatedAt', 'statusGrade', 'cliSessionId']) {
    if (session[key] !== undefined && session[key] !== null && typeof session[key] !== 'string') throw new Error(`Campo de sessão inválido: ${key}`);
  }
  if (session.isArchived !== undefined && typeof session.isArchived !== 'boolean') throw new Error('isArchived inválido.');
  if (requireMessages && !Array.isArray(session.messages)) throw new Error('Backup sem mensagens completas.');
  if (session.messages !== undefined) {
    if (!Array.isArray(session.messages)) throw new Error('Lista de mensagens inválida.');
    const seen = new Set<string>();
    for (const msg of session.messages) {
      if (!msg || typeof msg.id !== 'string' || !msg.id.trim() || seen.has(msg.id)) throw new Error('ID de mensagem inválido ou duplicado.');
      seen.add(msg.id);
      if (!['user', 'assistant', 'system', 'model', 'tool'].includes(msg.role) || typeof msg.content !== 'string') throw new Error('Papel ou conteúdo de mensagem inválido.');
      for (const key of ['timestamp', 'model', 'agentName']) if (msg[key] !== undefined && msg[key] !== null && typeof msg[key] !== 'string') throw new Error(`Campo de mensagem inválido: ${key}`);
    }
  }
  if (session.executionContext !== undefined && (!Array.isArray(session.executionContext) || session.executionContext.some((m: any) => !m || !['user', 'assistant', 'system'].includes(m.role) || typeof m.content !== 'string'))) throw new Error('Contexto de sessão inválido.');
  // Serialize before touching the database (also rejects cyclic objects / BigInt).
  JSON.stringify(session);
}

function mapSession(row: any, messages: any[] = []): SessionItem {
  return {
    ...JSON.parse(row.payloadJson || '{}'), id: row.id, title: row.title,
    projectId: row.projectId || undefined, isArchived: Boolean(row.isArchived),
    createdAt: row.createdAt, updatedAt: row.updatedAt, messageCount: row.messageCount,
    statusGrade: row.statusGrade || 'VALIDATED', messages,
  };
}
export function getSessionsSqlite(projectId?: string): SessionItem[] {
  const database = getDb();
  const rows = projectId
    ? database.prepare('SELECT * FROM sessions WHERE projectId = ? ORDER BY updatedAt DESC').all(projectId)
    : database.prepare('SELECT * FROM sessions ORDER BY updatedAt DESC').all();
  return rows.map(row => { const session = mapSession(row); delete session.executionContext; return session; });
}
export function getSessionByIdSqlite(id: string): SessionItem | null {
  const database = getDb();
  const row = database.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!row) return null;
  const messages = database.prepare('SELECT * FROM messages WHERE sessionId = ? ORDER BY sequence ASC').all(id).map((m: any) => {
    const payload = JSON.parse(m.payloadJson || '{}');
    return { ...payload, id: payload.id || m.id, role: m.role, content: m.content || '', timestamp: m.timestamp, model: m.model || undefined, agentName: m.agentName || undefined };
  });
  return mapSession(row, messages);
}
export function exportSessionsSqlite(): SessionItem[] {
  return transaction(() => getSessionsSqlite().map(s => getSessionByIdSqlite(s.id)!));
}
export function saveSessionSqlite(session: SessionItem): SessionItem {
  validateSessionPayload(session);
  return transaction(() => {
    const database = getDb();
    const previousRow = database.prepare('SELECT * FROM sessions WHERE id = ?').get(session.id);
    const previous = previousRow ? mapSession(previousRow) : null;
    const saved = { ...previous, ...session, createdAt: previous?.createdAt || session.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    const messages = session.messages || [];
    const messageCount = session.messages === undefined ? previous?.messageCount || 0 : messages.length;
    const { messages: _, ...metadata } = saved;
    database.prepare(`INSERT INTO sessions (id, projectId, title, isArchived, createdAt, updatedAt, messageCount, statusGrade, payloadJson)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
      projectId=excluded.projectId, title=excluded.title, isArchived=excluded.isArchived,
      updatedAt=excluded.updatedAt, messageCount=excluded.messageCount, statusGrade=excluded.statusGrade, payloadJson=excluded.payloadJson`).run(
      saved.id, saved.projectId || null, saved.title || 'Nova Sessão', saved.isArchived ? 1 : 0,
      saved.createdAt, saved.updatedAt, messageCount, saved.statusGrade || 'VALIDATED', JSON.stringify(metadata));
    if (session.messages !== undefined) {
      database.prepare('DELETE FROM messages WHERE sessionId = ?').run(session.id);
      const insert = database.prepare('INSERT INTO messages (id, sessionId, role, content, timestamp, model, agentName, sequence, payloadJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      messages.forEach((m, i) => insert.run(JSON.stringify([session.id, m.id]), session.id, m.role, m.content, m.timestamp || saved.updatedAt, m.model || null, m.agentName || null, i, JSON.stringify(m)));
    }
    if (session.messages !== undefined) return getSessionByIdSqlite(session.id)!;
    return mapSession(database.prepare('SELECT * FROM sessions WHERE id = ?').get(session.id));
  });
}
export function updateSessionMetadataSqlite(id: string, updates: Partial<SessionItem>): SessionItem {
  if (!getDb().prepare('SELECT id FROM sessions WHERE id = ?').get(id)) throw new Error('Sessão não encontrada.');
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) throw new Error('Metadados inválidos.');
  const allowed = ['title', 'projectId', 'isArchived', 'statusGrade', 'cliSessionId', 'executionContext'];
  if (Object.keys(updates).some(key => !allowed.includes(key))) throw new Error('A atualização de metadados não aceita mensagens.');
  return saveSessionSqlite({ ...updates, id } as SessionItem);
}
export function replaceSessionMessagesSqlite(id: string, updates: Pick<SessionItem, 'messages' | 'cliSessionId' | 'executionContext'>): SessionItem {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) throw new Error('Mensagens inválidas.');
  if (Object.keys(updates).some(key => !['messages', 'cliSessionId', 'executionContext'].includes(key))) throw new Error('A substituição de mensagens não aceita metadados.');
  validateSessionPayload({ ...updates, id }, true);
  return transaction(() => {
    if (!getDb().prepare('SELECT id FROM sessions WHERE id = ?').get(id)) throw new Error('Sessão não encontrada.');
    return saveSessionSqlite({ ...updates, id } as SessionItem);
  });
}
export function importSessionsSqlite(sessions: SessionItem[]): void {
  if (!Array.isArray(sessions)) throw new Error('Backup de sessões inválido.');
  const ids = new Set<string>();
  sessions.forEach(s => { validateSessionPayload(s, true); if (ids.has(s.id)) throw new Error('Sessão duplicada no backup.'); ids.add(s.id); });
  // Snapshot includes WAL content; never copy just the main database file.
  const backups = path.join(getGuiDataDir(), 'backups');
  fs.mkdirSync(backups, { recursive: true, mode: 0o700 });
  const backup = path.join(backups, `sessions-before-restore-${Date.now()}.db`);
  getDb().prepare('VACUUM INTO ?').run(backup);
  fs.chmodSync(backup, 0o600);
  transaction(() => { getDb().exec('DELETE FROM sessions'); sessions.forEach(session => { saveSessionSqlite(session); if (session.updatedAt) getDb().prepare('UPDATE sessions SET updatedAt = ? WHERE id = ?').run(session.updatedAt, session.id); }); });
}
export function migrateSessionsFromStore(sessions: SessionItem[]): void {
  if (!sessions?.length) return;
  sessions.forEach(s => validateSessionPayload(s, true));
  transaction(() => { sessions.forEach(s => { if (!getSessionByIdSqlite(s.id)) saveSessionSqlite(s); }); });
  sysLog.info('SQLITE', `Migração concluída: ${sessions.length} sessões verificadas.`);
}
export function deleteSessionSqlite(id: string): boolean {
  return transaction(() => { getDb().prepare('DELETE FROM sessions WHERE id = ?').run(id); return true; });
}
export function clearAllSessionsSqlite(): void { transaction(() => getDb().exec('DELETE FROM sessions')); }
