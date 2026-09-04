"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  applyCrewEvent,
  publicCrewError,
  type CrewStreamEvent,
} from "@/lib/ai/crew-events";
import type { RunSnapshot, RunSummary } from "@/lib/platform-types";
import type { ScopeContract } from "@/schemas/scope-contract";

type WorkspaceContextValue = {
  runs: RunSummary[];
  activeId: string | null;
  snapshot: RunSnapshot | null;
  creating: boolean;
  createError: string | null;
  loadingRun: boolean;
  busy: boolean;
  selectRun: (id: string) => Promise<void>;
  newRun: () => Promise<void>;
  send: (text: string) => Promise<void>;
  saveScope: (scope: ScopeContract) => Promise<boolean>;
  deleteRun: (id: string) => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function applyAndSyncRuns(
  next: RunSnapshot,
  setSnapshot: (value: RunSnapshot) => void,
  setActiveId: (value: string) => void,
  setRuns: Dispatch<SetStateAction<RunSummary[]>>,
) {
  setSnapshot(next);
  setActiveId(next.run.id);
  setRuns((prev) => {
    const rest = prev.filter((run) => run.id !== next.run.id);
    return [next.run, ...rest];
  });
}

async function consumeCrewStream(
  response: Response,
  onEvent: (event: CrewStreamEvent) => void,
): Promise<void> {
  if (!response.body) {
    throw new Error("Crew stream was empty");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk
        .split("\n")
        .find((entry) => entry.startsWith("data:"));
      if (!line) continue;
      const payload = line.replace(/^data:\s?/, "").trim();
      if (!payload) continue;
      onEvent(JSON.parse(payload) as CrewStreamEvent);
    }
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const runFromUrl = searchParams.get("run");

  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(runFromUrl);
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [creating, setCreating] = useState(false);
  const [loadingRun, setLoadingRun] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const snapshotRef = useRef<RunSnapshot | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const applySnapshot = useCallback((next: RunSnapshot) => {
    const normalized = { ...next, events: next.events ?? [] };
    snapshotRef.current = normalized;
    applyAndSyncRuns(normalized, setSnapshot, setActiveId, setRuns);
  }, []);

  const setRunInUrl = useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("run", id);
      router.replace(`${pathname}?${next.toString()}`);
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/runs");
      if (!response.ok || cancelled) return;
      const data = await readJson<{ runs: RunSummary[] }>(response);
      if (!cancelled) setRuns(data.runs);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!runFromUrl) return;
    if (snapshot?.run.id === runFromUrl) return;
    let cancelled = false;
    setLoadingRun(true);
    void (async () => {
      const response = await fetch(`/api/runs/${runFromUrl}`);
      if (!cancelled && response.ok) {
        const data = await readJson<RunSnapshot>(response);
        applySnapshot(data);
      }
      if (!cancelled) setLoadingRun(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [applySnapshot, runFromUrl, snapshot?.run.id]);

  const selectRun = useCallback(
    async (id: string) => {
      setRunInUrl(id);
      if (snapshot?.run.id === id) return;
      setLoadingRun(true);
      try {
        const response = await fetch(`/api/runs/${id}`);
        if (!response.ok) return;
        applySnapshot(await readJson<RunSnapshot>(response));
      } finally {
        setLoadingRun(false);
      }
    },
    [applySnapshot, setRunInUrl, snapshot?.run.id],
  );

  const newRun = useCallback(async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const response = await fetch("/api/runs", { method: "POST" });
      if (!response.ok) {
        const failed = await response.json().catch(() => null);
        const message =
          failed && typeof failed === "object" && "error" in failed
            ? String(failed.error)
            : `Could not open a run (${response.status})`;
        setCreateError(message);
        return;
      }
      const data = await readJson<{ run: RunSummary }>(response);
      const loaded = await fetch(`/api/runs/${data.run.id}`);
      if (loaded.ok) {
        applySnapshot(await readJson<RunSnapshot>(loaded));
      } else {
        applySnapshot({
          run: data.run,
          items: [],
          nodes: [],
          edges: [],
          scope: null,
          analyses: {},
          events: [],
          draft: null,
        });
      }
      router.replace(`/app/run?run=${data.run.id}`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Could not open a run.");
    } finally {
      setCreating(false);
    }
  }, [applySnapshot, router]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      const current = snapshotRef.current;
      if (!trimmed || !activeId || busy || !current) return;

      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;
      setBusy(true);

      const optimistic = applyCrewEvent(current, {
        type: "user",
        item: { id: `local-${Date.now()}`, kind: "user", text: trimmed },
      });
      applySnapshot({
        ...optimistic,
        run: { ...optimistic.run, status: "running" },
      });

      try {
        const response = await fetch(`/api/runs/${activeId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: trimmed }),
          signal: abort.signal,
        });

        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("text/event-stream")) {
          if (response.ok) {
            const data = await readJson<RunSnapshot>(response);
            if (data.run) applySnapshot(data);
            return;
          }
          const failed = await response.json().catch(() => null);
          const message =
            failed && typeof failed === "object" && "error" in failed
              ? String(failed.error)
              : `Crew request failed (${response.status})`;
          applySnapshot(
            applyCrewEvent(snapshotRef.current ?? optimistic, {
              type: "error",
              message,
            }),
          );
          return;
        }

        let draft = snapshotRef.current ?? optimistic;
        await consumeCrewStream(response, (event) => {
          draft = applyCrewEvent(draft, event);
          applySnapshot(draft);
        });
      } catch (error) {
        if (abort.signal.aborted) return;
        applySnapshot(
          applyCrewEvent(snapshotRef.current ?? optimistic, {
            type: "error",
            message: publicCrewError(error),
          }),
        );
      } finally {
        if (abortRef.current === abort) abortRef.current = null;
        setBusy(false);
      }
    },
    [activeId, applySnapshot, busy],
  );

  const saveScope = useCallback(
    async (scope: ScopeContract) => {
      if (!activeId) return false;
      const response = await fetch(`/api/runs/${activeId}/scope`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scope),
      });
      if (!response.ok) return false;
      applySnapshot(await readJson<RunSnapshot>(response));
      return true;
    },
    [activeId, applySnapshot],
  );

  const deleteRun = useCallback(
    async (id: string) => {
      if (snapshotRef.current?.run.id === id) {
        abortRef.current?.abort();
      }
      const response = await fetch(`/api/runs/${id}`, { method: "DELETE" });
      if (!response.ok) return;
      let remaining: RunSummary[] = [];
      setRuns((prev) => {
        remaining = prev.filter((run) => run.id !== id);
        return remaining;
      });
      if (activeId !== id && snapshotRef.current?.run.id !== id) return;
      snapshotRef.current = null;
      setSnapshot(null);
      setActiveId(null);
      if (remaining[0]) {
        await selectRun(remaining[0].id);
        return;
      }
      router.replace(pathname);
    },
    [activeId, pathname, router, selectRun],
  );

  const value = useMemo(
    () => ({
      runs,
      activeId,
      snapshot,
      creating,
      createError,
      loadingRun,
      busy,
      selectRun,
      newRun,
      send,
      saveScope,
      deleteRun,
    }),
    [
      runs,
      activeId,
      snapshot,
      creating,
      createError,
      loadingRun,
      busy,
      selectRun,
      newRun,
      send,
      saveScope,
      deleteRun,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used inside WorkspaceProvider");
  }
  return ctx;
}
