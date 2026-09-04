import Link from "next/link";
import { PoliMark } from "@/components/mark/PoliMark";

export function LandingHero() {
  return (
    <main className="landing relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6">
      <div className="landing-grain pointer-events-none absolute inset-0" />
      <div className="landing-orb pointer-events-none absolute left-1/2 top-[42%] h-[640px] w-[640px] -translate-x-1/2 -translate-y-1/2" />

      <div className="relative flex w-full max-w-xl flex-col items-center text-center">
        <PoliMark animated className="h-48 w-48 md:h-56 md:w-56" />

        <h1 className="mt-2 font-[family-name:var(--font-display)] text-[clamp(3.4rem,12vw,6.4rem)] leading-none tracking-[-0.04em] text-[var(--ink)]">
          PoliNote
        </h1>
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-[var(--muted)] md:text-base">
          Ask a policy question. The crew builds the argument in front of you.
        </p>

        <Link
          href="/app/run"
          className="enter-btn mt-10 inline-flex h-12 items-center justify-center px-10 text-[13px] font-semibold uppercase tracking-[0.22em] text-[var(--bg)]"
        >
          Enter
        </Link>
      </div>
    </main>
  );
}
