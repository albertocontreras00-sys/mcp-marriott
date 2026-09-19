import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMarriottServer } from "../src/index.js";

type McpSession = {
  server: ReturnType<typeof createMarriottServer>;
  transport: StreamableHTTPServerTransport;
};

// MCP protocol sessions are kept in the warm Vercel function instance. The
// Marriott browser session itself is durable in Vercel Blob and is reloaded on
// cold starts, so a client can reinitialize if a request lands on a new one.
const sessions = new Map<string, McpSession>();

export const config = {
  api: {
    bodyParser: false,
  },
};

function isAuthorized(req: VercelRequest): boolean {
  const configuredToken = process.env.MCP_AUTH_TOKEN;
  const authorization = req.headers.authorization;

  if (!configuredToken || typeof authorization !== "string") {
    return false;
  }

  const [scheme, suppliedToken] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !suppliedToken) {
    return false;
  }

  const expected = Buffer.from(configuredToken);
  const supplied = Buffer.from(suppliedToken);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function unauthorized(res: VercelResponse): void {
  res.setHeader("WWW-Authenticate", 'Bearer realm="marriott-mcp"');
  res.status(401).json({ error: "Unauthorized" });
}

function methodNotAllowed(res: VercelResponse): void {
  res.setHeader("Allow", "GET, POST, DELETE");
  res.status(405).json({ error: "Method not allowed" });
}

async function createSession(): Promise<McpSession> {
  let session: McpSession | undefined;

  const server = createMarriottServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: async (sessionId) => {
      if (session) {
        sessions.set(sessionId, session);
      }
    },
    onsessionclosed: async (sessionId) => {
      sessions.delete(sessionId);
    },
  });

  session = { server, transport };
  await server.connect(transport);
  return session;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!isAuthorized(req)) {
    unauthorized(res);
    return;
  }

  if (req.method !== "GET" && req.method !== "POST" && req.method !== "DELETE") {
    methodNotAllowed(res);
    return;
  }

  const sessionHeader = req.headers["mcp-session-id"];
  const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
  let session = sessionId ? sessions.get(sessionId) : undefined;

  if (sessionId && !session) {
    res.status(404).json({
      error: "MCP session not found. Reinitialize the MCP connection.",
    });
    return;
  }

  if (!session) {
    if (req.method !== "POST") {
      res.status(400).json({ error: "A session is required for this method." });
      return;
    }

    session = await createSession();
  }

  await session.transport.handleRequest(
    req as IncomingMessage,
    res as ServerResponse,
  );
}
