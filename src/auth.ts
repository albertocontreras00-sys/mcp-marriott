/**
 * Strider Labs - Marriott Auth/Session Management
 *
 * Handles cookie and Playwright storage-state persistence for Marriott.com.
 * Vercel uses a private Blob store; local stdio runs keep the original file
 * based behavior for development and backwards compatibility.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { get, put, del } from "@vercel/blob";
import type { BrowserContext, Cookie } from "playwright-core";

const CONFIG_DIR = path.join(os.homedir(), ".striderlabs", "marriott");
const COOKIES_FILE = path.join(CONFIG_DIR, "cookies.json");
const STORAGE_STATE_FILE = path.join(CONFIG_DIR, "storage-state.json");
const SESSION_FILE = path.join(CONFIG_DIR, "session.json");

const BLOB_STORAGE_STATE_PATH =
  process.env.MARRIOTT_SESSION_STATE_PATH || "marriott/storage-state.json";
const BLOB_SESSION_PATH =
  process.env.MARRIOTT_SESSION_INFO_PATH || "marriott/session.json";

export interface SessionInfo {
  isLoggedIn: boolean;
  userEmail?: string;
  userName?: string;
  bonvoyNumber?: string;
  bonvoyTier?: string;
  lastUpdated: string;
}

export interface StorageState {
  cookies: Cookie[];
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

function useBlobStorage(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

async function readBlobJson<T>(pathname: string): Promise<T | null> {
  try {
    const result = await get(pathname, { access: "private" });
    if (!result || result.statusCode !== 200) {
      return null;
    }

    return JSON.parse(await new Response(result.stream).text()) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes("not found")) {
      console.error(`Failed to read Marriott session storage: ${message}`);
    }
    return null;
  }
}

async function writeBlobJson(pathname: string, value: unknown): Promise<void> {
  await put(pathname, JSON.stringify(value, null, 2), {
    access: "private",
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/json",
  });
}

/** Save the full Playwright storage state, including cookies and local storage. */
export async function saveStorageState(context: BrowserContext): Promise<void> {
  const storageState = await context.storageState();

  if (useBlobStorage()) {
    await writeBlobJson(BLOB_STORAGE_STATE_PATH, storageState);
    return;
  }

  ensureConfigDir();
  fs.writeFileSync(STORAGE_STATE_FILE, JSON.stringify(storageState, null, 2));
  fs.writeFileSync(COOKIES_FILE, JSON.stringify(storageState.cookies, null, 2));
}

/** Load full Playwright storage state from durable or local storage. */
export async function loadStorageState(): Promise<StorageState | null> {
  if (useBlobStorage()) {
    return await readBlobJson<StorageState>(BLOB_STORAGE_STATE_PATH);
  }

  if (fs.existsSync(STORAGE_STATE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(STORAGE_STATE_FILE, "utf-8")) as StorageState;
    } catch (error) {
      console.error(
        `Failed to load local Marriott storage state: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return null;
}

/**
 * Save cookies from a browser context. Kept as the original public helper,
 * but now saves the complete storage state as well.
 */
export async function saveCookies(context: BrowserContext): Promise<void> {
  await saveStorageState(context);
}

/** Load saved cookies when a full storage state is not available. */
export async function loadCookies(context: BrowserContext): Promise<boolean> {
  const storageState = await loadStorageState();
  if (storageState?.cookies?.length) {
    await context.addCookies(storageState.cookies);
    return true;
  }

  if (useBlobStorage() || !fs.existsSync(COOKIES_FILE)) {
    return false;
  }

  try {
    const cookiesJson = fs.readFileSync(COOKIES_FILE, "utf-8");
    const cookies: Cookie[] = JSON.parse(cookiesJson);
    const now = Date.now() / 1000;
    const validCookies = cookies.filter((cookie) => !cookie.expires || cookie.expires > now);

    if (validCookies.length > 0) {
      await context.addCookies(validCookies);
      return true;
    }
  } catch (error) {
    console.error(
      `Failed to load local Marriott cookies: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  return false;
}

/** Save session info to durable storage. */
export async function saveSessionInfo(info: SessionInfo): Promise<void> {
  if (useBlobStorage()) {
    await writeBlobJson(BLOB_SESSION_PATH, info);
    return;
  }

  ensureConfigDir();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(info, null, 2));
}

/** Load session info from durable storage. */
export async function loadSessionInfo(): Promise<SessionInfo | null> {
  if (useBlobStorage()) {
    return await readBlobJson<SessionInfo>(BLOB_SESSION_PATH);
  }

  if (!fs.existsSync(SESSION_FILE)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8")) as SessionInfo;
  } catch (error) {
    console.error(
      `Failed to load local Marriott session info: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }
}

/** Clear all saved auth data. */
export async function clearAuthData(): Promise<void> {
  if (useBlobStorage()) {
    await Promise.allSettled([del(BLOB_STORAGE_STATE_PATH), del(BLOB_SESSION_PATH)]);
    return;
  }

  for (const file of [COOKIES_FILE, STORAGE_STATE_FILE, SESSION_FILE]) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
}

/**
 * Blob existence is checked lazily by loadStorageState because serverless
 * functions cannot use a synchronous network call here.
 */
export function hasSavedCookies(): boolean {
  return useBlobStorage() || fs.existsSync(COOKIES_FILE) || fs.existsSync(STORAGE_STATE_FILE);
}

/** Get a safe description of the active session storage backend. */
export function getConfigDir(): string {
  return useBlobStorage() ? "Vercel Blob (private Marriott session storage)" : CONFIG_DIR;
}
