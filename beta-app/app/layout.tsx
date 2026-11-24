import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Performance Engine · Private beta",
  description: "Evidence-grounded diagnostic feedback for ACCA AFM and SBR practice answers.",
  other: {
    "codex-preview": "acca-performance-engine-beta",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
