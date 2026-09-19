import { del, get, put } from "@vercel/blob";

export interface McpSessionRecord {
  sessionId: string;
  initializeParams: unknown;
  createdAt: string;
}

const SESSION_PREFIX = "marriott/mcp-sessions/";

function sessionPath(sessionId: string): string {
  return `${SESSION_PREFIX}${encodeURIComponent(sessionId)}.json`;
}

export async function saveMcpSession(record: McpSessionRecord): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return;
  }

  await put(sessionPath(record.sessionId), JSON.stringify(record), {
    access: "private",
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/json",
  });
}

export async function loadMcpSession(sessionId: string): Promise<McpSessionRecord | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return null;
  }

  try {
    const result = await get(sessionPath(sessionId), { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) {
      return null;
    }

    return JSON.parse(await new Response(result.stream).text()) as McpSessionRecord;
  } catch {
    return null;
  }
}

export async function deleteMcpSession(sessionId: string): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return;
  }

  await Promise.allSettled([del(sessionPath(sessionId))]);
}
