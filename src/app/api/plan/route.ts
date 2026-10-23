/**
 * POST /api/plan — run a Fanmap plan and stream progress.
 *
 * Body (artist mode): { mode: "artist", artist, region?, shows?, venueSize?, startCity?, notes? }
 * Body (venue mode):  { mode: "venue", venue, capacity?, genres?, notes? }
 * Response: newline-delimited JSON, one PlanEvent per line (see src/lib/types.ts),
 * ending with { type: "result" } or { type: "error" }.
 */
import { allowRequest, clientId } from "@/lib/limits";
import { validateArtistInput, validateVenueInput, PlanInputError } from "@/lib/plan";
import { getCachedPlan, runPlan } from "@/lib/runPlan";
import type { ArtistPlanInput, PlanEvent, VenuePlanInput } from "@/lib/types";

// agent runs can take a minute or two on a cold cache
export const maxDuration = 300;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a JSON body." }, { status: 400 });
  }

  const mode = (body as { mode?: string })?.mode ?? "artist";
  if (mode !== "artist" && mode !== "venue") return Response.json({ error: `Unknown mode "${mode}".` }, { status: 400 });

  let input: ArtistPlanInput | VenuePlanInput;
  try {
    input = mode === "venue" ? validateVenueInput(body) : validateArtistInput(body);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Invalid input." }, { status: 400 });
  }

  // rate limit: fresh plans cost real money, replays of cached ones are cheap
  const cached = !!(await getCachedPlan(input).catch(() => undefined));
  const gate = await allowRequest(clientId(request), cached);
  if (!gate.allowed) {
    return Response.json(
      {
        error: cached
          ? "You're going a bit fast. Please wait a little and try again."
          : `You've reached the limit of ${gate.limit} new plans per hour. Try one of the examples, or come back in a bit.`,
      },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } },
    );
  }
  const run = (emit: (event: PlanEvent) => void) => runPlan(input, emit, { signal: request.signal });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (event: PlanEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          open = false; // client went away
        }
      };
      request.signal.addEventListener("abort", () => (open = false));

      try {
        await run(emit);
      } catch (err) {
        const message =
          err instanceof PlanInputError || (err instanceof Error && /couldn't find|not enough fan data|unknown country|recognise/i.test(err.message))
            ? err.message
            : "Something went wrong while planning. Please try again.";
        if (request.signal.aborted) console.info("[fanmap] plan cancelled: the client disconnected");
        else console.error("[fanmap] plan failed:", err);
        emit({ type: "error", message });
      } finally {
        if (open) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
