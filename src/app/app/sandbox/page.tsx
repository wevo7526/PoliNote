import { Suspense } from "react";
import { SandboxDesk } from "@/components/spaces/SandboxDesk";

export default function SandboxPage() {
  return (
    <Suspense fallback={null}>
      <SandboxDesk />
    </Suspense>
  );
}
