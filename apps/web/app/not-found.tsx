import Link from "next/link";
import { Header } from "@/components/Chrome";
import { CopyCommand } from "@/components/CopyCommand";

export default function NotFound() {
  return (
    <>
      <Header />
      <main className="mx-auto flex w-full max-w-5xl flex-col items-start gap-5 px-4 pt-20 sm:px-6">
        <h1 className="text-[32px] font-semibold tracking-[-0.02em]">Nothing here.</h1>
        <p className="text-[16px] text-muted">The page or profile does not exist. Check the handle, or make your own card.</p>
        <CopyCommand />
        <Link href="/" className="rounded-[8px] text-[14px] underline underline-offset-4">
          Go to the home page
        </Link>
      </main>
    </>
  );
}
