import type { Metadata } from "next";
import { Footer, Header } from "@/components/Chrome";
import { Settings } from "./Settings";

export const metadata: Metadata = { title: "Settings", robots: { index: false } };

export default function SettingsPage() {
  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-2xl px-4 sm:px-6">
        <Settings />
      </main>
      <Footer />
    </>
  );
}
