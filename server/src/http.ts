/**
 * http.ts — transport layer: `node:http` request dispatch, JSON envelope,
 * and static file serving. Zero runtime dependencies.
 *
 * This module knows nothing about households, plans, or recipes — it owns
 * exactly three concerns:
 *   1. matching a request to a registered `RouteDef` (method + path pattern
 *      with `:param` segments), enforcing the `x-household-id` header
 *      requirement structurally per-route (`requiresHousehold`);
 *   2. reading and parsing a JSON request body with a 1 MiB cap (413) and a
 *      malformed-JSON guard (400), then handing a typed `JsonRouteContext`
 *      to the matched route's handler;
 *   3. serving `web/` statically for every non-`/api/` path, with path
 *      traversal and symlink-escape rejected by RESOLVING and asserting
 *      containment — never by string-matching `..`.
 *
 * The error envelope is ALWAYS `{"error":{"code":"<snake_case>","message":
 * "<sentence>"}}` for `/api/*` routes (FROZEN HTTP CONTRACT v1). A route
 * handler signals an expected error by throwing `HttpError`; anything else
 * thrown is logged to stderr and converted to a 500 whose body never leaks a
 * stack trace or a file path.
 *
 * `routes.ts` owns every business-logic handler and the existence/ownership
 * checks (e.g. "household exists") that need the database; this module only
 * enforces the STRUCTURAL header-presence rule, since that requires no data
 * access.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown by a route handler to produce a specific `/api/*` error response.
 * Any other thrown value becomes an opaque 500 (never leaks detail). */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

function errorBody(code: string, message: string): unknown {
  return { error: { code, message } };
}

// ---------------------------------------------------------------------------
// Route definitions
// ---------------------------------------------------------------------------

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RouteResult {
  readonly status: number;
  readonly body: unknown;
}

export interface JsonRouteContext {
  /** `:name` segments captured from the matched pattern, URL-decoded. */
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  /** Trimmed, non-blank `x-household-id` header value, or null when absent.
   * Guaranteed non-null when `RouteDef.requiresHousehold` is true — the
   * dispatcher rejects the request with 400 before the handler runs. */
  readonly householdId: string | null;
  /** Parsed JSON request body; `undefined` for GET or an empty body. */
  readonly body: unknown;
}

export type RouteHandler = (ctx: JsonRouteContext) => Promise<RouteResult> | RouteResult;

export interface RouteDef {
  readonly method: HttpMethod;
  /** e.g. "/api/plans/:planId/meals/:slot/swap". Literal segments match
   * exactly; a ":name" segment captures anything. */
  readonly pattern: string;
  readonly requiresHousehold: boolean;
  readonly handler: RouteHandler;
}

const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB (FROZEN HTTP CONTRACT v1)

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

function splitSegments(pathname: string): readonly string[] {
  return pathname.split('/').filter((s) => s.length > 0);
}

function matchPattern(pattern: string, pathSegments: readonly string[]): Record<string, string> | null {
  const patternSegments = splitSegments(pattern);
  if (patternSegments.length !== pathSegments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternSegments.length; i += 1) {
    const p = patternSegments[i] as string;
    const s = pathSegments[i] as string;
    if (p.startsWith(':')) {
      params[p.slice(1)] = s;
    } else if (p !== s) {
      return null;
    }
  }
  return params;
}

type FindResult = { readonly route: RouteDef; readonly params: Record<string, string> } | 'method_not_allowed' | null;

function findRoute(routes: readonly RouteDef[], method: string, pathSegments: readonly string[]): FindResult {
  let pathMatched = false;
  for (const route of routes) {
    const params = matchPattern(route.pattern, pathSegments);
    if (params === null) continue;
    pathMatched = true;
    if (route.method === method) return { route, params };
  }
  return pathMatched ? 'method_not_allowed' : null;
}

