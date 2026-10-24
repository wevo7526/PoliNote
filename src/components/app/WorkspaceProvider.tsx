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
import {
  createDefaultLocalProject,
  getOrCreateLocalUserId,
  loadLocalWorkspace,
  mergeProjects,
  mergeRuns,
  saveLocalWorkspace,
  setLocalUserId,
  USER_HEADER,
} from "@/lib/local-workspace";
import type { ProjectSummary, RunSnapshot, RunSummary } from "@/lib/platform-types";
import type { ScopeContract } from "@/schemas/scope-contract";
import type { UserNodeStatus } from "@/schemas/digression";

type WorkspaceContextValue = {
  userId: string;
  projects: ProjectSummary[];
  activeProjectId: string | null;
  activeProject: ProjectSummary | null;
  runs: RunSummary[];
  activeId: string | null;
  snapshot: RunSnapshot | null;
  snapshotsById: Record<string, RunSnapshot>;
  creating: boolean;
  createError: string | null;
  loadingRun: boolean;
  busy: boolean;
  selectProject: (projectId: string, navigate?: boolean) => void;
  createProject: (input?: {
    title?: string;
    description?: string;
    contextMemo?: string;
  }) => Promise<ProjectSummary>;
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
  setSnapshotsById: Dispatch<SetStateAction<Record<string, RunSnapshot>>>,
) {
  setSnapshot(next);
  setActiveId(next.run.id);
  setSnapshotsById((prev) => ({ ...prev, [next.run.id]: next }));
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

  const [userId, setUserId] = useState<string>(() => getOrCreateLocalUserId());
  const userIdRef = useRef<string>(userId);
  const hydratedLocalRef = useRef(false);

  const [projects, setProjects] = useState<ProjectSummary[]>(() => [
    createDefaultLocalProject(),
  ]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    projectFromUrl ?? createDefaultLocalProject().id,
  );
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(runFromUrl);
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [snapshotsById, setSnapshotsById] = useState<Record<string, RunSnapshot>>({});
  const [creating, setCreating] = useState(false);
  const [loadingRun, setLoadingRun] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const snapshotRef = useRef<RunSnapshot | null>(null);
  const snapshotsByIdRef = useRef<Record<string, RunSnapshot>>({});
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    snapshotsByIdRef.current = snapshotsById;
  }, [snapshotsById]);

  const apiFetch = useCallback(
    (url: string, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      if (userIdRef.current) {
        headers.set(USER_HEADER, userIdRef.current);
      }
      return fetch(url, {
        ...init,
        headers,
      });
    },
    [],
  );

  // Hydrate localized workspace from browser storage on mount, then merge with server
  useEffect(() => {
    const uid = getOrCreateLocalUserId();
    userIdRef.current = uid;
    setUserId(uid);

    const local = loadLocalWorkspace(uid);
    setProjects(local.projects);
    setRuns(local.runs);
    setSnapshotsById(local.snapshots);
    snapshotsByIdRef.current = local.snapshots;
    setActiveProjectId((prev) => projectFromUrl ?? local.activeProjectId ?? prev ?? local.projects[0]?.id ?? null);
    if (runFromUrl && local.snapshots[runFromUrl]) {
      setSnapshot(local.snapshots[runFromUrl]!);
      snapshotRef.current = local.snapshots[runFromUrl]!;
      setActiveId(runFromUrl);
    }
    hydratedLocalRef.current = true;

    let cancelled = false;
    void (async () => {
      try {
        const response = await apiFetch("/api/runs");
        if (!response.ok || cancelled) return;
        const data = await readJson<{
          projects?: ProjectSummary[];
          runs: RunSummary[];
          userId?: string;
        }>(response);
        if (cancelled) return;

        if (data.userId && data.userId !== userIdRef.current) {
          userIdRef.current = data.userId;
          setUserId(data.userId);
          setLocalUserId(data.userId);
        }

        const remoteProjects = data.projects ?? [];
        const remoteRuns = data.runs ?? [];
        const remoteProjectIds = new Set(remoteProjects.map((p) => p.id));

        const mergedProjects = mergeProjects(local.projects, remoteProjects);
        const mergedRuns = mergeRuns(local.runs, remoteRuns);

        setProjects(mergedProjects);
        setRuns(mergedRuns);
        setActiveProjectId(
          (prev) =>
            projectFromUrl ??
            (prev && mergedProjects.some((p) => p.id === prev) ? prev : null) ??
            mergedProjects[0]?.id ??
            null,
        );

        // Background-sync any locally created projects that the server instance doesn't have yet
        for (const localProj of local.projects) {
          if (!remoteProjectIds.has(localProj.id)) {
            void apiFetch("/api/projects", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(localProj),
            }).catch(() => undefined);
          }
        }
      } catch {
        /* local workspace remains active */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiFetch, projectFromUrl, runFromUrl]);

  // Persist localized workspace state to browser localStorage whenever it changes
  useEffect(() => {
    if (!hydratedLocalRef.current || !userId) return;
    saveLocalWorkspace(userId, {
      projects,
      activeProjectId,
      runs,
      snapshots: snapshotsById,
    });
  }, [userId, projects, activeProjectId, runs, snapshotsById]);

  const applySnapshot = useCallback((next: RunSnapshot) => {
    const normalized: RunSnapshot = { ...next, events: next.events ?? [] };
    snapshotRef.current = normalized;
    applyAndSyncRuns(
      normalized,
      setSnapshot,
      setActiveId,
      setRuns,
      setSnapshotsById,
    );
    if (normalized.run.projectId) {
      setActiveProjectId(normalized.run.projectId);
    }
  }, []);

  const setRunInUrl = useCallback(
    (id: string, targetPath?: string) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("run", id);
      next.delete("project");
      const dest = targetPath ?? pathname;
      router.replace(`${dest}?${next.toString()}`);
    },
    [pathname, router, searchParams],
  );

  // Sync activeProjectId only when the URL ?project= parameter itself changes
  useEffect(() => {
    if (projectFromUrl) {
      setActiveProjectId(projectFromUrl);
    }
  }, [projectFromUrl]);

  useEffect(() => {
    if (!runFromUrl) return;
    if (snapshot?.run.id === runFromUrl) return;
    const cached = snapshotsByIdRef.current[runFromUrl];
    if (cached) {
      applySnapshot(cached);
    }
    let cancelled = false;
    setLoadingRun(true);
    void (async () => {
      try {
        const response = await apiFetch(`/api/runs/${runFromUrl}`);
        if (!cancelled && response.ok) {
          const data = await readJson<RunSnapshot>(response);
          applySnapshot(data);
        }
      } catch {
        /* fallback to cached snapshot */
      } finally {
        if (!cancelled) setLoadingRun(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiFetch, applySnapshot, runFromUrl, snapshot?.run.id]);

  const selectProject = useCallback(
    (projectId: string, navigate = false) => {
      setActiveProjectId(projectId);
      setCreateError(null);

      // If the currently open run belongs to a different project, clear or switch to this project's latest run
      if (
        snapshotRef.current &&
        snapshotRef.current.run.projectId &&
        snapshotRef.current.run.projectId !== projectId
      ) {
        abortRef.current?.abort();
        snapshotRef.current = null;
        setSnapshot(null);
        setActiveId(null);
      }

      if (navigate) {
        router.push(`/app/project?project=${projectId}`);
      } else if (pathname.startsWith("/app/project")) {
        router.replace(`/app/project?project=${projectId}`);
      }
    },
    [pathname, router],
  );

  const createProject = useCallback(
    async (input?: {
      title?: string;
      description?: string;
      contextMemo?: string;
    }): Promise<ProjectSummary> => {
      setCreateError(null);
      const ts = new Date().toISOString();
      const localProject: ProjectSummary = {
        id: `proj_${crypto.randomUUID().slice(0, 12)}`,
        title: input?.title?.trim() || "New Policy Project",
        description:
          input?.description?.trim() ||
          "Shared policy workspace holding related runs, evidence spans, and synthesized reports.",
        contextMemo: input?.contextMemo?.trim() || "",
        createdAt: ts,
        updatedAt: ts,
      };

      // Immediately update localized state so project creation works with zero delay or account requirement
      abortRef.current?.abort();
      snapshotRef.current = null;
      setSnapshot(null);
      setActiveId(null);
      setProjects((prev) => [
        localProject,
        ...prev.filter((item) => item.id !== localProject.id),
      ]);
      setActiveProjectId(localProject.id);

      try {
        const response = await apiFetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(localProject),
        });
        if (response.ok) {
          const data = await readJson<{ project: ProjectSummary }>(response);
          if (data.project) {
            setProjects((prev) =>
              prev.map((item) =>
                item.id === localProject.id ? data.project : item,
              ),
            );
            setActiveProjectId(data.project.id);
            return data.project;
          }
        }
      } catch {
        /* local project is already persisted in browser storage */
      }

      return localProject;
    },
    [apiFetch],
  );

  const updateProject = useCallback(
    async (
      projectId: string,
      input: { title?: string; description?: string; contextMemo?: string },
    ) => {
      const ts = new Date().toISOString();
      let optimistic: ProjectSummary | null = null;
      setProjects((prev) =>
        prev.map((item) => {
          if (item.id !== projectId) return item;
          optimistic = {
            ...item,
            title:
              typeof input.title === "string" && input.title.trim()
                ? input.title.trim()
                : item.title,
            description:
              typeof input.description === "string"
                ? input.description.trim()
                : item.description,
            contextMemo:
              typeof input.contextMemo === "string"
                ? input.contextMemo.trim()
                : item.contextMemo,
            updatedAt: ts,
          };
          return optimistic;
        }),
      );

      try {
        const response = await apiFetch(`/api/projects/${projectId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (response.ok) {
          const data = await readJson<{ project: ProjectSummary }>(response);
          setProjects((prev) =>
            prev.map((item) => (item.id === projectId ? data.project : item)),
          );
          return data.project;
        }
      } catch {
        /* keep local update */
      }
      return optimistic;
    },
    [apiFetch],
  );

  const deleteProject = useCallback(
    async (projectId: string) => {
      let nextActiveId: string | null = null;
      setProjects((prev) => {
        const remaining = prev.filter((p) => p.id !== projectId);
        const finalProjects =
          remaining.length > 0 ? remaining : [createDefaultLocalProject()];
        nextActiveId = finalProjects[0]?.id ?? null;
        return finalProjects;
      });
      setRuns((prev) => prev.filter((r) => r.projectId !== projectId));
      setSnapshotsById((prev) => {
        const copy = { ...prev };
        for (const [rId, snap] of Object.entries(copy)) {
          if (snap.run.projectId === projectId) {
            delete copy[rId];
          }
        }
        return copy;
      });
      setActiveProjectId(nextActiveId);
      if (snapshotRef.current?.run.projectId === projectId) {
        snapshotRef.current = null;
        setSnapshot(null);
        setActiveId(null);
      }
      if (pathname.startsWith("/app/project") && nextActiveId) {
        router.replace(`/app/project?project=${nextActiveId}`);
      }

      try {
        await apiFetch(`/api/projects/${projectId}`, {
          method: "DELETE",
        });
      } catch {
        /* already removed locally */
      }
    },
    [apiFetch, pathname, router],
  );

  const selectRun = useCallback(
    async (id: string, targetPath?: string) => {
      setRunInUrl(id, targetPath);
      if (snapshot?.run.id === id) return;
      const localSnap = snapshotsByIdRef.current[id];
      if (localSnap) {
        applySnapshot(localSnap);
      }
      setLoadingRun(true);
      try {
        const response = await apiFetch(`/api/runs/${id}`);
        if (!response.ok) return;
        applySnapshot(await readJson<RunSnapshot>(response));
      } catch {
        /* local snapshot already applied if available */
      } finally {
        setLoadingRun(false);
      }
    },
    [apiFetch, applySnapshot, setRunInUrl, snapshot?.run.id],
  );

  const newRun = useCallback(
    async (projectId?: string, initialTitle?: string): Promise<RunSummary | null> => {
      setCreating(true);
      setCreateError(null);
      const targetProjectId =
        projectId ?? activeProjectId ?? projects[0]?.id ?? createDefaultLocalProject().id;
      const targetProject =
        projects.find((p) => p.id === targetProjectId) ?? null;
      const ts = new Date().toISOString();
      const localRun: RunSummary = {
        id: crypto.randomUUID(),
        projectId: targetProjectId,
        title: initialTitle?.trim() || "Untitled run",
        status: "draft",
        createdAt: ts,
        updatedAt: ts,
      };

      try {
        const response = await apiFetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: localRun.id,
            projectId: targetProjectId,
            title: initialTitle,
            project: targetProject,
          }),
        });
        const finalRun = response.ok
          ? (await readJson<{ run: RunSummary }>(response)).run
          : localRun;

        const freshSnapshot: RunSnapshot = {
          run: finalRun,
          items: [],
          nodes: [],
          edges: [],
          scope: null,
          analyses: {},
          events: [],
          draft: null,
        };
        applySnapshot(freshSnapshot);
        router.replace(`/app/run?run=${finalRun.id}`);
        return finalRun;
      } catch {
        const freshSnapshot: RunSnapshot = {
          run: localRun,
          items: [],
          nodes: [],
          edges: [],
          scope: null,
          analyses: {},
          events: [],
          draft: null,
        };
        applySnapshot(freshSnapshot);
        router.replace(`/app/run?run=${localRun.id}`);
        return localRun;
      } finally {
        setCreating(false);
      }
    },
    [activeProjectId, apiFetch, applySnapshot, projects, router],
  );

  const activeProject = useMemo(
    () =>
      projects.find((item) => item.id === activeProjectId) ??
      projects[0] ??
      null,
    [projects, activeProjectId],
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

      const proj =
        projects.find((p) => p.id === (current?.run.projectId ?? activeProjectId)) ??
        activeProject;
      const clientProjectContext = proj
        ? [
            `Project: ${proj.title}`,
            proj.description ? `Description: ${proj.description}` : "",
            proj.contextMemo ? `Project Instructions / Memo: ${proj.contextMemo}` : "",
          ]
            .filter(Boolean)
            .join("\n")
        : "";

      try {
        const response = await apiFetch(`/api/runs/${targetRunId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: trimmed,
            projectId: proj?.id,
            projectContext: clientProjectContext,
          }),
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
    [activeId, activeProject, activeProjectId, apiFetch, applySnapshot, busy, newRun, projects],
  );

  const setNodeStatus = useCallback(
    async (nodeId: string, status: UserNodeStatus) => {
      if (!activeId) return false;
      const current = snapshotRef.current;
      if (current) {
        const updatedNodes = current.nodes.map((n) =>
          n.id === nodeId ? { ...n, status, updatedAt: new Date().toISOString() } : n,
        );
        applySnapshot({ ...current, nodes: updatedNodes });
      }
      try {
        const response = await apiFetch(`/api/runs/${activeId}/nodes/${nodeId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        if (response.ok) {
          applySnapshot(await readJson<RunSnapshot>(response));
        }
        return true;
      } catch {
        return Boolean(current);
      }
    },
    [activeId, apiFetch, applySnapshot],
  );

  const saveScope = useCallback(
    async (scope: ScopeContract) => {
      if (!activeId) return false;
      const current = snapshotRef.current;
      if (current) {
        applySnapshot({ ...current, scope });
      }
      try {
        const response = await apiFetch(`/api/runs/${activeId}/scope`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(scope),
        });
        if (response.ok) {
          applySnapshot(await readJson<RunSnapshot>(response));
        }
        return true;
      } catch {
        return Boolean(current);
      }
    },
    [activeId, apiFetch, applySnapshot],
  );

  const deleteRun = useCallback(
    async (id: string) => {
      if (snapshotRef.current?.run.id === id) {
        abortRef.current?.abort();
      }
      let remaining: RunSummary[] = [];
      setRuns((prev) => {
        remaining = prev.filter((run) => run.id !== id);
        return remaining;
      });
      setSnapshotsById((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
      void apiFetch(`/api/runs/${id}`, { method: "DELETE" }).catch(() => undefined);

      if (activeId !== id && snapshotRef.current?.run.id !== id) return;
      snapshotRef.current = null;
      setSnapshot(null);
      setActiveId(null);
      const nextInProject = remaining.find((r) => r.projectId === activeProjectId) ?? remaining[0];
      if (nextInProject) {
        await selectRun(nextInProject.id);
        return;
      }
      router.replace(pathname);
    },
    [activeId, activeProjectId, apiFetch, pathname, router, selectRun],
  );

  const value = useMemo(
    () => ({
      userId,
      projects,
      activeProjectId: activeProject?.id ?? activeProjectId,
      activeProject,
      runs,
      activeId,
      snapshot,
      snapshotsById,
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
      userId,
      projects,
      activeProject,
      activeProjectId,
      runs,
      activeId,
      snapshot,
      snapshotsById,
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
