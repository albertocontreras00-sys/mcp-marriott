import { randomUUID, timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMarriottServer } from "../src/index.js";
import {
  deleteMcpSession,
  loadMcpSession,
  saveMcpSession,
  type McpSessionRecord,
} from "../src/mcp-session-store.js";

type McpSession = {
  server: ReturnType<typeof createMarriottServer>;
  transport: WebStandardStreamableHTTPServerTransport;
};

// The warm-instance map avoids rehydrating normal requests. The Blob record
// lets the same MCP session survive a later invocation on another instance.
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

async function readBody(req: VercelRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function requestHeaders(req: VercelRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") {
      headers.set(name, value);
    } else if (Array.isArray(value)) {
      headers.set(name, value.join(", "));
    }
  }
  return headers;
}

function requestUrl(req: VercelRequest): string {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const forwardedHost = req.headers["x-forwarded-host"];
  const protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) || "https";
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) || req.headers.host;
  return `${protocol}://${host || "localhost"}${req.url || "/api/mcp"}`;
}

async function toWebRequest(req: VercelRequest): Promise<{
  request: Request;
  body: unknown;
}> {
  const bodyText = req.method === "GET" || req.method === "DELETE" ? "" : await readBody(req);
  let body: unknown = undefined;

  if (bodyText) {
    body = JSON.parse(bodyText);
  }

  const init: RequestInit = {
    method: req.method,
    headers: requestHeaders(req),
  };
  if (bodyText) {
    init.body = bodyText;
  }

  return { request: new Request(requestUrl(req), init), body };
}

async function createSession(sessionId?: string): Promise<McpSession> {
  let session: McpSession | undefined;

  const server = createMarriottServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => sessionId || randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: async (initializedSessionId) => {
      if (session) {
        sessions.set(initializedSessionId, session);
      }
    },
    onsessionclosed: async (closedSessionId) => {
      sessions.delete(closedSessionId);
    },
  });

  session = { server, transport };
  await server.connect(transport);
  return session;
}

async function rehydrateSession(record: McpSessionRecord): Promise<McpSession> {
  const session = await createSession(record.sessionId);
  const initializeRequest = new Request("https://mcp.internal/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "rehydrate",
      method: "initialize",
      params: record.initializeParams,
    }),
  });

  const response = await session.transport.handleRequest(initializeRequest);
  if (!response.ok) {
    throw new Error("Unable to restore the MCP session. Reinitialize the connection.");
  }

  return session;
}

async function writeWebResponse(response: Response, res: VercelResponse): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));

  if (!response.body) {
    res.end();
    return;
  }

  res.end(Buffer.from(await response.arrayBuffer()));
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

  const headerValue = req.headers["mcp-session-id"];
  const sessionId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const { request, body } = await toWebRequest(req);
  let session = sessionId ? sessions.get(sessionId) : undefined;

  if (sessionId && !session) {
    const record = await loadMcpSession(sessionId);
    if (!record) {
      res.status(404).json({
        error: "MCP session not found. Reinitialize the MCP connection.",
      });
      return;
    }
    session = await rehydrateSession(record);
  }

  if (!session) {
    if (req.method !== "POST" || !body || typeof body !== "object" || (body as { method?: string }).method !== "initialize") {
      res.status(400).json({ error: "A new MCP connection must begin with initialize." });
      return;
    }
    session = await createSession();
  }

  const response = await session.transport.handleRequest(request);
  await writeWebResponse(response, res);

  if (!sessionId && body && typeof body === "object" && (body as { method?: string }).method === "initialize") {
    const initializedSessionId = session.transport.sessionId;
    if (initializedSessionId) {
      await saveMcpSession({
        sessionId: initializedSessionId,
        initializeParams: (body as { params?: unknown }).params,
        createdAt: new Date().toISOString(),
      });
    }
  }

  if (req.method === "DELETE" && sessionId) {
    sessions.delete(sessionId);
    await deleteMcpSession(sessionId);
    await session.server.close().catch(() => {});
  }
}
