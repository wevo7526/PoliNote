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
        <p className="mt-4 max-w-md text-sm leading-relaxed text-[var(--muted)] md:text-base">
          Ask a policy question. Projects, live empirical series, and a 9-role crew build the pre-registered econometric estimate, argument map, and report in front of you.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/app/run"
            className="enter-btn inline-flex h-12 items-center justify-center px-9 text-[13px] font-semibold uppercase tracking-[0.22em] text-[var(--bg)]"
          >
            Enter Workbench
          </Link>
          <Link
            href="/app/sandbox"
            className="inline-flex h-12 items-center justify-center border border-[var(--copper)]/60 bg-[var(--paper)] px-7 text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--copper)] transition hover:bg-[var(--copper)]/15"
          >
            Persona Sandbox
          </Link>
        </div>
      </div>
    </main>
  );
}
