/**
 * POST /api/plan — run a Fanmap plan and stream progress.
 *
 * Body (artist mode): { mode: "artist", artist, region?, shows?, venueSize?, startCity?, notes? }
 * Response: newline-delimited JSON, one PlanEvent per line (see src/lib/types.ts),
 * ending with { type: "result" } or { type: "error" }.
 */
import { planArtist, validateArtistInput, PlanInputError } from "@/lib/plan";
import type { PlanEvent } from "@/lib/types";

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
  if (mode !== "artist") return Response.json({ error: `Mode "${mode}" isn't available yet.` }, { status: 400 });

  let input;
  try {
    input = validateArtistInput(body);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Invalid input." }, { status: 400 });
  }

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
        await planArtist(input, emit);
      } catch (err) {
        const message =
          err instanceof PlanInputError || (err instanceof Error && /couldn't find|not enough fan data|unknown country/i.test(err.message))
            ? err.message
            : "Something went wrong while planning. Please try again.";
        console.error("[fanmap] plan failed:", err);
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
