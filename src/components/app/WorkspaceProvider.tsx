"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { RunSnapshot, RunSummary } from "@/lib/platform-types";
import type { ScopeContract } from "@/schemas/scope-contract";

type WorkspaceContextValue = {
  runs: RunSummary[];
  activeId: string | null;
  snapshot: RunSnapshot | null;
  creating: boolean;
  loadingRun: boolean;
  busy: boolean;
  selectRun: (id: string) => Promise<void>;
  newRun: () => Promise<void>;
  send: (text: string) => Promise<void>;
  saveScope: (scope: ScopeContract) => Promise<boolean>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
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

  const applySnapshot = useCallback((next: RunSnapshot) => {
    setSnapshot(next);
    setActiveId(next.run.id);
    setRuns((prev) => {
      const rest = prev.filter((run) => run.id !== next.run.id);
      return [next.run, ...rest];
    });
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
    try {
      const response = await fetch("/api/runs", { method: "POST" });
      if (!response.ok) return;
      const data = await readJson<{ run: RunSummary }>(response);
      const empty: RunSnapshot = {
        run: data.run,
        items: [],
        nodes: [],
        edges: [],
        scope: null,
        analyses: {},
      };
      applySnapshot(empty);
      router.replace(`/app/run?run=${data.run.id}`);
    } finally {
      setCreating(false);
    }
  }, [applySnapshot, router]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !activeId || busy) return;
      setBusy(true);
      try {
        const response = await fetch(`/api/runs/${activeId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: trimmed }),
        });
        const data = await readJson<RunSnapshot>(response);
        if (data.run) applySnapshot(data);
      } finally {
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

  const value = useMemo(
    () => ({
      runs,
      activeId,
      snapshot,
      creating,
      loadingRun,
      busy,
      selectRun,
      newRun,
      send,
      saveScope,
    }),
    [
      runs,
      activeId,
      snapshot,
      creating,
      loadingRun,
      busy,
      selectRun,
      newRun,
      send,
      saveScope,
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
