import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Candor — the AI that tells you the truth about your trade",
  description:
    "Candor risk-checks every trade and RWA allocation on X Layer, can refuse or downsize it, and anchors its verdict on-chain — a public, auditable track record of its judgment.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
