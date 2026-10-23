/**
 * The shared agent loop: Claude calls our tools until it submits a plan.
 * Every tool call streams to the UI as a progress step; the agent's notes as "thought" events.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { PlanEvent, RunInfo } from "@/lib/types";
import { BETAS, MODEL, claude } from "./claude";
import { addUsage, emptyUsage } from "./usage";

type Emit = (event: PlanEvent) => void;
type MessageParam = Anthropic.Beta.BetaMessageParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

/** Thrown for bad tool input; the message goes back to Claude so it can correct itself. */
export class ToolInputError extends Error {}

/** A tool error that should end the run (e.g. the artist or venue doesn't exist). */
export class FatalToolError extends Error {}

/** The client went away; stop spending. */
export class RunAbortedError extends Error {
  constructor() {
    super("The request was cancelled.");
  }
}

export interface AgentConfig {
  system: string;
  tools: Anthropic.Beta.BetaTool[];
  userMessage: string;
  runTool: (name: string, input: Record<string, unknown>) => Promise<unknown>;
  label: (name: string, input: Record<string, unknown>) => string;
  detail?: (name: string, output: unknown) => string | undefined;
  /** true once the agent has submitted its plan */
  isDone: () => boolean;
  finishPrompt: string;
  maxTurns?: number;
}

export async function runAgentLoop(
  config: AgentConfig,
  emit: Emit,
  signal?: AbortSignal,
): Promise<Omit<RunInfo, "ms">> {
  const maxTurns = config.maxTurns ?? 12;
  const toolCalls: RunInfo["toolCalls"] = [];
  const usage = emptyUsage();
  const messages: MessageParam[] = [
    { role: "user", content: config.userMessage },
  ];
  let turns = 0;
  let stepCounter = 0;

  while (turns < maxTurns) {
    if (signal?.aborted) {
      console.info(`[fanmap] agent stopped after ${turns} turns: the client disconnected`);
      throw new RunAbortedError();
    }
    const response = await claude().beta.messages.create(
      {
        model: MODEL,
        max_tokens: 16000,
        betas: BETAS,
        fallbacks: "default",
        thinking: { type: "adaptive", display: "updates" },
        output_config: { effort: "medium" },
        system: [
          {
            type: "text",
            text: config.system,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: config.tools,
        messages,
      },
      { signal: signal ?? undefined },
    );
    turns++;
    addUsage(usage, response.usage, MODEL);

    if (response.stop_reason === "refusal")
      throw new Error("The model declined this request.");

    for (const block of response.content) {
      const text =
        block.type === "thinking"
          ? block.thinking
          : block.type === "text"
            ? block.text
            : "";
      if (text.trim()) emit({ type: "thought", text: text.trim() });
    }

    // append the assistant turn unchanged (thinking blocks must be passed back as-is)
    messages.push({ role: "assistant", content: response.content });

    const uses = response.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );
    if (!uses.length) {
      if (config.isDone()) break;
      if (response.stop_reason === "max_tokens")
        throw new Error("The agent ran out of room before finishing.");
      messages.push({ role: "user", content: config.finishPrompt });
      continue;
    }
    if (response.stop_reason === "max_tokens")
      throw new Error("A tool call was cut off (max_tokens).");

    // this turn's tool calls run in parallel; all results go back in one message
    const results = await Promise.all(
      uses.map(async (use): Promise<ToolResult> => {
        const input = (use.input ?? {}) as Record<string, unknown>;
        const id = `${use.name}-${++stepCounter}`;
        const label = config.label(use.name, input);
        const t0 = Date.now();
        emit({ type: "step", id, label, status: "running", tool: use.name });
        try {
          const output = await config.runTool(use.name, input);
          const ms = Date.now() - t0;
          toolCalls.push({ tool: use.name, ms });
          let detail: string | undefined;
          try {
            detail = config.detail?.(use.name, output);
          } catch {
            detail = undefined;
          }
          emit({
            type: "step",
            id,
            label,
            status: "done",
            tool: use.name,
            ms,
            detail,
          });
          return {
            type: "tool_result",
            tool_use_id: use.id,
            content: JSON.stringify(output),
          };
        } catch (err) {
          const ms = Date.now() - t0;
          const message = err instanceof Error ? err.message : String(err);
          emit({
            type: "step",
            id,
            label,
            status: "failed",
            tool: use.name,
            ms,
            detail: message.slice(0, 200),
          });
          if (err instanceof FatalToolError) throw err;
          return {
            type: "tool_result",
            tool_use_id: use.id,
            is_error: true,
            content:
              err instanceof ToolInputError
                ? message
                : `Tool failed: ${message.slice(0, 300)}`,
          };
        }
      }),
    );
    messages.push({ role: "user", content: results });

    if (config.isDone()) break;
  }

  if (!config.isDone())
    throw new Error(`The agent didn't finish within ${maxTurns} turns.`);
  return { engine: "agent", model: MODEL, toolCalls, turns, usage };
}
