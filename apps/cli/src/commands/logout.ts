import { api } from "../api";
import { loadAuth, removeAuth } from "../config";

export async function logout(out: (s?: string) => void): Promise<number> {
  const auth = await loadAuth();
  if (!auth) {
    out("This computer is not connected.");
    return 0;
  }
  try {
    await api(auth.apiUrl, "DELETE", "/cli/token", { token: auth.token });
  } catch {
    // Offline or already revoked: the local token is removed either way.
  }
  await removeAuth();
  out("Disconnected this computer. Your synced data stays online until you delete it in settings.");
  return 0;
}
