import type { SpikeCardNode } from "./types.ts";

const markdownFor = (index: number): string => {
  const number = index + 1;
  return [
    `## Synthetic card ${number}`,
    "",
    `Card ${number} is **fabricated** placeholder text. It is not measured data.`,
    "",
    "- inert item",
    "- no observations",
    "",
    "Label: `synthetic`.",
  ].join("\n");
};

export const createSyntheticCards = (count: 12 | 200): SpikeCardNode[] => {
  const cards: SpikeCardNode[] = [];
  for (let index = 0; index < count; index += 1) {
    cards.push({
      id: `synthetic-${index}`,
      type: "markdown",
      position: {
        x: (index % 10) * 300,
        y: Math.floor(index / 10) * 220,
      },
      width: 260,
      height: 180,
      dragHandle: ".spike-card-title",
      selected: index === 0,
      data: {
        synthetic: true,
        title: `Synthetic card ${index + 1}`,
        markdown: markdownFor(index),
      },
    });
  }
  return cards;
};
