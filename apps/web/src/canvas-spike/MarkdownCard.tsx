import { memo } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { SafeMarkdown } from "./SafeMarkdown.tsx";
import type { SpikeCardNode } from "./types.ts";

export const MarkdownCard = memo(function MarkdownCard({
  data,
  selected,
}: NodeProps<SpikeCardNode>) {
  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={180}
        minHeight={120}
        maxWidth={900}
        maxHeight={700}
      />
      <article className="spike-card" aria-label={data.title}>
        <header className="spike-card-title">{data.title}</header>
        <div className="spike-card-body nodrag nowheel">
          <SafeMarkdown source={data.markdown} />
        </div>
        <span className="spike-card-origin">Synthetic · 装飾線に科学的意味はありません</span>
      </article>
    </>
  );
});
