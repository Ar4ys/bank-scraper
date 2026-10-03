# bank-scraper

Collects my PKO Bank Polski (iPKO) transactions from the web UI into a local SQLite database.

1. A userscript on `ipko.pl` intercepts the completed operations response and posts every
   transaction to the local server.
2. The server stores each payload as is in `raw_transactions`. A payload that is already stored
   with the same content is skipped. If the content of a known transaction changes, a new row is
   added next to the old one, so the table doubles as a log of shape changes.
3. Raw transactions are then parsed with strict schemas (`packages/api/src/ipkoSchemas.ts`) into the
   `transactions` table. This step is still in progress.

## Setup

Tool versions and tasks are managed with [mise](https://mise.jdx.dev).

```sh
mise install
pnpm install
mkdir packages/api/local   # holds the SQLite database, ignored by git
mise run db-migrate
```

## Tasks

| Task                        | What it does                                                    |
| --------------------------- | --------------------------------------------------------------- |
| `mise run start-server`     | Starts the API on `127.0.0.1:8585`                              |
| `mise run watch-server`     | Same, restarting on file changes                                |
| `mise run test`             | Runs the tests, each test file against its own temp SQLite file |
| `mise run typecheck`        | Typechecks all packages                                         |
| `mise run db-generate`      | Generates a migration from `packages/api/src/db/schema.ts`      |
| `mise run db-migrate`       | Applies migrations to the database                              |
| `mise run db-push`          | `db-generate` followed by `db-migrate`                          |
| `mise run build-userscript` | Bundles the userscript into `packages/userscript/dist/`         |

## Configuration

| Env var          | Default          | Meaning                                                      |
| ---------------- | ---------------- | ------------------------------------------------------------ |
| `HTTP_HOST`      | `127.0.0.1`      | Address the HTTP server listens on                           |
| `HTTP_PORT`      | `8585`           | Port the HTTP server listens on                              |
| `SQLITE_DB_PATH` | `./local/dev.db` | Path of the SQLite database file, relative to `packages/api` |

## Userscript

Build it with `mise run build-userscript` and install `packages/userscript/dist/userscript.js` in a userscript manager
that provides `GM.fetch` and `exportFunction` (it is written against Firemonkey). With the server
running, open the transaction history in iPKO: every page of transactions that the site loads is
sent to the server, and the result is logged to the browser console.

## API

| Route                           | What it does                                               |
| ------------------------------- | ---------------------------------------------------------- |
| `GET /api/transactions/raw`     | Lists all raw transactions                                 |
| `GET /api/transactions/raw/:id` | Returns one raw transaction                                |
| `POST /api/transactions/raw`    | Stores a batch of `{ bankId, data }`, returns the new rows |

Requests for [Bruno](https://www.usebruno.com) are in `packages/api/bruno/`.

## Layout

A pnpm workspace:

- `packages/api` server, database schema, migrations (`drizzle/`), iPKO schemas and one-off
  scripts (`tools/`) used to explore the shape of the bank's JSON
- `packages/userscript` the browser side
- `packages/shared` code used by more than one package (codecs for dates and amounts)
- `packages/admin` the admin app (empty for now)
- `plans/todo.md` deferred work
