import { Suspense } from "react";
import { ProjectDesk } from "@/components/spaces/ProjectDesk";

export default function ProjectPage() {
  return (
    <Suspense fallback={null}>
      <ProjectDesk />
    </Suspense>
  );
}
