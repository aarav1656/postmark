import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA } from './schema.ts';

const dataDir = process.env.DATA_DIR || './data';
mkdirSync(dataDir, { recursive: true });
export const db = new DatabaseSync(join(dataDir, 'app.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(SCHEMA);
const orderColumns = new Set((db.prepare('PRAGMA table_info(orders)').all() as Array<{ name: string }>).map((column) => column.name));
if (!orderColumns.has('listing_id')) db.exec('ALTER TABLE orders ADD COLUMN listing_id TEXT');
if (!orderColumns.has('archived_at')) db.exec('ALTER TABLE orders ADD COLUMN archived_at TEXT');
