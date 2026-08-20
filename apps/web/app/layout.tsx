import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Candor: the AI that tells you the truth about your trade",
  description:
    "Candor checks every trade and RWA deposit on X Layer before it happens. It can refuse or downsize a bad one, and it anchors every verdict on-chain so anyone can audit its judgment later.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
