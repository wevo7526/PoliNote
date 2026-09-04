"use client";

import { useId } from "react";

type ComposerProps = {
  value: string;
  busy: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
};

export function Composer({
  value,
  busy,
  disabled,
  onChange,
  onSubmit,
}: ComposerProps) {
  const id = useId();

  return (
    <form
      className="composer border-t border-[var(--line)] px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor={id} className="sr-only">
        Message this run
      </label>
      <div className="composer-shell">
        <textarea
          id={id}
          rows={2}
          value={value}
          disabled={busy || disabled}
          placeholder={
            disabled
              ? "Open a run from the sidebar to start"
              : busy
                ? "Crew is building the digression…"
                : "Steer this run — the graph is written from this chat"
          }
          className="composer-input"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        <button
          type="submit"
          disabled={busy || disabled || value.trim().length === 0}
          className="composer-send"
        >
          Send
        </button>
      </div>
    </form>
  );
}
