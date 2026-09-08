import type { Metadata } from "next";
import "../src/shaders/threeui.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "chat.jdump",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
