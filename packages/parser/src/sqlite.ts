import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export type Row = Record<string, unknown>;

/** A read-only view of a copied database. */
export type SqliteSnapshot = {
  /** Runs one SELECT and returns its rows. */
  all(sql: string): Row[];
  /** Which engine read it: node:sqlite, or sql.js where node:sqlite is missing. */
  engine: "node:sqlite" | "sql.js";
  close(): Promise<void>;
};

const SIDE_FILES = ["-wal", "-shm"];

async function fileStamp(p: string): Promise<string> {
  try {
    const s = await stat(p);
    return `${s.size}:${s.mtimeMs}`;
  } catch {
    return "-";
  }
}

/**
 * Copies a database and its -wal and -shm files into a new temp folder, so a
 * harness that is running never sees us. The copy is retried when the files
 * changed while being copied, which would mix two states of the database.
 */
async function copyDatabase(file: string): Promise<{ dir: string; copy: string }> {
  const dir = await mkdtemp(join(tmpdir(), "codewrapped-db-"));
  const copy = join(dir, basename(file));
  const parts = [file, ...SIDE_FILES.map((s) => file + s)];
  for (let attempt = 0; ; attempt++) {
    const before = await Promise.all(parts.map(fileStamp));
    for (const p of parts) if (existsSync(p)) await copyFile(p, join(dir, basename(p)));
    const after = await Promise.all(parts.map(fileStamp));
    if (before.join() === after.join() || attempt >= 4) return { dir, copy };
  }
}

type NodeSqlite = { DatabaseSync: new (path: string, opts?: { readOnly?: boolean }) => NodeDb };
type NodeDb = { prepare(sql: string): { all(): Row[] }; close(): void };

/** node:sqlite without an ExperimentalWarning on stderr, or null where this Node does not have it unflagged. */
async function loadNodeSqlite(): Promise<NodeSqlite | null> {
  const emit = process.emitWarning;
  process.emitWarning = ((w: string | Error, ...rest: unknown[]) => {
    if (String(typeof w === "string" ? w : w.message).includes("SQLite")) return;
    return (emit as (...a: unknown[]) => void).call(process, w, ...rest);
  }) as typeof process.emitWarning;
  try {
    // Through a variable: bundlers drop the node: prefix, and "sqlite" alone is no builtin.
    const name = "node:sqlite";
    return (await import(name)) as NodeSqlite;
  } catch {
    return null;
  } finally {
    process.emitWarning = emit;
  }
}

/** The sql.js wasm file: next to the bundled CLI, or in node_modules when run from source. */
function wasmPath(): string {
  const bundled = new URL("./sql-wasm.wasm", import.meta.url);
  if (bundled.protocol === "file:" && existsSync(bundled)) return bundled.pathname;
  return createRequire(import.meta.url).resolve("sql.js/dist/sql-wasm.wasm");
}

/**
 * Applies committed WAL frames to a database image, the way SQLite would on
 * open. sql.js reads one file and ignores the WAL, where a running harness
 * keeps its newest data. Frames are used up to the last valid commit; a frame
 * with a wrong salt or checksum ends the log, as in SQLite.
 */
export function applyWal(db: Buffer, wal: Buffer): Buffer {
  if (wal.length < 32) return db;
  const magic = wal.readUInt32BE(0);
  if (magic !== 0x377f0682 && magic !== 0x377f0683) return db;
  const bigEndian = magic === 0x377f0683;
  const pageSize = wal.readUInt32BE(8) || 65536;
  const salt1 = wal.readUInt32BE(16);
  const salt2 = wal.readUInt32BE(20);

  let s0 = 0;
  let s1 = 0;
  const checksum = (buf: Buffer, from: number, to: number) => {
    for (let i = from; i < to; i += 8) {
      const a = bigEndian ? buf.readUInt32BE(i) : buf.readUInt32LE(i);
      const b = bigEndian ? buf.readUInt32BE(i + 4) : buf.readUInt32LE(i + 4);
      s0 = (s0 + a + s1) >>> 0;
      s1 = (s1 + b + s0) >>> 0;
    }
  };
  checksum(wal, 0, 24);
  if (s0 !== wal.readUInt32BE(24) || s1 !== wal.readUInt32BE(28)) return db;

  const frameSize = 24 + pageSize;
  let lastCommitEnd = 0;
  let dbPages = 0;
  for (let off = 32; off + frameSize <= wal.length; off += frameSize) {
    if (wal.readUInt32BE(off + 8) !== salt1 || wal.readUInt32BE(off + 12) !== salt2) break;
    checksum(wal, off, off + 8);
    checksum(wal, off + 24, off + frameSize);
    if (s0 !== wal.readUInt32BE(off + 16) || s1 !== wal.readUInt32BE(off + 20)) break;
    const sizeAfterCommit = wal.readUInt32BE(off + 4);
    if (sizeAfterCommit > 0) {
      lastCommitEnd = off + frameSize;
      dbPages = sizeAfterCommit;
    }
  }
  if (lastCommitEnd === 0) return db;
  const out = Buffer.alloc(dbPages * pageSize);
  db.copy(out, 0, 0, Math.min(db.length, out.length));
  // Later frames of a page win, as they are written in order.
  for (let off = 32; off < lastCommitEnd; off += frameSize) {
    const page = wal.readUInt32BE(off);
    if (page <= dbPages) wal.copy(out, (page - 1) * pageSize, off + 24, off + frameSize);
  }
  return out;
}

/**
 * Opens a copy of a SQLite database read-only. Uses node:sqlite when this
 * Node has it (22.13+ and 23.4+), otherwise sql.js. The copy is deleted on close.
 */
export async function openSnapshot(file: string): Promise<SqliteSnapshot> {
  const { dir, copy } = await copyDatabase(file);
  const cleanup = () => rm(dir, { recursive: true, force: true });
  try {
    // CODEWRAPPED_SQLITE=sql.js forces the fallback, for tests and bug reports.
    const native = process.env.CODEWRAPPED_SQLITE === "sql.js" ? null : await loadNodeSqlite();
    if (native) {
      const db = new native.DatabaseSync(copy, { readOnly: true });
      return {
        engine: "node:sqlite",
        all: (sql) => db.prepare(sql).all(),
        close: async () => {
          db.close();
          await cleanup();
        },
      };
    }
    const { default: initSqlJs } = await import("sql.js");
    const SQL = await initSqlJs({ locateFile: () => wasmPath() });
    const wal = existsSync(`${copy}-wal`) ? await readFile(`${copy}-wal`) : null;
    const image = await readFile(copy);
    const db = new SQL.Database(wal ? applyWal(image, wal) : image);
    return {
      engine: "sql.js",
      all: (sql) => {
        const [res] = db.exec(sql);
        if (!res) return [];
        return res.values.map((v) => Object.fromEntries(res.columns.map((c, i) => [c, v[i]])));
      },
      close: async () => {
        db.close();
        await cleanup();
      },
    };
  } catch (e) {
    await cleanup();
    throw e;
  }
}
