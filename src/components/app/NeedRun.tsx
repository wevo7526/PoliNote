export function NeedRun({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col justify-center px-8">
      <h2 className="font-[family-name:var(--font-display)] text-3xl tracking-tight">
        Open a run first
      </h2>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-[var(--muted)]">
        {label} is bound to a run. Create one in the sidebar, then come back to
        this space.
      </p>
    </div>
  );
}
