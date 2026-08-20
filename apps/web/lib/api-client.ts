import type { ConfirmCard, LedgerStats } from "@candor/shared";

// The API now lives in this same Next.js app (app/api/*), so an empty base
// means "same origin" — no separate host, no CORS, nothing to misconfigure.
// Only set NEXT_PUBLIC_API_BASE_URL if the API is ever split back out.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

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
  ledgerTxHash: string | null;
}

export function finalizeIntent(
  intentHash: string,
  decision: "confirm" | "override" | "dismiss",
  token: string
): Promise<FinalizeResult> {
  return request<FinalizeResult>(`/api/intent/${intentHash}/finalize`, {
    method: "POST",
    body: JSON.stringify({ decision, token }),
  });
}

export function getTrackRecord(): Promise<LedgerStats> {
  return request<LedgerStats>("/api/track-record");
}
