import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server, type Socket } from "node:net";
import { once } from "node:events";

export type TestServer = { baseUrl: string; port: number; stop: () => Promise<void> };

async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

export async function startServer(
  env: Record<string, string> | ((port: number) => Record<string, string>) = {},
): Promise<TestServer> {
  const port = await freePort();
  const resolved = typeof env === "function" ? env(port) : env;
  const child: ChildProcess = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", String(port), "-H", "127.0.0.1"],
    {
      cwd: process.cwd(),
      env: { ...process.env, ...resolved, PORT: String(port) },
      stdio: "ignore",
    },
  );

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error("the application under test did not start");
    }
    try {
      const response = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) break;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  return {
    baseUrl,
    port,
    stop: async () => {
      child.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (!child.killed) child.kill("SIGKILL");
    },
  };
}

/**
 * A real listener that records every connection it receives. A forbidden
 * destination is proved untouched by this counter staying at zero, not by reading
 * the checker's own report.
 */
export type Honeypot = { port: number; connections: number; stop: () => Promise<void> };

export async function startHoneypot(): Promise<Honeypot> {
  const state = { connections: 0 };
  const server: Server = createServer((socket: Socket) => {
    state.connections += 1;
    socket.destroy();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    port,
    get connections() {
      return state.connections;
    },
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  } as Honeypot;
}
