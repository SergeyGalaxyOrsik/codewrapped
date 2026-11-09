import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { api, API_TIMEOUT_MS, ApiError } from "../api";
import { openUrl } from "../card";
import { apiUrl, loadAuth, loadConfig, saveAuth, webUrlFor } from "../config";
import { bold, dim, safeText } from "../ui";

type Start = { deviceCode: string; userCode: string; verifyUrl: string; interval: number; expiresIn: number };

export async function login(out: (s?: string) => void): Promise<number> {
  const base = apiUrl();
  const existing = await loadAuth();
  if (existing?.apiUrl === base) {
    out(`This computer is connected as @${safeText(String(existing.handle))}. Logging in again replaces that connection.`);
  }
  const config = await loadConfig();
  const machineLabel = hostname().slice(0, 100) || "computer";
  const start = await api<Start>(base, "POST", "/cli/device", { body: { machineLabel, machineId: config.machineId } });

  out(`Open this page and check that it shows ${bold(safeText(String(start.userCode)))}:`);
  out(`  ${safeText(String(start.verifyUrl))}`);
  if (process.stdout.isTTY) openUrl(String(start.verifyUrl), [base, webUrlFor(base)]);
  out(dim(`This computer shows up as "${safeText(machineLabel)}" in your settings. Only you see that name.`));
  out(dim("Waiting for you to approve in the browser..."));

  let interval = Math.max(1, Number(start.interval) || 1);
  const deadline = Date.now() + Number(start.expiresIn) * 1000;
  const left = () => deadline - Date.now();
  while (left() > 0) {
    await sleep(Math.min(interval * 1000, left()));
    if (left() <= 0) break;
    try {
      const done = await api<{ token: string; handle: string | null }>(base, "POST", "/cli/token", {
        body: { deviceCode: start.deviceCode },
        timeoutMs: Math.min(API_TIMEOUT_MS, left()),
      });
      await saveAuth({ token: done.token, handle: done.handle, apiUrl: base, createdAt: new Date().toISOString() });
      out(`Connected as @${safeText(String(done.handle))}.`);
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
