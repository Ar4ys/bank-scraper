# bank-scraper

Collects the owner's PKO Bank Polski (iPKO) transactions into a local SQLite database: a userscript
on `ipko.pl` posts what the site loads to a Hono API, which stores it raw, derives transactions
from it and serves them to an admin app and to Sure through a Lunch Flow compatible API.

`README.md` is the reference for the data flow, tasks, env vars, routes and deployment. Read it
before changing behaviour.

## Rules for working here

### Never read the personal data

`packages/api/local/dev.db` holds the owner's real bank data, and it must not be sent to Anthropic's
servers. Nothing in it is to be read: transactions, accounts, balances, merchants, rules.

- No selecting rows from the dev DB, no calling the running API for its data, no opening admin app
  pages that display it (in a browser or with curl).
- `local/` and `packages/api/local/` are off-limits as a whole, `local/examples/` included.
- Schema, table names and migrations are fine, they are in the repo.
- For example transactions use `packages/api/src/fixtures/ipkoTransactions.json`: one sample per
  transaction shape plus a hold, with the identifying details replaced by made-up ones.
- To check API or admin work against a running server, start it on a temp SQLite file with
  synthetic data (`SQLITE_DB_PATH=<temp file>`, the server migrates it on start), or ask the owner
  to look at the screen themselves.

### Git

- Commit finished, verified work without asking first.
- Commits stay local. Do not push anything, feature and worktree branches included: pushed work
  branches are noise in the remote repo. Push only when told to.
- Ask before amending or rewriting existing history.
- Commit messages: an imperative sentence as the subject, no type prefix
  (`Keep the rows of a table while it loads again`), then a body wrapped at 72 columns that says
  what changed for the user of the app and why.

### Browser automation

The owner's browser is Chromium, with the Claude extension in it.

- Never quit it (`pkill`, `osascript ... quit`, closing its last window): the extension logs out
  whenever the browser closes. Closing tabs you opened is fine.
- If the browser tools answer "Browser extension is not connected" while Chromium is running, the
  extension has most likely logged out. Do not keep retrying, ask the owner to sign in to it again.

## Commands

Tools and tasks are managed with mise (`mise install && pnpm install`). `mise.toml` puts
`node_modules/.bin` on the path.

| Command                                  | What it does                                              |
| ---------------------------------------- | --------------------------------------------------------- |
| `mise run test`                          | All tests (`node --test`)                                 |
| `node --test packages/api/src/x.test.ts` | One test file                                             |
| `mise run typecheck`                     | `tsc -b`, then `svelte-check` for the admin app           |
| `oxlint`                                 | Lint, type aware, fails on any warning                    |
| `oxfmt`                                  | Format in place (`oxfmt --check` to only check)           |
| `mise run db-generate`                   | Generate a migration from `packages/api/src/db/schema.ts` |
| `mise run watch-server`                  | API on `127.0.0.1:8585`, restarting on changes            |
| `mise run dev-admin`                     | Admin app with hot reload, proxies `/api` to port 8585    |

The server needs `INGEST_API_KEY` and `LUNCHFLOW_API_KEY` in the environment to start.

## Layout

A pnpm workspace, `@bank-scraper/*`:

- `packages/api` Hono server on `node:sqlite` through Drizzle. `src/ingest.ts` stores raw payloads,
  `src/ipkoSchemas.ts` holds the strict zod schemas of the bank's JSON, `src/processing/` derives
  transactions (defaults, rules, versions), `src/admin*.ts` is the admin JSON API, `src/lunchflow.ts`
  the API for Sure. Migrations are in `drizzle/`, one-off scripts in `tools/`.
- `packages/shared` code used by more than one package: codecs for dates and amounts, rule and
  transaction schemas, the template renderer, the JSON diff.
- `packages/admin` Svelte 5 app with Tailwind 4, shadcn-svelte (`src/lib/components/ui/`) and
  sv-router. It imports the types of the admin API from `@bank-scraper/api/admin`.
- `packages/userscript` the Firemonkey userscript, bundled with tsdown.

## Conventions

- Node runs the TypeScript sources directly, there is no build step for the API. Relative imports
  carry the `.ts` extension.
- Tests are `*.test.ts` next to the code, on `node:test`. A test that touches the database calls
  `createTestDb()` from `packages/api/src/db/testDb.ts` first and imports everything that depends
  on `db.ts` or `config.ts` dynamically afterwards, because those read the environment on import.
- Create migrations only with `mise run db-generate`. It runs `tools/patchMigrations.ts` after
  drizzle-kit, which makes every table `STRICT` and, unless it has an `integer PRIMARY KEY`,
  `WITHOUT ROWID`.
- Formatting is oxfmt's: tabs, 100 columns, sorted imports.
