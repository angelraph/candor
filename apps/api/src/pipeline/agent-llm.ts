import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import type { RiskFeatures, VerdictType } from "@candor/shared";

// Fast, cheap model — deliberately not a large/slow one. The slow path is
// still meant to feel fast; it just does real reasoning the rule engine
// can't, for borderline/novel requests only.
const MODEL = "claude-haiku-4-5-20251001";

const client = config.anthropicConfigured ? new Anthropic({ apiKey: config.anthropicApiKey! }) : null;

export class AnthropicNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not configured — slow-path parsing/verdicts are unavailable in this mode");
    this.name = "AnthropicNotConfiguredError";
  }
}

// ---------------------------------------------------------------------------
// Slow-path intent parsing — only reached when the fast-path classifier
// returns null (unrecognized phrasing, unsupported action type, etc).
// ---------------------------------------------------------------------------

export type ParsedIntent =
  | { type: "swap"; fromTokenSymbol: string; toTokenSymbol: string; amountHuman: string }
  | { type: "vault_deposit"; assetTokenSymbol: string; amountHuman: string | "full_balance" }
  | { type: "unsupported"; reason: string };

const PARSE_INTENT_TOOL: Anthropic.Tool = {
  name: "parsed_intent",
  description: "The structured financial action extracted from the user's message.",
  input_schema: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["swap", "vault_deposit", "unsupported"] },
      fromTokenSymbol: { type: "string", description: "Token symbol being sold, for swaps only." },
      toTokenSymbol: { type: "string", description: "Token symbol being bought, for swaps only." },
      assetTokenSymbol: { type: "string", description: "Token symbol being deposited, for vault deposits only." },
      amountHuman: {
        type: "string",
        description:
          "Amount in human units as a plain number string (e.g. '500'), or the literal 'full_balance' if the user means their entire/idle balance.",
      },
      reason: {
        type: "string",
        description: "For 'unsupported': one sentence on why this can't be handled (e.g. no hedging venue yet).",
      },
    },
    required: ["type"],
  },
};

export async function parseIntentWithClaude(message: string): Promise<ParsedIntent> {
  if (!client) throw new AnthropicNotConfiguredError();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    system:
      "You extract structured financial intents for Candor, an AI agent on X Layer. " +
      "Supported actions are ONLY: 'swap' (token A to token B) and 'vault_deposit' (deposit a stablecoin into a yield vault). " +
      "Anything else (hedging, derivatives, lending, staking, cross-chain, etc.) must be classified as 'unsupported' with a one-sentence reason — never invent an action type outside the two supported ones.",
    messages: [{ role: "user", content: message }],
    tools: [PARSE_INTENT_TOOL],
    tool_choice: { type: "tool", name: "parsed_intent" },
  });

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) return { type: "unsupported", reason: "model did not return a structured intent" };

  const input = toolUse.input as Record<string, string>;
  if (input.type === "swap" && input.fromTokenSymbol && input.toTokenSymbol && input.amountHuman) {
    return {
      type: "swap",
      fromTokenSymbol: input.fromTokenSymbol,
      toTokenSymbol: input.toTokenSymbol,
      amountHuman: input.amountHuman,
    };
  }
  if (input.type === "vault_deposit" && input.assetTokenSymbol && input.amountHuman) {
    return {
      type: "vault_deposit",
      assetTokenSymbol: input.assetTokenSymbol,
      amountHuman: input.amountHuman === "full_balance" ? "full_balance" : input.amountHuman,
    };
  }
  return { type: "unsupported", reason: input.reason ?? "could not confidently parse this request" };
}

// ---------------------------------------------------------------------------
// LLM risk verdict — only reached for borderline/large requests the rule
// engine declines to auto-approve. Judges COMPUTED features, never invents
// its own numbers.
// ---------------------------------------------------------------------------

const RISK_VERDICT_TOOL: Anthropic.Tool = {
  name: "risk_verdict",
  description: "Your risk judgment on this financial action, given the computed risk features.",
  input_schema: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["EXECUTE", "EXECUTE_SMALLER", "WAIT", "REJECT"] },
      riskScore: { type: "integer", minimum: 0, maximum: 100 },
      rationale: { type: "string", description: "One to two plain-English sentences the user will read directly." },
      suggestedFractionOfRequestedSize: {
        type: "number",
        description: "Only for EXECUTE_SMALLER: fraction (0-1) of the requested size you'd approve instead.",
      },
    },
    required: ["verdict", "riskScore", "rationale"],
  },
};

export interface LlmVerdictResult {
  verdict: VerdictType;
  riskScore: number;
  rationale: string;
  suggestedFraction: number | null;
}

export async function judgeRiskWithClaude(
  features: RiskFeatures,
  context: { actionSummary: string; userMessage: string }
): Promise<LlmVerdictResult> {
  if (!client) throw new AnthropicNotConfiguredError();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system:
      "You are Candor's risk adjudicator. You are shown ONLY deterministic, already-computed risk features — " +
      "never invent numbers not given to you. Your job is to decide whether this financial action should proceed " +
      "as requested (EXECUTE), proceed at reduced size (EXECUTE_SMALLER), wait for better conditions (WAIT), or be " +
      "refused (REJECT). You are allowed and expected to say no when warranted — a user trusts you more, not less, " +
      "for pushing back on a bad trade. Be concise and specific in your rationale; the user reads it directly.",
    messages: [
      {
        role: "user",
        content:
          `User asked: "${context.userMessage}"\n` +
          `Resolved action: ${context.actionSummary}\n` +
          `Computed risk features: ${JSON.stringify(features, null, 2)}`,
      },
    ],
    tools: [RISK_VERDICT_TOOL],
    tool_choice: { type: "tool", name: "risk_verdict" },
  });

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) {
    return { verdict: "WAIT", riskScore: 50, rationale: "Model did not return a verdict; defaulting to caution.", suggestedFraction: null };
  }

  const input = toolUse.input as {
    verdict: VerdictType;
    riskScore: number;
    rationale: string;
    suggestedFractionOfRequestedSize?: number;
  };

  return {
    verdict: input.verdict,
    riskScore: Math.max(0, Math.min(100, Math.round(input.riskScore))),
    rationale: input.rationale,
    suggestedFraction:
      input.verdict === "EXECUTE_SMALLER" && typeof input.suggestedFractionOfRequestedSize === "number"
        ? Math.max(0, Math.min(1, input.suggestedFractionOfRequestedSize))
        : null,
  };
}
