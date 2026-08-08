import type { ConfirmCard, LedgerStats } from "@candor/shared";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.json();
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? "unknown_error", body.message ?? "Request failed");
  }
  return body as T;
}

export function postIntent(params: { message: string; userAddress: string; chainId: number }): Promise<ConfirmCard> {
  return request<ConfirmCard>("/api/intent", { method: "POST", body: JSON.stringify(params) });
}

export interface FinalizeResult {
  tx: { to: string; data: string; value: string; gas: string } | null;
}

export function finalizeIntent(
  intentHash: string,
  decision: "confirm" | "override" | "dismiss"
): Promise<FinalizeResult> {
  return request<FinalizeResult>(`/api/intent/${intentHash}/finalize`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
}

export interface LedgerStatusResult {
  status: "unconfigured" | "pending" | "confirmed" | "failed";
  txHash: string | null;
  error: string | null;
}

export function getLedgerStatus(intentHash: string): Promise<LedgerStatusResult> {
  return request<LedgerStatusResult>(`/api/intent/${intentHash}/ledger-status`);
}

export function getTrackRecord(): Promise<LedgerStats> {
  return request<LedgerStats>("/api/track-record");
}
