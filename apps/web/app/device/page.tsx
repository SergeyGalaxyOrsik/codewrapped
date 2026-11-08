import type { Metadata } from "next";
import { Suspense } from "react";
import { Header } from "@/components/Chrome";
import { Device } from "./Device";

export const metadata: Metadata = { title: "Connect a computer", robots: { index: false } };

export default function DevicePage() {
  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-md px-4 pt-16 sm:px-6">
        <Suspense fallback={<p className="text-[14px] text-muted">Loading...</p>}>
          <Device />
        </Suspense>
      </main>
    </>
  );
}
