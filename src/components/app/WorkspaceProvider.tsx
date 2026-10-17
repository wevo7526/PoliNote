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
import type { ProjectSummary, RunSnapshot, RunSummary } from "@/lib/platform-types";
import type { ScopeContract } from "@/schemas/scope-contract";
import type { UserNodeStatus } from "@/schemas/digression";

type WorkspaceContextValue = {
  projects: ProjectSummary[];
  activeProjectId: string | null;
  activeProject: ProjectSummary | null;
  runs: RunSummary[];
  activeId: string | null;
  snapshot: RunSnapshot | null;
  creating: boolean;
  createError: string | null;
  loadingRun: boolean;
  busy: boolean;
  selectProject: (projectId: string, navigate?: boolean) => void;
  createProject: (input?: {
    title?: string;
    description?: string;
    contextMemo?: string;
  }) => Promise<ProjectSummary | null>;
  updateProject: (
    projectId: string,
    input: { title?: string; description?: string; contextMemo?: string },
  ) => Promise<ProjectSummary | null>;
  deleteProject: (projectId: string) => Promise<void>;
  selectRun: (id: string, targetPath?: string) => Promise<void>;
  newRun: (projectId?: string, initialTitle?: string) => Promise<RunSummary | null>;
  send: (text: string) => Promise<void>;
  saveScope: (scope: ScopeContract) => Promise<boolean>;
  setNodeStatus: (nodeId: string, status: UserNodeStatus) => Promise<boolean>;
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
    const existing = prev.find((run) => run.id === next.run.id);
    const merged: RunSummary = {
      ...next.run,
      projectId: next.run.projectId ?? existing?.projectId,
    };
    const rest = prev.filter((run) => run.id !== next.run.id);
    return [merged, ...rest];
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
  const projectFromUrl = searchParams.get("project");

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(projectFromUrl);
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
    const normalized: RunSnapshot = { ...next, events: next.events ?? [] };
    snapshotRef.current = normalized;
    applyAndSyncRuns(normalized, setSnapshot, setActiveId, setRuns);
    if (normalized.run.projectId) {
      setActiveProjectId(normalized.run.projectId);
    }
  }, []);

  const setRunInUrl = useCallback(
    (id: string, targetPath?: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("run", id);
      const dest = targetPath ?? pathname;
      router.replace(`${dest}?${next.toString()}`);
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/runs");
      if (!response.ok || cancelled) return;
      const data = await readJson<{ projects?: ProjectSummary[]; runs: RunSummary[] }>(response);
      if (cancelled) return;
      const loadedProjects = data.projects ?? [];
      setProjects(loadedProjects);
      setRuns(data.runs);
      setActiveProjectId((prev) => prev ?? loadedProjects[0]?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (projectFromUrl && projectFromUrl !== activeProjectId) {
      setActiveProjectId(projectFromUrl);
    }
  }, [projectFromUrl, activeProjectId]);

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

  const selectProject = useCallback(
    (projectId: string, navigate = false) => {
      setActiveProjectId(projectId);
      if (navigate) {
        router.push(`/app/project?project=${projectId}`);
      }
    },
    [router],
  );

  const createProject = useCallback(
    async (input?: { title?: string; description?: string; contextMemo?: string }) => {
      setCreateError(null);
      try {
        const response = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input ?? {}),
        });
        if (!response.ok) return null;
        const data = await readJson<{ project: ProjectSummary }>(response);
        setProjects((prev) => [
          data.project,
          ...prev.filter((item) => item.id !== data.project.id),
        ]);
        setActiveProjectId(data.project.id);
        return data.project;
      } catch {
        return null;
      }
    },
    [],
  );

  const updateProject = useCallback(
    async (
      projectId: string,
      input: { title?: string; description?: string; contextMemo?: string },
    ) => {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) return null;
      const data = await readJson<{ project: ProjectSummary }>(response);
      setProjects((prev) =>
        prev.map((item) => (item.id === projectId ? data.project : item)),
      );
      return data.project;
    },
    [],
  );

  const deleteProject = useCallback(
    async (projectId: string) => {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      if (!response.ok) return;
      const refreshed = await fetch("/api/runs");
      if (refreshed.ok) {
        const data = await readJson<{ projects?: ProjectSummary[]; runs: RunSummary[] }>(
          refreshed,
        );
        const nextProjects = data.projects ?? [];
        setProjects(nextProjects);
        setRuns(data.runs);
        setActiveProjectId(nextProjects[0]?.id ?? null);
        if (snapshotRef.current?.run.projectId === projectId) {
          snapshotRef.current = null;
          setSnapshot(null);
          setActiveId(null);
        }
      }
    },
    [],
  );

  const selectRun = useCallback(
    async (id: string, targetPath?: string) => {
      setRunInUrl(id, targetPath);
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

  const newRun = useCallback(
    async (projectId?: string, initialTitle?: string): Promise<RunSummary | null> => {
      setCreating(true);
      setCreateError(null);
      const targetProjectId = projectId ?? activeProjectId ?? projects[0]?.id;
      try {
        const response = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: targetProjectId,
            title: initialTitle,
          }),
        });
        if (!response.ok) {
          const failed = await response.json().catch(() => null);
          const message =
            failed && typeof failed === "object" && "error" in failed
              ? String(failed.error)
              : `Could not open a run (${response.status})`;
          setCreateError(message);
          return null;
        }
        const data = await readJson<{ run: RunSummary }>(response);
        const freshSnapshot: RunSnapshot = {
          run: data.run,
          items: [],
          nodes: [],
          edges: [],
          scope: null,
          analyses: {},
          events: [],
          draft: null,
        };
        applySnapshot(freshSnapshot);
        router.replace(`/app/run?run=${data.run.id}`);
        return data.run;
      } catch (error) {
        setCreateError(error instanceof Error ? error.message : "Could not open a run.");
        return null;
      } finally {
        setCreating(false);
      }
    },
    [activeProjectId, applySnapshot, projects, router],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      let current = snapshotRef.current;
      let targetRunId = activeId;

      // Zero-friction auto-create run if none is open yet
      if (!targetRunId || !current) {
        const created = await newRun(activeProjectId ?? undefined, trimmed.slice(0, 64));
        if (!created) return;
        targetRunId = created.id;
        current = snapshotRef.current ?? {
          run: created,
          items: [],
          nodes: [],
          edges: [],
          scope: null,
          analyses: {},
          events: [],
          draft: null,
        };
      }

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
        invalidatedNodeIds: undefined,
        invalidatedFields: undefined,
        run: { ...optimistic.run, status: "running" },
      });

      try {
        const response = await fetch(`/api/runs/${targetRunId}/messages`, {
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
    [activeId, activeProjectId, applySnapshot, busy, newRun],
  );

  const setNodeStatus = useCallback(
    async (nodeId: string, status: UserNodeStatus) => {
      if (!activeId) return false;
      const response = await fetch(`/api/runs/${activeId}/nodes/${nodeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) return false;
      applySnapshot(await readJson<RunSnapshot>(response));
      return true;
    },
    [activeId, applySnapshot],
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

  const activeProject = useMemo(
    () =>
      projects.find((item) => item.id === activeProjectId) ??
      projects[0] ??
      null,
    [projects, activeProjectId],
  );

  const value = useMemo(
    () => ({
      projects,
      activeProjectId: activeProject?.id ?? activeProjectId,
      activeProject,
      runs,
      activeId,
      snapshot,
      creating,
      createError,
      loadingRun,
      busy,
      selectProject,
      createProject,
      updateProject,
      deleteProject,
      selectRun,
      newRun,
      send,
      saveScope,
      setNodeStatus,
      deleteRun,
    }),
    [
      projects,
      activeProject,
      activeProjectId,
      runs,
      activeId,
      snapshot,
      creating,
      createError,
      loadingRun,
      busy,
      selectProject,
      createProject,
      updateProject,
      deleteProject,
      selectRun,
      newRun,
      send,
      saveScope,
      setNodeStatus,
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
