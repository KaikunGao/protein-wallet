import { estimate, postProcess } from "@/lib/estimate/estimate";
import { mockModelOutput } from "@/lib/estimate/mock";
import { EstimateInputSchema, type EstimateResponse } from "@/lib/estimate/schema";

export const maxDuration = 60;

function json(body: EstimateResponse, status = 200) {
  return Response.json(body, { status });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "请求格式错误", retryable: false }, 400);
  }
  const parsed = EstimateInputSchema.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "参数不合法:" + parsed.error.issues[0]?.message, retryable: false }, 400);
  }
  const input = parsed.data;
  if (input.type !== "text") {
    // Accept data URLs from the client but send the API raw base64.
    const m = input.content.match(/^data:(image\/(?:jpeg|png|webp));base64,([\s\S]*)$/);
    if (m) {
      input.media_type = m[1] as typeof input.media_type;
      input.content = m[2];
    }
  }

  if (process.env.ESTIMATE_MOCK === "1") {
    return json(postProcess(mockModelOutput(input), input));
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return json({ ok: false, error: "服务端未配置 ANTHROPIC_API_KEY", retryable: false }, 500);
  }
  return json(await estimate(input));
}
