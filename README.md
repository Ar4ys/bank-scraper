# bank-scraper

Collects my PKO Bank Polski (iPKO) transactions from the web UI into a local SQLite database.

1. A userscript on `ipko.pl` intercepts the completed operations response and posts every
   transaction to the local server.
2. The server stores each payload as is in `raw_transactions`. A payload that is already stored
   with the same content is skipped. If the content of a known transaction changes, a new row is
   added next to the old one, so the table doubles as a log of shape changes. Accounts are created
   from the account the bank reports for each scraped page.
3. Every new raw transaction is parsed with strict schemas (`packages/api/src/ipkoSchemas.ts`) and
   turned into a row of `transactions`, which has our own id. Each time the fields of a transaction
   change, a row of `transaction_versions` records the new fields and what caused the change: a new
   version of the raw transaction, a new rule revision, or a change of the code. A raw transaction
   that cannot be parsed keeps the error on its row and leaves its transaction untouched. Holds are
   stored but never become transactions.

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

| Env var             | Default          | Meaning                                                                  |
| ------------------- | ---------------- | ------------------------------------------------------------------------ |
| `HTTP_HOST`         | `127.0.0.1`      | Address the HTTP server listens on                                       |
| `HTTP_PORT`         | `8585`           | Port the HTTP server listens on                                          |
| `SQLITE_DB_PATH`    | `./local/dev.db` | Path of the SQLite database file, relative to `packages/api`             |
| `INGEST_API_KEY`    | required         | Key the userscript has to send to store scraped transactions             |
| `LUNCHFLOW_API_KEY` | required         | Key Sure has to send to the Lunch Flow API                               |
| `APP_GIT_COMMIT`    | `unknown`        | Git commit of the running build, recorded with every transaction version |

## Userscript

Build it with `mise run build-userscript` and install `packages/userscript/dist/userscript.js` in a userscript manager
that provides `GM.fetch` and `exportFunction` (it is written against Firemonkey). In the menu of the
userscript manager, use "Set ingest key" to enter the `INGEST_API_KEY` of the server and, unless the
server runs on `http://localhost:8585`, "Set server URL". If the manager enforces `@connect`, add
the host of the server to `packages/userscript/meta.txt` before building.

With the server running, open the transaction history in iPKO: every page of transactions that the
site loads is sent to the server together with its account, and the result is logged to the browser
console.

## API

These routes need the ingest key in the `x-api-key` header.

| Route                           | What it does                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| `GET /api/transactions/raw`     | Lists all raw transactions                                                         |
| `GET /api/transactions/raw/:id` | Returns one raw transaction                                                        |
| `POST /api/transactions/raw`    | Stores `{ sourceAccount, transactions: [{ bankId, data }] }`, returns the new rows |

### Lunch Flow API

`/api/lunchflow` implements the part of the [Lunch Flow Personal API](https://lunchflow.app/docs/api/personal-api-overview)
that [Sure](https://sure.am) uses, so a Sure instance can sync from this service. It needs the
Lunch Flow key in `x-api-key` or as `Authorization: Bearer`.

| Route                                          | What it does                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `GET /api/lunchflow/accounts`                  | Accounts that have at least one processed transaction            |
| `GET /api/lunchflow/accounts/:id/transactions` | Transactions, filtered by `start_date`/`end_date` or `from`/`to` |
| `GET /api/lunchflow/accounts/:id/balance`      | Last scraped balance, 404 until there is one                     |
| `GET /api/lunchflow/accounts/:id/holdings`     | Always 501, which Sure reads as "no holdings"                    |

Requests for [Bruno](https://www.usebruno.com) are in `packages/api/bruno/`.

## Layout

A pnpm workspace:

- `packages/api` server, database schema, migrations (`drizzle/`), iPKO schemas and one-off
  scripts (`tools/`) used to explore the shape of the bank's JSON
- `packages/userscript` the browser side
- `packages/shared` code used by more than one package (codecs for dates and amounts)
- `packages/admin` the admin app (empty for now)
- `plans/todo.md` deferred work