// ---------------------------------------------------------------------------
// Body reading
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        settled = true;
        reject(new HttpError(413, 'payload_too_large', 'Request body exceeds the 1 MiB limit.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

function parseJsonBody(buf: Buffer): unknown {
  if (buf.length === 0) return undefined;
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON.');
  }
}

// ---------------------------------------------------------------------------
// JSON response helper
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

// ---------------------------------------------------------------------------
// Static file serving — resolve + assert containment, never string-match
// ---------------------------------------------------------------------------

function sendPlainText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function notFoundPlain(res: ServerResponse): void {
  sendPlainText(res, 404, 'Not Found');
}

interface StaticTarget {
  readonly relPath: string;
  readonly contentType: string;
}

function staticTargetFor(pathname: string): StaticTarget | null {
  if (pathname === '/') return { relPath: 'index.html', contentType: 'text/html; charset=utf-8' };
  if (pathname.startsWith('/css/')) {
    return { relPath: `css/${pathname.slice('/css/'.length)}`, contentType: 'text/css; charset=utf-8' };
  }
  if (pathname.startsWith('/js/')) {
    return { relPath: `js/${pathname.slice('/js/'.length)}`, contentType: 'text/javascript' };
  }
  return null;
}

/** True when `child` (already `path.resolve`d) is `root` or strictly inside
 * it. Computed via `path.relative` — never a string prefix check. */
function isContained(root: string, child: string): boolean {
  const rel = path.relative(root, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, webRoot: string, pathname: string): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    sendPlainText(res, 405, 'Method Not Allowed');
    return;
  }
  const target = staticTargetFor(pathname);
  if (target === null) {
    notFoundPlain(res);
    return;
  }
  const resolvedRoot = path.resolve(webRoot);
  const resolvedPath = path.resolve(resolvedRoot, target.relPath);
  if (!isContained(resolvedRoot, resolvedPath) && resolvedPath !== resolvedRoot) {
    notFoundPlain(res);
    return;
  }
  let realRoot: string;
  let realPath: string;
  try {
    realRoot = await fs.realpath(resolvedRoot);
    realPath = await fs.realpath(resolvedPath);
  } catch {
    notFoundPlain(res);
    return;
  }
  // Symlink-escape check: containment must hold AFTER resolving symlinks too.
  if (!isContained(realRoot, realPath)) {
    notFoundPlain(res);
    return;
  }
  try {
    const stat = await fs.stat(realPath);
    if (!stat.isFile()) {
      notFoundPlain(res);
      return;
    }
    const data = await fs.readFile(realPath);
    res.writeHead(200, { 'content-type': target.contentType, 'content-length': data.length });
    res.end(method === 'HEAD' ? undefined : data);
  } catch {
    notFoundPlain(res);
  }
}

// ---------------------------------------------------------------------------
// The dispatcher
// ---------------------------------------------------------------------------

function firstHeaderValue(v: string | readonly string[] | undefined): string | null {
  const raw = Array.isArray(v) ? v[0] : v;
  return typeof raw === 'string' ? raw : null;
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  routes: readonly RouteDef[],
  webRoot: string,
): Promise<void> {
  let pathname: string;
  let url: URL;
  try {
    url = new URL(req.url ?? '/', 'http://internal');
    pathname = decodeURIComponent(url.pathname);
  } catch {
    notFoundPlain(res);
    return;
  }

  if (!pathname.startsWith('/api/')) {
    await serveStatic(req, res, webRoot, pathname);
    return;
  }

  const segments = splitSegments(pathname);
  const method = (req.method ?? 'GET').toUpperCase();
  const found = findRoute(routes, method, segments);
  if (found === null) {
    sendJson(res, 404, errorBody('not_found', 'Unknown API route.'));
    return;
  }
  if (found === 'method_not_allowed') {
    sendJson(res, 405, errorBody('method_not_allowed', `Method ${method} is not supported for this route.`));
    return;
  }
  const { route, params } = found;

  const householdIdRaw = firstHeaderValue(req.headers['x-household-id']);
  const householdId = householdIdRaw !== null && householdIdRaw.trim() !== '' ? householdIdRaw.trim() : null;
  if (route.requiresHousehold && householdId === null) {
    sendJson(res, 400, errorBody('household_required', 'The x-household-id header is required.'));
    return;
  }

  let body: unknown;
  try {
    if (method === 'GET' || method === 'DELETE') {
      body = undefined;
    } else {
      const buf = await readBody(req, MAX_BODY_BYTES);
      body = parseJsonBody(buf);
    }
  } catch (err) {
    if (err instanceof HttpError) {
      sendJson(res, err.status, errorBody(err.code, err.message));
      return;
    }
    sendJson(res, 400, errorBody('invalid_request', 'Could not read the request body.'));
    return;
  }

  const ctx: JsonRouteContext = { params, query: url.searchParams, householdId, body };
  try {
    const result = await route.handler(ctx);
    sendJson(res, result.status, result.body);
  } catch (err) {
    if (err instanceof HttpError) {
      sendJson(res, err.status, errorBody(err.code, err.message));
      return;
    }
    // Never leak a stack trace or a file path in the response body.
    console.error('unhandled route error:', err);
    sendJson(res, 500, errorBody('internal_error', 'An unexpected error occurred.'));
  }
}

/** Build a `node:http` request listener from a route table and a static web
 * root. Every `/api/*` request/response is the JSON envelope; everything
 * else is served from `webRoot` (or 404s). */
export function createRequestListener(
  routes: readonly RouteDef[],
  webRoot: string,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    handle(req, res, routes, webRoot).catch((err: unknown) => {
      console.error('fatal dispatch error:', err);
      if (!res.headersSent) {
        sendJson(res, 500, errorBody('internal_error', 'An unexpected error occurred.'));
      } else {
        res.end();
      }
    });
  };
}
