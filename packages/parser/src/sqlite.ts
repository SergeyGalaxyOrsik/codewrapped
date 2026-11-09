import { existsSync, rmSync } from "node:fs";
import { copyFile, lstat, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export type Row = Record<string, unknown>;
export type SqlValue = string | number | null;

/** A read-only view of a database: a copy, or the file itself for openInPlace. */
export type SqliteSnapshot = {
  /** Runs one SELECT with ? parameters and returns its rows. */
  all(sql: string, ...params: SqlValue[]): Row[];
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

const COPY_PREFIX = "codewrapped-db-";
const COPY_DIR = /^codewrapped-db-[A-Za-z0-9]{6}$/;
const STALE_COPY_MS = 60 * 60 * 1000;

/** Temp folders with database copies that are still in use. Removed on exit, Ctrl-C and SIGTERM. */
const liveCopies = new Set<string>();
let started: Promise<void> | null = null;

function removeLiveCopies(): void {
  for (const dir of liveCopies) rmSync(dir, { recursive: true, force: true });
  liveCopies.clear();
}

/**
 * Removes copies left by runs that were killed before they could clean up:
 * folders named like ours, owned by this user and untouched for an hour.
 */
async function sweepStaleCopies(): Promise<void> {
  const root = tmpdir();
  const uid = process.getuid?.();
  for (const name of await readdir(root).catch(() => [])) {
    if (!COPY_DIR.test(name)) continue;
    const dir = join(root, name);
    const s = await lstat(dir).catch(() => null);
    if (!s?.isDirectory() || (uid !== undefined && s.uid !== uid) || Date.now() - s.mtimeMs < STALE_COPY_MS) continue;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function startCopies(): Promise<void> {
  started ??= (async () => {
    process.on("exit", removeLiveCopies);
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const onSignal = () => {
        removeLiveCopies();
        process.removeListener(signal, onSignal);
        // With our listener gone, the signal ends the process the way it would have without us.
        process.kill(process.pid, signal);
      };
      process.on(signal, onSignal);
    }
    await sweepStaleCopies();
  })();
  return started;
}

/**
 * Copies a database and its -wal and -shm files into a new temp folder, so a
 * harness that is running never sees us. The copy is retried when the files
 * changed while being copied, which would mix two states of the database.
 */
async function copyDatabase(file: string): Promise<{ dir: string; copy: string }> {
  await startCopies();
  const dir = await mkdtemp(join(tmpdir(), COPY_PREFIX));
  liveCopies.add(dir);
  const copy = join(dir, basename(file));
  const parts = [file, ...SIDE_FILES.map((s) => file + s)];
  try {
    for (let attempt = 0; ; attempt++) {
      const before = await Promise.all(parts.map(fileStamp));
      for (const p of parts) if (existsSync(p)) await copyFile(p, join(dir, basename(p)));
      const after = await Promise.all(parts.map(fileStamp));
      if (before.join() === after.join() || attempt >= 4) return { dir, copy };
    }
  } catch (e) {
    await removeCopy(dir);
    throw e;
  }
}

async function removeCopy(dir: string): Promise<void> {
  liveCopies.delete(dir);
  await rm(dir, { recursive: true, force: true });
}

type NodeSqlite = { DatabaseSync: new (path: string, opts?: { readOnly?: boolean }) => NodeDb };
type NodeDb = { prepare(sql: string): { all(...params: SqlValue[]): Row[] }; close(): void };

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

/** Above this, sql.js is not used: it holds the whole database in memory. */
const SQLJS_MAX_BYTES = 512 * 1024 * 1024;

/** CODEWRAPPED_SQLITE=sql.js forces the fallback, for tests and bug reports. */
const loadEngine = () => (process.env.CODEWRAPPED_SQLITE === "sql.js" ? Promise.resolve(null) : loadNodeSqlite());

async function refuseTooBigForSqlJs(file: string): Promise<void> {
  const sizes = await Promise.all([file, `${file}-wal`].map((p) => stat(p).then((s) => s.size, () => 0)));
  const size = sizes[0]! + sizes[1]!;
  if (size > SQLJS_MAX_BYTES) throw new Error(`a ${(size / 1e9).toFixed(1)} GB database needs Node 22.13 or newer`);
}

/**
 * Opens a copy of a SQLite database read-only. Uses node:sqlite when this
 * Node has it (22.13+ and 23.4+), otherwise sql.js, which refuses databases
 * over 512 MB. The copy is deleted on close.
 */
export async function openSnapshot(file: string): Promise<SqliteSnapshot> {
  const native = await loadEngine();
  if (!native) await refuseTooBigForSqlJs(file);
  const { dir, copy } = await copyDatabase(file);
  const cleanup = () => removeCopy(dir);
  try {
    if (native) {
      const db = new native.DatabaseSync(copy, { readOnly: true });
      return {
        engine: "node:sqlite",
        all: (sql, ...params) => db.prepare(sql).all(...params),
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
      all: (sql, ...params) => {
        const [res] = db.exec(sql, params);
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

/**
 * Opens a database read-only where it is, without a copy, for files too big
 * to copy: Cursor's state.vscdb runs to gigabytes. In WAL mode a reader
 * never blocks the program that writes the file. Needs node:sqlite; without
 * it a small file is copied and read with sql.js, a big one is refused.
 */
export async function openInPlace(file: string): Promise<SqliteSnapshot> {
  const native = await loadEngine();
  if (!native) return openSnapshot(file);
  const db = new native.DatabaseSync(file, { readOnly: true });
  return {
    engine: "node:sqlite",
    all: (sql, ...params) => db.prepare(sql).all(...params),
    close: async () => db.close(),
  };
}
