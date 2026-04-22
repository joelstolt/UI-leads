import { spawn } from "node:child_process";
import path from "node:path";
import "server-only";

const PROJECT_ROOT = path.resolve(process.cwd(), "..");

export function streamScript(scriptName: string, args: string[], req: Request): Response {
  const scriptPath = path.resolve(PROJECT_ROOT, scriptName);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const child = spawn("node", [scriptPath, ...args], {
        cwd: PROJECT_ROOT,
        env: { ...process.env, FORCE_COLOR: "0" },
      });

      const send = (event: string, data: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const closeOnce = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      send("start", `node ${scriptName} ${args.join(" ")}`);

      child.stdout.on("data", (chunk: Buffer) => send("stdout", chunk.toString("utf8")));
      child.stderr.on("data", (chunk: Buffer) => send("stderr", chunk.toString("utf8")));
      child.on("error", (err) => send("error", err.message));
      child.on("close", (code) => {
        send("exit", String(code ?? 0));
        closeOnce();
      });

      req.signal.addEventListener("abort", () => {
        child.kill("SIGTERM");
        closeOnce();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
