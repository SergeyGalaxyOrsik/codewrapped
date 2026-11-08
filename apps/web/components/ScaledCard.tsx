"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Scales a fixed-size card to the width of its container, keeping the aspect ratio. */
export function ScaledCard({ width, height, animate, children }: { width: number; height: number; animate: boolean; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div
      ref={box}
      className="relative w-full overflow-hidden rounded-[12px] border border-border"
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      {scale !== null && (
        <div
          className={animate ? "cw-animate" : undefined}
          style={{ width, height, transform: `scale(${scale})`, transformOrigin: "0 0", position: "absolute", top: 0, left: 0 }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
