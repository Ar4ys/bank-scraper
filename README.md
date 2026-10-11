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
4. The merchant that defaults and rules derive is only a name. It is looked up, ignoring case, among
   the merchants of the admin app's Merchants page, and the transaction gets that merchant. A name
   that is not known yet becomes a new merchant. Merchants can be renamed, merged, deleted and
   restored there: merging one into another makes its names stand for the merchant that is left,
   for later transactions too, and a deleted merchant leaves its transactions without a merchant.
   Every such change derives all transactions again and is recorded in their versions.

## Setup

Tool versions and tasks are managed with [mise](https://mise.jdx.dev).

```sh
mise install
pnpm install
mkdir packages/api/local   # holds the SQLite database, ignored by git
```

The server applies pending migrations when it starts.

## Tasks

| Task                        | What it does                                                    |
| --------------------------- | --------------------------------------------------------------- |
| `mise run start-server`     | Starts the API on `127.0.0.1:8585`                              |
| `mise run watch-server`     | Same, restarting on file changes                                |
| `mise run test`             | Runs the tests, each test file against its own temp SQLite file |
| `mise run typecheck`        | Typechecks all packages                                         |
| `mise run db-generate`      | Generates a migration from `packages/api/src/db/schema.ts`      |
| `mise run db-migrate`       | Applies migrations without starting the server                  |
| `mise run db-push`          | `db-generate` followed by `db-migrate`                          |
| `mise run build-userscript` | Bundles the userscript into `packages/userscript/dist/`         |
| `mise run dev-admin`        | Starts the admin app with hot reload                            |
| `mise run build-admin`      | Builds the admin app into `packages/admin/dist`                 |

## Configuration

| Env var             | Default          | Meaning                                                                  |
| ------------------- | ---------------- | ------------------------------------------------------------------------ |
| `HTTP_HOST`         | `127.0.0.1`      | Address the HTTP server listens on                                       |
| `HTTP_PORT`         | `8585`           | Port the HTTP server listens on                                          |
| `SQLITE_DB_PATH`    | `./local/dev.db` | Path of the SQLite database file, relative to `packages/api`             |
| `INGEST_API_KEY`    | required         | Key the userscript has to send to store scraped transactions             |
| `LUNCHFLOW_API_KEY` | required         | Key Sure has to send to the Lunch Flow API                               |
| `ADMIN_APP_DIR`     | `../admin/dist`  | Directory of the built admin app, relative to `packages/api`             |
| `APP_GIT_COMMIT`    | `unknown`        | Git commit of the running build, recorded with every transaction version |

## Deployment

`Dockerfile` builds one image that serves the API and the admin app on port 8585 and keeps the
database in the `/data` volume. `compose.example.yaml` is a service to put next to Sure.

The admin app and `/api/admin` have no auth of their own. Put the service behind a reverse proxy
that protects everything except `/api/lunchflow` and `/api/transactions/raw`, which check their keys.

### Sure

Sure's Lunch Flow provider only talks to `https://lunchflow.app/api/v1`: `effective_base_url` in
`app/models/lunchflow_item.rb` falls back to it for any other URL. To sync from this service, patch
that method in your Sure build so it returns your base URL, `http://<host>:8585/api/lunchflow`, and
enter the `LUNCHFLOW_API_KEY` as the Lunch Flow API key in Sure.

Sure re-fetches only the transactions of about the last week on each sync, so a rule or merchant
change that rewrites older transactions does not reach Sure (see `plans/todo.md`).

### Backup

The volume holds the only copy of the data, including the rules and the history of every
transaction. This writes a consistent copy while the server runs:

```sh
docker compose exec bank-scraper node tools/backup.ts /data/backup.db
```

After a restore, transactions that were scraped after the backup come back by scrolling through the
history in iPKO again; scraping the same transaction twice is harmless.

## Admin app

`packages/admin` is a Svelte app for looking into the data: which raw transaction became which
transaction, the history of a transaction with what caused each change, and the changes between
the versions of a raw transaction. Everything that reprocesses shows a preview first.

- `mise run dev-admin` starts the Vite dev server, which proxies `/api` to the API on port 8585.
- `mise run build-admin` builds it into `packages/admin/dist`, which the API serves at `/`.

### Rules

The code derives merchant, description and date of a transaction from the bank's data. Rules, edited
on the Rules page, override that without a deploy, e.g. to name the merchant when the bank only puts
`BOLT.EU/P/2312261215` into the address of a card payment.

- A rule has conditions on fields of the parsed bank transaction (`contains`, `equals` and `regex`,
  all ignoring case) and templates for the fields it sets. A template can use `{details.address}`
  style placeholders for those fields and `{match.1}` for a capture group of the rule's first regex
  condition. A placeholder that points at nothing renders as empty text.
- Rules read the transaction as our schemas parse it, with its `$type` and with dates and amounts
  as text (`2026-08-17`, `-12.34`). A field of the bank's JSON that the schemas do not list is not
  visible to rules. The editor lists the available fields per transaction type.
- For every field, the first enabled rule from the top that matches and sets that field wins.
- Edits are a draft until they are applied. Applying shows which transactions would change, refuses
  rules that produce a value a field cannot hold, stores the rules as a new revision and reprocesses
  every transaction, recording the rule revision as the cause in its history.
- Rules live only in the database. Export them to a JSON file from the Rules page to keep a copy.

It needs a browser that has `Temporal`.

## Userscript

Build it with `mise run build-userscript` and install `packages/userscript/dist/userscript.js` in a userscript manager
that provides `GM.fetch`, `exportFunction` and `@var` user variables (it is written against
Firemonkey). In the options of Firemonkey, open the script and fill in its User Variables: "Ingest
API key" with the `INGEST_API_KEY` of the server and, unless the server runs on
`http://localhost:8585`, "Server URL".

With the server running, open the transaction history in iPKO: every page of transactions that the
site loads is sent to the server together with its account, and the result is logged to the browser
console. Whenever the site loads the list of accounts, their names and balances are sent too.

## API

`POST /api/transactions/raw` stores `{ sourceAccount, transactions: [{ bankId, data }] }` and returns
the rows that were new. It needs the ingest key in the `x-api-key` header.

`POST /api/accounts/balances` stores `{ accounts: [{ sourceAccount, name, currency, balance, ledger }] }`
with the same key. `balance` and `ledger` are the bank's two amounts: the money on the account, and
that amount with holds deducted. The name is used only while the account was not renamed.

`/api/admin` is the JSON API of the admin app. It has no auth of its own, so the reverse proxy in
front of the service has to protect it together with the admin app.

### Lunch Flow API

`/api/lunchflow` implements the part of the [Lunch Flow Personal API](https://lunchflow.app/docs/api/personal-api-overview)
that [Sure](https://sure.am) uses, so a Sure instance can sync from this service. It needs the
Lunch Flow key in `x-api-key` or as `Authorization: Bearer`.

| Route                                          | What it does                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `GET /api/lunchflow/accounts`                  | Accounts that have at least one processed transaction            |
| `GET /api/lunchflow/accounts/:id/transactions` | Transactions, filtered by `start_date`/`end_date` or `from`/`to` |
| `GET /api/lunchflow/accounts/:id/balance`      | Scraped ledger or balance, as set per account; 404 until scraped |
| `GET /api/lunchflow/accounts/:id/holdings`     | Always 501, which Sure reads as "no holdings"                    |

Requests for [Bruno](https://www.usebruno.com) are in `packages/api/bruno/`.

## Layout

A pnpm workspace:

- `packages/api` server, database schema, migrations (`drizzle/`), iPKO schemas and one-off
  scripts (`tools/`) used to explore the shape of the bank's JSON
- `packages/userscript` the browser side
- `packages/shared` code used by more than one package: codecs for dates and amounts, rule and
  transaction schemas, the template renderer and the JSON diff
- `packages/admin` the admin app
- `plans/todo.md` deferred work
