import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { api, ApiError } from "../api";
import { openFile } from "../card";
import { apiUrl, loadAuth, loadConfig, saveAuth } from "../config";
import { bold, dim } from "../ui";

type Start = { deviceCode: string; userCode: string; verifyUrl: string; interval: number; expiresIn: number };

export async function login(out: (s?: string) => void): Promise<number> {
  const base = apiUrl();
  const existing = await loadAuth();
  if (existing?.apiUrl === base) {
    out(`This computer is connected as @${existing.handle}. Logging in again replaces that connection.`);
  }
  const config = await loadConfig();
  const machineLabel = hostname().slice(0, 100) || "computer";
  const start = await api<Start>(base, "POST", "/cli/device", { body: { machineLabel, machineId: config.machineId } });

  out(`Open this page and check that it shows ${bold(start.userCode)}:`);
  out(`  ${start.verifyUrl}`);
  if (process.stdout.isTTY) openFile(start.verifyUrl);
  out(dim(`This computer shows up as "${machineLabel}" in your settings. Only you see that name.`));
  out(dim("Waiting for you to approve in the browser..."));

  let interval = start.interval;
  const deadline = Date.now() + start.expiresIn * 1000;
  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    try {
      const done = await api<{ token: string; handle: string | null }>(base, "POST", "/cli/token", {
        body: { deviceCode: start.deviceCode },
      });
      await saveAuth({ token: done.token, handle: done.handle, apiUrl: base, createdAt: new Date().toISOString() });
      out(`Connected as @${done.handle}.`);
      out('Run "npx codewrapped sync" to upload your daily totals.');
      return 0;
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      if (e.code === "authorization_pending") continue;
      if (e.code === "slow_down") {
        interval += 5;
        continue;
      }
      if (e.code === "network") continue;
      out(e.message);
      return 1;
    }
  }
  out('The code expired. Run "npx codewrapped login" again.');
  return 1;
}
