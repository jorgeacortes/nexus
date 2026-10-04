import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Nexus — agent operations console",
  description: "Monitor agents and manage agent tasks",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
