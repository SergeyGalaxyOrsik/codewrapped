"use client";

import { useState } from "react";
import { signIn } from "@/lib/api";
import { buttonPrimary, buttonSecondary } from "./Chrome";

/** Starts GitHub sign-in and returns to `returnTo`, or to the current page. */
export function SignInButton({ returnTo, label = "Sign in with GitHub", quiet = false }: { returnTo?: string; label?: string; quiet?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-2">
      <button
        type="button"
        disabled={busy}
        className={quiet ? buttonSecondary : buttonPrimary}
        onClick={async () => {
          setBusy(true);
          const err = await signIn(returnTo ?? window.location.href);
          if (err) {
            setError(err.message);
            setBusy(false);
          }
        }}
      >
        {busy ? "Opening GitHub..." : label}
      </button>
      {error && <span className="text-[13px] text-muted">{error}</span>}
    </span>
  );
}
