import type { Metadata } from "next";
import "../src/shaders/threeui.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "chat.jdump",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preload" href="/vaultboy.webp" as="image" type="image/webp" />
      </head>
      <body>{children}</body>
    </html>
  );
}
