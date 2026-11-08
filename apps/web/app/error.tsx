"use client";

import { Header } from "@/components/Chrome";

/** Shown when a page cannot load, for example when the API is down. */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <>
      <Header />
      <main className="mx-auto flex w-full max-w-5xl flex-col items-start gap-5 px-4 pt-20 sm:px-6">
        <h1 className="text-[32px] font-semibold tracking-[-0.02em]">This page did not load.</h1>
        <p className="text-[16px] text-muted">The server did not answer. Try again in a minute.</p>
        <button type="button" onClick={reset} className="rounded-[8px] bg-fg px-4 py-2 text-[14px] font-medium text-bg">
          Try again
        </button>
      </main>
    </>
  );
}
