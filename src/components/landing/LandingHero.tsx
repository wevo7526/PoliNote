import Link from "next/link";

export function LandingHero() {
  return (
    <main className="landing relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6">
      <div className="landing-grain pointer-events-none absolute inset-0" />

      <div className="relative flex w-full max-w-xl flex-col items-center text-center">
        <div className="hero-rings" aria-hidden>
          <span className="hero-rings-tumble">
            <span className="hero-ring-tilt hero-ring-a">
              <span className="hero-ring" />
            </span>
            <span className="hero-ring-tilt hero-ring-b">
              <span className="hero-ring" />
            </span>
            <span className="hero-ring-tilt hero-ring-c">
              <span className="hero-ring" />
            </span>
          </span>
        </div>

        <h1 className="mt-8 font-[family-name:var(--font-display)] text-[clamp(3.4rem,12vw,6.4rem)] leading-none tracking-[-0.04em] text-[var(--ink)]">
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
