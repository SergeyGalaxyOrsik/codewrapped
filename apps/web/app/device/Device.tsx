"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { buttonPrimary, buttonSecondary } from "@/components/Chrome";
import { SignInButton } from "@/components/SignInButton";
import { apiCall } from "@/lib/api";

type Pending = { userCode: string; machineLabel: string; createdAt: string };
type State =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "invalid"; message: string }
  | { kind: "pending"; device: Pending }
  | { kind: "approved" }
  | { kind: "denied" };

export function Device() {
  const code = (useSearchParams().get("code") ?? "").trim().toUpperCase();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!/^[A-Z]{4}-\d{4}$/.test(code)) {
      setState({ kind: "invalid", message: 'This link has no valid code. Run "npx codewrapped login" again.' });
      return;
    }
    void apiCall<Pending>("GET", `/cli/device/${code}`).then((res) => {
      if (res.ok) setState({ kind: "pending", device: res.data });
      else if (res.status === 401) setState({ kind: "signed-out" });
      else setState({ kind: "invalid", message: res.error.message });
    });
  }, [code]);

  const act = async (action: "approve" | "deny") => {
    setBusy(true);
    const res = await apiCall("POST", `/cli/device/${code}/${action}`, {});
    setBusy(false);
    if (res.ok) setState({ kind: action === "approve" ? "approved" : "denied" });
    else setState({ kind: "invalid", message: res.error.message });
  };

  const codeBox = (
    <div className="rounded-[12px] border border-border bg-surface py-6 text-center font-mono text-[32px] tracking-[0.08em]">{code || "----"}</div>
  );

  switch (state.kind) {
    case "loading":
      return <p className="text-[14px] text-muted">Loading...</p>;
    case "signed-out":
      return (
        <div className="flex flex-col gap-5">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Connect a computer</h1>
          {codeBox}
          <p className="text-[15px] text-muted">Sign in with GitHub to connect the computer that shows this code.</p>
          <SignInButton />
        </div>
      );
    case "invalid":
      return (
        <div className="flex flex-col gap-4">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">This code does not work</h1>
          <p className="text-[15px] text-muted">{state.message}</p>
        </div>
      );
    case "pending":
      return (
        <div className="flex flex-col gap-5">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Connect this computer?</h1>
          {codeBox}
          <p className="text-[15px] text-muted">
            <span className="text-fg">{state.device.machineLabel}</span> asked to connect. Check that your terminal shows the same code.
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} className={buttonPrimary} onClick={() => void act("approve")}>
              Connect this computer
            </button>
            <button type="button" disabled={busy} className={buttonSecondary} onClick={() => void act("deny")}>
              Cancel
            </button>
          </div>
          <p className="text-[13px] text-muted">The computer can then upload daily totals to your account. You can disconnect it in settings.</p>
        </div>
      );
    case "approved":
      return (
        <div className="flex flex-col gap-3">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Connected</h1>
          <p className="text-[15px] text-muted">
            Go back to your terminal. Then run <code className="font-mono text-fg">npx codewrapped sync</code>.
          </p>
        </div>
      );
    case "denied":
      return (
        <div className="flex flex-col gap-3">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Cancelled</h1>
          <p className="text-[15px] text-muted">Nothing was connected. You can close this page.</p>
        </div>
      );
  }
}
