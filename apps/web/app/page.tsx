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

      <div className="mt-14 text-center">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          The AI that tells you the truth about your trade.
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-black/60 dark:text-white/50">
          Type what you want to do. Candor will actually check it before your wallet ever pops up, and it's
          allowed to say no.
        </p>
      </div>

      <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          {
            n: "1",
            title: "Say what you want",
            body: "Type it like you'd tell a person: \"swap 500 USDT for ETH\" or \"put my idle USDT somewhere it earns.\" No forms, no dropdowns.",
          },
          {
            n: "2",
            title: "Candor checks it first",
            body: "While your transaction is being built, Candor runs the numbers on it. If the trade is bad, it'll tell you, and it can shrink it or refuse it outright.",
          },
          {
            n: "3",
            title: "Every verdict, on-chain",
            body: "Followed the advice or ignored it, the call gets written to the chain. That's the receipt: a public history of what Candor said, not just what it did.",
          },
        ].map((step) => (
          <div key={step.n} className="rounded-2xl border border-black/10 p-4 text-left dark:border-white/10">
            <span className="text-xs font-mono text-black/30 dark:text-white/30">{step.n}</span>
            <h3 className="mt-1 text-sm font-semibold">{step.title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-black/55 dark:text-white/50">{step.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 w-full flex-1 flex justify-center">
        <ChatPanel />
      </div>
    </main>
  );
}
