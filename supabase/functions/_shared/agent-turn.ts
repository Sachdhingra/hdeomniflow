import { parseAgentOutput, savedClaims, type AgentOutput } from "./agent-text.ts";
import type { AppliedAction } from "./agent-actions.ts";

export interface ChatMessage {
  role: string;
  content: string;
}

export interface TurnDeps {
  llm: (messages: ChatMessage[]) => Promise<string>;
  apply: (actions: AgentOutput["actions"]) => Promise<{ applied: AppliedAction[]; rejected: AppliedAction[] }>;
}

export interface TurnResult {
  parsed: AgentOutput;
  applied: AppliedAction[];
  rejected: AppliedAction[];
  retried: boolean;
}

const claimsAnything = (reply: string) => {
  const c = savedClaims(reply);
  return c.followUp || c.note;
};

// One coach turn: ask the model, apply its actions, and — if its reply claims it
// saved a follow-up/note but no action backed that — give it ONE corrective retry
// before the rep sees anything. The first LLM error propagates; a failing retry
// just keeps the first answer.
export async function runTurn(deps: TurnDeps, messages: ChatMessage[]): Promise<TurnResult> {
  const raw = await deps.llm(messages);
  let parsed = parseAgentOutput(raw);
  let { applied, rejected } = await deps.apply(parsed.actions);

  if (applied.length === 0 && rejected.length === 0 && claimsAnything(parsed.reply)) {
    const claim = savedClaims(parsed.reply);
    const what = [claim.followUp ? "a follow-up date" : "", claim.note ? "a note" : ""].filter(Boolean).join(" and ");
    try {
      const retryRaw = await deps.llm([
        ...messages,
        { role: "assistant", content: raw },
        {
          role: "user",
          content:
            `[SYSTEM CHECK] Your reply says you saved ${what}, but your "actions" array had no matching action, so NOTHING was saved. ` +
            `Reply again to the rep in the same language and tone, now with the correct action(s) in "actions" (use only lead ids from the context) — ` +
            `or, if you did not actually mean to save anything, rewrite the reply so it does not claim a save. Same JSON format, "actions" first.`,
        },
      ]);
      const second = parseAgentOutput(retryRaw);
      const secondResult = await deps.apply(second.actions);
      const acted = secondResult.applied.length > 0 || secondResult.rejected.length > 0;
      if (acted || !claimsAnything(second.reply)) {
        return { parsed: second, applied: secondResult.applied, rejected: secondResult.rejected, retried: true };
      }
    } catch (e) {
      console.error("staff-agent corrective retry failed", e);
    }
    return { parsed, applied, rejected, retried: true };
  }
  return { parsed, applied, rejected, retried: false };
}
