// middleware/audit.js — payload-type audit log (R6, §17 L1055 / §21.4 L1274).
// Append-only JSONL of call METADATA only — provider, model, declared payload
// types (source / DOM / screenshot / trace / contract), usage, cost. Never the
// prompt content. Tamper-evident/signed storage is a PILOT item (§21.4).

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIT_DIR = join(__dirname, '..', 'audit');
const AUDIT_FILE = join(AUDIT_DIR, 'gateway-audit.jsonl');

export function log(entry) {
  mkdirSync(AUDIT_DIR, { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  appendFileSync(AUDIT_FILE, line + '\n');
}

export const AUDIT_PATH = AUDIT_FILE;
