import { createElement, type ReactNode } from "react";
import { cardElement, FORMATS, type CardFormat, type CardSummary, type El } from "@codewrapped/card/element";
import { ScaledCard } from "./ScaledCard";

/** Turns the card's element tree (the same one satori renders) into React elements. */
function toReact(node: El | string, key?: number): ReactNode {
  if (typeof node === "string") return node;
  const { children, ...props } = node.props;
  const kids = children === undefined ? [] : Array.isArray(children) ? children : [children];
  return createElement(
    node.type,
    { ...props, key },
    ...kids.filter((c): c is El | string => Boolean(c)).map((c, i) => toReact(c, i)),
  );
}

type Props = { summary: CardSummary; handle?: string | null; animate?: boolean; label?: string };

type Variant = { format: CardFormat; theme: "light" | "dark"; className: string };

// Landscape from the sm breakpoint up; the story card on phones, where landscape text gets too small.
const VARIANTS: Variant[] = [
  { format: "landscape", theme: "light", className: "hidden sm:block sm:dark:hidden" },
  { format: "landscape", theme: "dark", className: "hidden sm:dark:block" },
  { format: "story", theme: "light", className: "block dark:hidden sm:hidden" },
  { format: "story", theme: "dark", className: "hidden dark:block sm:dark:hidden" },
];

/** The card as HTML, in light and dark, scaled to the container width. */
export function Card({ summary, handle = null, animate = false, label = "Card" }: Props) {
  return (
    <figure aria-label={label} className="m-0">
      {VARIANTS.map((v) => {
        const { width, height } = FORMATS[v.format];
        return (
          <div key={`${v.format}-${v.theme}`} className={v.className}>
            <ScaledCard width={width} height={height} animate={animate}>
              {toReact(cardElement(summary, { theme: v.theme, handle, format: v.format }))}
            </ScaledCard>
          </div>
        );
      })}
    </figure>
  );
}
