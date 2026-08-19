/**
 * main.ts — the server entrypoint: `--port` / `--db` flags, catalog +
 * registry loading (graceful degradation per Invariant 5 — an ineligible
 * recipe is excluded and logged, never a crash), and clean shutdown.
 *
 * Dual-purpose module (standard Node pattern): `startServer` does the real
 * work and is directly importable by tests (`tests/routes.test.ts` drives
 * the actual entrypoint, not a parallel test-only bootstrap); the bottom of
 * the file only runs `startServer` + wires signal handlers when this file is
 * executed directly (`node server/src/main.ts ...` / `npm start`).
 *
 * `--port <n>` defaults to 0 (ephemeral) — the frozen contract states this
 * is deliberate, the stated mitigation for kill-test flake, and applies
 * whether or not `npm start` overrides it with an explicit port.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { openDb, type DinnerDb } from './db.ts';
import { createApp } from './routes.ts';
import { gateCatalog, parseIngredientRegistry } from '../../domain/src/catalog.ts';
import type { IngredientRegistry } from '../../domain/src/catalog.ts';
import type { Recipe } from '../../domain/src/recipe.ts';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

export interface CliArgs {
  readonly port: number;
  readonly dbPath: string | null;
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  let port = 0;
  let dbPath: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port') {
      const value = argv[i + 1];
      i += 1;
      const n = value === undefined ? NaN : Number.parseInt(value, 10);
      if (!Number.isInteger(n) || n < 0 || String(n) !== (value ?? '').trim()) {
        throw new Error(`--port must be a non-negative integer, got ${JSON.stringify(value)}`);
      }
      port = n;
    } else if (arg === '--db') {
      const value = argv[i + 1];
      i += 1;
      if (value === undefined || value.trim() === '') throw new Error('--db requires a non-empty path');
      dbPath = value;
    }
  }
  return { port, dbPath };
}

// ---------------------------------------------------------------------------
// Catalog + registry loading
// ---------------------------------------------------------------------------

export function repoRootDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export interface LoadedCatalog {
  readonly catalog: readonly Recipe[];
  readonly registry: IngredientRegistry;
}

/** Load the curated registry and every recipe under data/recipes, running
 * the catalog gate (Invariant 5). An ineligible recipe is excluded and
 * logged to stderr — graceful degradation, never a crash (DESIGN.md: "a
 * short catalog is a graceful degradation and a broken one is not"). */
export function loadCatalogAndRegistry(repoRoot: string): LoadedCatalog {
  const registryData: unknown = JSON.parse(readFileSync(join(repoRoot, 'data', 'ingredients.json'), 'utf8'));
  const registry = parseIngredientRegistry(registryData);

  const recipesDir = join(repoRoot, 'data', 'recipes');
  const rawRecipes: unknown[] = readdirSync(recipesDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(recipesDir, f), 'utf8')) as unknown);

  const gated = gateCatalog(rawRecipes, registry);
  for (const report of gated.reports) {
    if (!report.eligible) {
      const detail = report.issues.map((i) => `${i.code} at ${i.path}: ${i.message}`).join('; ');
      console.error(`catalog: excluding recipe ${report.recipe_id ?? '(unknown id)'}: ${detail}`);
    }
  }
  return { catalog: gated.eligible, registry };
}

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

export interface StartedServer {
  readonly server: Server;
  readonly db: DinnerDb;
  readonly port: number;
}

/** Start the HTTP server per `argv` (same flags as the CLI). Resolves once
 * bound and listening, with the ACTUAL bound port printed on a single
 * machine-parseable line. Directly importable by tests. */
export async function startServer(argv: readonly string[]): Promise<StartedServer> {
  const { port, dbPath } = parseCliArgs(argv);
  const repoRoot = repoRootDir();
  const resolvedDbPath =
    dbPath ??
    (() => {
      const dir = join(repoRoot, 'tmp');
      mkdirSync(dir, { recursive: true });
      return join(dir, 'dinner.db');
    })();

  const { catalog, registry } = loadCatalogAndRegistry(repoRoot);
  const db = openDb(resolvedDbPath);
  const app = createApp({ db, catalog, registry, webRoot: join(repoRoot, 'web') });
  const server = createServer(app);

  return new Promise((resolve, reject) => {
    server.once('error', (err: Error) => {
      db.close();
      reject(err);
    });
    // Bind loopback only, never 0.0.0.0.
    server.listen(port, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      // eslint-disable-next-line no-console
      console.log(`listening on http://127.0.0.1:${String(address.port)}`);
      resolve({ server, db, port: address.port });
    });
  });
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
  startServer(process.argv.slice(2))
    .then((started) => {
      let shuttingDown = false;
      const shutdown = (): void => {
        if (shuttingDown) return;
        shuttingDown = true;
        started.server.close(() => {
          started.db.close();
          process.exit(0);
        });
      };
      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
    })
    .catch((err: unknown) => {
      console.error('failed to start server:', err);
      process.exit(1);
    });
}
