import { spawn } from "node:child_process";
import path from "node:path";
import "server-only";

const PROJECT_ROOT = path.resolve(process.cwd(), "..");
const IS_VERCEL = process.env.VERCEL === "1";

function quoteArg(a: string): string {
  return /[\s"'`$&|<>;(){}[\]*?!#]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}

export function streamScript(scriptName: string, args: string[], req: Request): Response {
  const scriptPath = path.resolve(PROJECT_ROOT, scriptName);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

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

      const cmd = `node ${scriptName} ${args.map(quoteArg).join(" ")}`.trim();
      send("start", cmd);

      // CLI-script kräver lokal leads.db + root node_modules — funkar inte på Vercel
      if (IS_VERCEL) {
        send(
          "stderr",
          [
            "⚠ Den här funktionen körs bara lokalt.",
            "",
            "CLI-scriptet behöver din lokala leads.db + SerpAPI-kvot + Node-deps som inte deployas till Vercel.",
            "Kopiera kommandot nedan och kör i terminalen (cd till leadsgoogle-repot först):",
            "",
            `  ${cmd}`,
            "",
            "Nya leads pushas automatiskt till Turso efter pipelinen klar (pipeline.js kör sync sist).",
          ].join("\n")
        );
        send("exit", "1");
        closeOnce();
        return;
      }

      const child = spawn("node", [scriptPath, ...args], {
        cwd: PROJECT_ROOT,
        env: { ...process.env, FORCE_COLOR: "0" },
      });

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
