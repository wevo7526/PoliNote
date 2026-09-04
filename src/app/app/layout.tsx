import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";
import { WorkspaceProvider } from "@/components/app/WorkspaceProvider";

export const metadata: Metadata = {
  title: "PoliNote",
};

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="studio h-dvh" />}>
      <WorkspaceProvider>
        <AppShell>{children}</AppShell>
      </WorkspaceProvider>
    </Suspense>
  );
}
