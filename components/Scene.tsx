"use client";

import { CrtBackground } from "@/src/shaders/crt/CrtBackground";

export function Scene() {
  return (
    <div className="shader-frame">
      <CrtBackground
        variant="terminal"
        speed={1.00}
        typeSpeed={1.00}
        motion={1.00}
        hue={0}
        saturation={1.00}
        brightness={1.00}
        opacity={1.00}
      />
    </div>
  );
}
