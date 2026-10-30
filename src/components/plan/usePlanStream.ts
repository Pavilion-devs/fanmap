"use client";

import { useEffect, useReducer, useState } from "react";
import type { Notice, Plan, PlanEvent, PlanInput, StepStatus } from "@/lib/types";

export type LogItem =
  | { kind: "step"; id: string; label: string; status: StepStatus; tool?: string; ms?: number; detail?: string }
  | { kind: "thought"; id: string; text: string };

export type StreamError = { kind: "not_found" | "limit" | "input" | "network" | "server"; message: string };

export interface StreamState {
  status: "running" | "done" | "error" | "cancelled";
  log: LogItem[];
  /** partial results by plan key, as they arrive */
  partial: Record<string, unknown>;
  plan?: Plan;
  notices: Notice[];
  error?: StreamError;
  startedAt: number;
  finishedAt?: number;
}

type Action = { type: "start"; at: number } | { type: "event"; event: PlanEvent; at: number } | { type: "fail"; error: StreamError; at: number } | { type: "cancel"; at: number };

const initial = (at: number): StreamState => ({ status: "running", log: [], partial: {}, notices: [], startedAt: at });

function classify(message: string, status?: number): StreamError {
  if (status === 429) return { kind: "limit", message };
  if (/couldn't find|no artist|no venue|recognise|not enough fan data/i.test(message)) return { kind: "not_found", message };
  if (status === 400) return { kind: "input", message };
  return { kind: "server", message };
}

function reducer(state: StreamState, action: Action): StreamState {
  switch (action.type) {
    case "start":
      return initial(action.at);
    case "cancel":
      return state.status === "running" ? { ...state, status: "cancelled", finishedAt: action.at } : state;
    case "fail":
      return { ...state, status: "error", error: action.error, finishedAt: action.at };
    case "event": {
      const e = action.event;
      if (e.type === "step") {
        const item: LogItem = { kind: "step", id: e.id, label: e.label, status: e.status, tool: e.tool, ms: e.ms, detail: e.detail };
        const at = state.log.findIndex((l) => l.kind === "step" && l.id === e.id);
        const log = at < 0 ? [...state.log, item] : state.log.map((l, i) => (i === at ? item : l));
        return { ...state, log };
      }
      if (e.type === "thought") return { ...state, log: [...state.log, { kind: "thought", id: `t${state.log.length}`, text: e.text }] };
      if (e.type === "partial") return { ...state, partial: { ...state.partial, [e.key]: e.value } };
      if (e.type === "notice") {
        if (state.notices.some((n) => n.message === e.notice.message)) return state;
        return { ...state, notices: [...state.notices, e.notice] };
      }
      if (e.type === "result") {
        const notices = [...state.notices];
        for (const n of e.plan.notices) if (!notices.some((x) => x.message === n.message)) notices.push(n);
        // steps the agent left "running" (cut short by the final answer) count as done
        const log = state.log.map((l) => (l.kind === "step" && l.status === "running" ? { ...l, status: "done" as const } : l));
        return { ...state, status: "done", plan: e.plan, notices, log, finishedAt: action.at };
      }
      if (e.type === "error") return { ...state, status: "error", error: classify(e.message), finishedAt: action.at };
      return state;
    }
  }
}

/**
 * Runs a plan against /api/plan and folds the streamed events into state.
 * Leaving the page (or calling cancel) aborts the request, which stops the run on the server.
 */
export function usePlanStream(input: PlanInput) {
  const [attempt, setAttempt] = useState(0);
  const [controller, setController] = useState<AbortController | null>(null);
  const [state, dispatch] = useReducer(reducer, 0, initial);
  const body = JSON.stringify(input);

  useEffect(() => {
    const abort = new AbortController();
    let done = false;

    async function run() {
      dispatch({ type: "start", at: Date.now() });
      setController(abort);
      let res: Response;
      try {
        res = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: abort.signal });
      } catch {
        if (!abort.signal.aborted) dispatch({ type: "fail", error: { kind: "network", message: "We couldn't reach Fanmap. Check your connection and try again." }, at: Date.now() });
        return;
      }
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        dispatch({ type: "fail", error: classify(data.error ?? "Something went wrong. Please try again.", res.status), at: Date.now() });
        return;
      }

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      try {
        for (;;) {
          const { value, done: end } = await reader.read();
          if (end) break;
          buffer += value;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as PlanEvent;
            if (event.type === "result" || event.type === "error") done = true;
            dispatch({ type: "event", event, at: Date.now() });
          }
        }
        if (!done && !abort.signal.aborted) {
          dispatch({ type: "fail", error: { kind: "network", message: "The connection dropped before the plan finished. Please try again." }, at: Date.now() });
        }
      } catch {
        if (!abort.signal.aborted) dispatch({ type: "fail", error: { kind: "network", message: "The connection dropped before the plan finished. Please try again." }, at: Date.now() });
      }
    }

    // Deferred a tick so React's dev double-mount doesn't start (and bill) two runs.
    const timer = setTimeout(run, 0);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [body, attempt]);

  const cancel = () => {
    controller?.abort();
    dispatch({ type: "cancel", at: Date.now() });
  };
  const retry = () => setAttempt((n) => n + 1);

  return { ...state, cancel, retry };
}

/** Seconds since `from`, ticking while `running`. */
export function useElapsed(from: number, until: number | undefined) {
  const [now, setNow] = useState(from);
  useEffect(() => {
    if (until) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [until]);
  return Math.max(0, Math.floor(((until ?? now) - from) / 1000));
}
