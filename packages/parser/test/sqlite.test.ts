import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openInPlace, openSnapshot } from "../src/index";

// os.tmpdir() reads TMPDIR on every call, so the copies of this file's tests land here.
const temp = mkdtempSync(join(tmpdir(), "cw-sqlite-"));
const copies = () => readdirSync(temp).filter((n) => n.startsWith("codewrapped-db-"));

function database(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "cw-sqlite-src-"));
  const file = join(dir, name);
  const db = new DatabaseSync(file);
  db.exec("create table t (x integer); insert into t values (1);");
  db.close();
  return file;
}

const original = process.env.TMPDIR;
beforeAll(() => {
  process.env.TMPDIR = temp;
});
afterEach(() => {
  delete process.env.CODEWRAPPED_SQLITE;
});
afterAll(() => {
  if (original === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = original;
});

describe("database copies", () => {
  it("removes copies an earlier run left behind, and only those", async () => {
    const twoHoursAgo = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
    for (const name of ["codewrapped-db-Stale1", "codewrapped-db-Fresh1", "codewrapped-db-not-ours", "other-db-Stale2"]) {
      mkdirSync(join(temp, name));
      writeFileSync(join(temp, name, "opencode.db"), "x");
      if (name.includes("Stale") || name.includes("not-ours")) utimesSync(join(temp, name), twoHoursAgo, twoHoursAgo);
    }
    const db = await openSnapshot(database("opencode.db"));
    await db.close();
    expect(readdirSync(temp).filter((n) => !n.startsWith("cw-sqlite")).sort()).toEqual(["codewrapped-db-Fresh1", "codewrapped-db-not-ours", "other-db-Stale2"]);
  });

  it("refuses a database too big for sql.js before copying it", async () => {
    process.env.CODEWRAPPED_SQLITE = "sql.js";
    const file = database("opencode.db");
    truncateSync(file, 600 * 1024 * 1024);
    const before = copies();
    await expect(openSnapshot(file)).rejects.toThrow("a 0.6 GB database needs Node 22.13 or newer");
    await expect(openInPlace(file)).rejects.toThrow("a 0.6 GB database needs Node 22.13 or newer");
    expect(copies()).toEqual(before);
  });

  it.skipIf(process.platform === "win32")("deletes the copy when the run is stopped with Ctrl-C", async () => {
    const before = copies();
    const script = join(mkdtempSync(join(tmpdir(), "cw-sqlite-run-")), "hold.mts");
    writeFileSync(
      script,
      `import { openSnapshot } from ${JSON.stringify(join(import.meta.dirname, "../src/sqlite.ts"))};
await openSnapshot(${JSON.stringify(database("opencode.db"))});
console.log("open");
setInterval(() => {}, 1000);`,
    );
    const child = spawn(process.execPath, ["--import", "tsx", script], {
      cwd: join(import.meta.dirname, ".."),
      env: { ...process.env, TMPDIR: temp },
      stdio: ["ignore", "pipe", "inherit"],
    });
    await new Promise<void>((resolve) => child.stdout.on("data", (d) => String(d).includes("open") && resolve()));
    expect(copies().length).toBe(before.length + 1);
    const exit = new Promise<NodeJS.Signals | null>((resolve) => child.on("exit", (_code, signal) => resolve(signal)));
    child.kill("SIGINT");
    expect(await exit).toBe("SIGINT");
    expect(copies()).toEqual(before);
  });
});
