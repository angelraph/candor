import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";
import type { PreparedTx } from "./simulate";
import type { VerdictType } from "@candor/shared";

/**
 * Vercel's serverless runtime gives no guarantee that the request which
 * created a confirm card (POST /api/intent) and the request that finalizes
 * it (POST /api/intent/:hash/finalize) hit the same instance — there's no
 * safe place for an in-memory Map to live between them the way the old
 * Fastify server used one. Instead of standing up a database for a value
 * that lives ~60 seconds, the card's state (the prepared tx, who it's for,
 * what to anchor) travels to the browser and back inside a signed token —
 * the browser can see it but can't forge or tamper with it without the
 * server-side secret.
 */
export interface ConfirmTokenPayload {
  intentHash: string;
  evidenceHash: string;
  verdictType: VerdictType;
  riskScore: number;
  userAddress: string;
  tx: PreparedTx | null; // null when the verdict was REJECT and no tx was ever built
  expiresAt: number;
}

export class ConfirmCardExpiredError extends Error {
  constructor() {
    super("This confirm card expired or was already finalized. Ask again for a fresh one.");
    this.name = "ConfirmCardExpiredError";
  }
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function hmac(body: string): Buffer {
  return createHmac("sha256", config.confirmCardSecret).update(body).digest();
}

export function signConfirmToken(payload: ConfirmTokenPayload): string {
  const body = base64url(Buffer.from(JSON.stringify(payload)));
  return `${body}.${base64url(hmac(body))}`;
}

export function verifyConfirmToken(token: string): ConfirmTokenPayload {
  const [body, sig] = token.split(".");
  if (!body || !sig) throw new ConfirmCardExpiredError();

  const expected = hmac(body);
  const got = Buffer.from(sig, "base64url");
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
    throw new ConfirmCardExpiredError();
  }

  const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as ConfirmTokenPayload;
  if (Date.now() > payload.expiresAt) throw new ConfirmCardExpiredError();
  return payload;
}
