import type { Metadata } from "next";
import "../src/shaders/threeui.css";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "chat.jdump",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <head>
        <link rel="preload" href="/vaultboy.webp" as="image" type="image/webp" />
      </head>
      <body>{children}</body>
    </html>
  );
}
