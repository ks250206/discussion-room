import type { ReactNode } from "react";
import { cn } from "../../lib/utils.ts";

type PanelProps = {
  readonly title: string;
  readonly titleId: string;
  readonly className?: string;
  readonly children: ReactNode;
};

export const Panel = ({ title, titleId, className, children }: PanelProps) => (
  <section
    aria-labelledby={titleId}
    data-slot="panel"
    className={cn("flex min-w-0 flex-col gap-3", className)}
  >
    <h2 id={titleId} className="text-base font-semibold">
      {title}
    </h2>
    {children}
  </section>
);
