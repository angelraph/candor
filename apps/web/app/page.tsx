import Link from "next/link";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import { ChatPanel } from "@/components/ChatPanel";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center px-6 py-10">
      <header className="flex w-full items-center justify-between">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Candor</h1>
          <p className="text-xs text-black/50 dark:text-white/50">on X Layer</p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/track-record" className="text-sm text-black/60 underline-offset-4 hover:underline dark:text-white/60">
            Track Record
          </Link>
          <WalletConnectButton />
        </div>
      </header>

      <div className="mt-16 text-center">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          The AI that tells you the truth about your trade.
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-black/60 dark:text-white/50">
          Ask for a swap or a yield allocation. Candor risk-checks it in parallel with preparing the transaction,
          can refuse or downsize it, and anchors its verdict on-chain — whether you follow it or not.
        </p>
      </div>

      <div className="mt-10 w-full flex-1 flex justify-center">
        <ChatPanel />
      </div>
    </main>
  );
}
