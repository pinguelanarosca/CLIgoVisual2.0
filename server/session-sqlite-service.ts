import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { SessionItem, ChatMessage } from '../src/types.js';
import { getGuiDataDir } from './paths-service.js';
import { sysLog } from './logger-service.js';

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;

  const dataDir = getGuiDataDir();
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, 'sessions.db');
  db = new DatabaseSync(dbPath);

  // Enable WAL mode & foreign keys for performance
  try {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
  } catch (err) {
    // Ignore PRAGMA errors if unsupported
  }

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      projectId TEXT,
      title TEXT NOT NULL,
      isArchived INTEGER DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      messageCount INTEGER DEFAULT 0,
      statusGrade TEXT DEFAULT 'VALIDATED'
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      timestamp TEXT,
      model TEXT,
      agentName TEXT,
      sequence INTEGER NOT NULL,
      payloadJson TEXT,
      FOREIGN KEY (sessionId) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(projectId);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updatedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(sessionId, sequence ASC);
  `);

  sysLog.info('SQLITE', `Banco de dados SQLite de sessões inicializado em ${dbPath}`);
  return db;
}

export function migrateSessionsFromStore(legacySessions: SessionItem[]): void {
  if (!legacySessions || legacySessions.length === 0) return;

  const database = getDb();
  const countRow = database.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number } | undefined;
  if (countRow && countRow.count > 0) {
    return; // Migration already done or SQLite contains sessions
  }

  sysLog.info('SQLITE', `Migrando ${legacySessions.length} sessão(ões) do storage.json para SQLite...`);

  const insertSession = database.prepare(`
    INSERT OR REPLACE INTO sessions (id, projectId, title, isArchived, createdAt, updatedAt, messageCount, statusGrade)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMessage = database.prepare(`
    INSERT OR REPLACE INTO messages (id, sessionId, role, content, timestamp, model, agentName, sequence, payloadJson)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const session of legacySessions) {
    try {
      insertSession.run(
        session.id,
        session.projectId || null,
        session.title || 'Sessão sem título',
        session.isArchived ? 1 : 0,
        session.createdAt || new Date().toISOString(),
        session.updatedAt || new Date().toISOString(),
        session.messages?.length || 0,
        session.statusGrade || 'VALIDATED'
      );

      if (Array.isArray(session.messages)) {
        session.messages.forEach((msg, idx) => {
          const payload = {
            toolCalls: msg.toolCalls,
            error: msg.error,
            audioUrl: msg.audioUrl,
            isNarrating: msg.isNarrating,
            finalApiRequest: msg.finalApiRequest,
            parameterOrigins: msg.parameterOrigins,
            rawPayloadSent: msg.rawPayloadSent,
            rawPayloadReceived: msg.rawPayloadReceived,
          };

          insertMessage.run(
            msg.id,
            session.id,
            msg.role,
            msg.content || '',
            msg.timestamp || new Date().toISOString(),
            msg.model || null,
            msg.agentName || null,
            idx,
            JSON.stringify(payload)
          );
        });
      }
    } catch (err) {
      sysLog.error('SQLITE', `Erro ao migrar sessão ${session.id}`, err);
    }
  }

  sysLog.info('SQLITE', 'Migração para SQLite concluída com sucesso!');
}

export function getSessionsSqlite(projectId?: string): SessionItem[] {
  const database = getDb();
  let stmt;
  let rows: any[];

  if (projectId) {
    stmt = database.prepare('SELECT * FROM sessions WHERE projectId = ? ORDER BY updatedAt DESC');
    rows = stmt.all(projectId);
  } else {
    stmt = database.prepare('SELECT * FROM sessions ORDER BY updatedAt DESC');
    rows = stmt.all();
  }

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    projectId: row.projectId || undefined,
    isArchived: Boolean(row.isArchived),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    messageCount: row.messageCount,
    statusGrade: row.statusGrade || 'VALIDATED',
    messages: [], // Message details loaded on demand or per session fetch
  }));
}

export function getSessionByIdSqlite(id: string): SessionItem | null {
  const database = getDb();
  const sessionRow = database.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
  if (!sessionRow) return null;

  const msgRows = database.prepare('SELECT * FROM messages WHERE sessionId = ? ORDER BY sequence ASC').all(id) as any[];

  const messages: ChatMessage[] = msgRows.map((msgRow) => {
    let extra: any = {};
    if (msgRow.payloadJson) {
      try {
        extra = JSON.parse(msgRow.payloadJson);
      } catch {}
    }

    return {
      id: msgRow.id,
      role: msgRow.role,
      content: msgRow.content || '',
      timestamp: msgRow.timestamp,
      model: msgRow.model || undefined,
      agentName: msgRow.agentName || undefined,
      toolCalls: extra.toolCalls,
      error: extra.error,
      audioUrl: extra.audioUrl,
      isNarrating: extra.isNarrating,
      finalApiRequest: extra.finalApiRequest,
      parameterOrigins: extra.parameterOrigins,
      rawPayloadSent: extra.rawPayloadSent,
      rawPayloadReceived: extra.rawPayloadReceived,
    };
  });

  return {
    id: sessionRow.id,
    title: sessionRow.title,
    projectId: sessionRow.projectId || undefined,
    isArchived: Boolean(sessionRow.isArchived),
    createdAt: sessionRow.createdAt,
    updatedAt: sessionRow.updatedAt,
    messageCount: sessionRow.messageCount,
    statusGrade: sessionRow.statusGrade || 'VALIDATED',
    messages,
  };
}

export function saveSessionSqlite(session: SessionItem): SessionItem {
  const database = getDb();
  const now = new Date().toISOString();

  const insertSession = database.prepare(`
    INSERT OR REPLACE INTO sessions (id, projectId, title, isArchived, createdAt, updatedAt, messageCount, statusGrade)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertSession.run(
    session.id,
    session.projectId || null,
    session.title || 'Nova Sessão',
    session.isArchived ? 1 : 0,
    session.createdAt || now,
    now,
    session.messages ? session.messages.length : session.messageCount || 0,
    session.statusGrade || 'VALIDATED'
  );

  if (Array.isArray(session.messages)) {
    // Replace all messages for this session
    database.prepare('DELETE FROM messages WHERE sessionId = ?').run(session.id);

    const insertMessage = database.prepare(`
      INSERT INTO messages (id, sessionId, role, content, timestamp, model, agentName, sequence, payloadJson)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    session.messages.forEach((msg, idx) => {
      const payload = {
        toolCalls: msg.toolCalls,
        error: msg.error,
        audioUrl: msg.audioUrl,
        isNarrating: msg.isNarrating,
        finalApiRequest: msg.finalApiRequest,
        parameterOrigins: msg.parameterOrigins,
        rawPayloadSent: msg.rawPayloadSent,
        rawPayloadReceived: msg.rawPayloadReceived,
      };

      insertMessage.run(
        msg.id,
        session.id,
        msg.role,
        msg.content || '',
        msg.timestamp || now,
        msg.model || null,
        msg.agentName || null,
        idx,
        JSON.stringify(payload)
      );
    });
  }

  return {
    ...session,
    updatedAt: now,
    messageCount: session.messages ? session.messages.length : session.messageCount || 0,
  };
}

export function deleteSessionSqlite(id: string): boolean {
  const database = getDb();
  database.prepare('DELETE FROM messages WHERE sessionId = ?').run(id);
  database.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  return true;
}
