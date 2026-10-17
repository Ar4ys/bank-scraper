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

| Task                        | What it does                                                       |
| --------------------------- | ------------------------------------------------------------------ |
| `mise run start-server`     | Starts the API on `127.0.0.1:8585`                                 |
| `mise run watch-server`     | Same, restarting on file changes                                   |
| `mise run test`             | Runs the tests, each test file against its own temp SQLite file    |
| `mise run typecheck`        | Typechecks all packages                                            |
| `mise run db-generate`      | Generates a migration from `packages/api/src/db/schema.ts`         |
| `mise run db-migrate`       | Applies migrations without starting the server                     |
| `mise run db-push`          | `db-generate` followed by `db-migrate`                             |
| `mise run build-userscript` | Bundles the userscript into `packages/userscript/dist/`, see below |
| `mise run dev-admin`        | Starts the admin app with hot reload                               |
| `mise run build-admin`      | Builds the admin app into `packages/admin/dist`                    |

## Configuration

| Env var             | Default                            | Meaning                                                                  |
| ------------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| `HTTP_HOST`         | `127.0.0.1`                        | Address the HTTP server listens on                                       |
| `HTTP_PORT`         | `8585`                             | Port the HTTP server listens on                                          |
| `SQLITE_DB_PATH`    | `./local/dev.db`                   | Path of the SQLite database file, relative to `packages/api`             |
| `INGEST_API_KEY`    | required                           | Key the userscript has to send to store scraped transactions             |
| `LUNCHFLOW_API_KEY` | required                           | Key Sure has to send to the Lunch Flow API                               |
| `ADMIN_APP_DIR`     | `../admin/dist`                    | Directory of the built admin app, relative to `packages/api`             |
| `APP_GIT_COMMIT`    | `unknown`                          | Git commit of the running build, recorded with every transaction version |
| `USERSCRIPT_PATH`   | `../userscript/dist/userscript.js` | Built userscript to serve, relative to `packages/api`                    |

## Deployment

`Dockerfile` builds one image that serves the API and the admin app on port 8585 and keeps the
database in the `/data` volume. `compose.example.yaml` is a service to put next to Sure.

The admin app and `/api/admin` have no auth of their own. Put the service behind a reverse proxy
that protects everything except the routes that check a key or token of their own: `/api/lunchflow`,
`/api/transactions/raw`, `/api/accounts/` and `/api/userscript/`. The proxy should set
`X-Forwarded-Proto` and `X-Forwarded-Host`, which give the userscript its server URL.

The image build fails when the userscript changed but its version was not bumped, see "Versions"
under "Userscript".

### Sure

Enter `http://<host>:8585/api/lunchflow` as the base URL and the `LUNCHFLOW_API_KEY` as the API key
of a Lunch Flow connection in Sure.

This needs a Sure build with two changes, which my fork ([Ar4ys/sure](https://github.com/Ar4ys/sure))
has. Upstream Sure does neither:

- It talks only to `https://lunchflow.app/api/v1`, whatever base URL is entered. The fork uses the
  entered URL (`effective_base_url` in `app/models/lunchflow_item.rb`).
- It fetches only about the last week on each sync, the first one included. The fork fetches the
  whole history on every sync from a connection with a custom base URL
  (`determine_sync_start_date` in `app/models/lunchflow_item/importer.rb`), so older transactions
  arrive, and so does a rule or merchant change that rewrites them.

A transaction that was edited in Sure is not updated by later syncs.

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

It runs in [FireMonkey](https://erosman.github.io/firemonkey/) (it needs `GM.fetch`,
`exportFunction`, `GM.info` and `@var` user variables). The server serves it:

1. Press "Install userscript" in the admin app and confirm in the tab FireMonkey opens. The served
   script has this server's URL (as the browser reached it) and its `INGEST_API_KEY` as the defaults
   of its User Variables "Server URL" and "Ingest API key", which can be changed in FireMonkey.
2. FireMonkey keeps the install URL as the update URL and turns on Auto-Update for the script. It
   checks only if "Auto-Update Interval" in its options is set to a number of days, and only while
   Firefox is idle.
3. When the installed version differs from the one the server serves, the panel in iPKO says so
   instead of offering a sync, and how to press Update in FireMonkey.

FireMonkey takes the defaults of User Variables only on the first install; updates keep the values
it stored. The install URL contains a token derived from `INGEST_API_KEY`, because FireMonkey
fetches updates without any key. After the key changed, remove the script in FireMonkey and install
it again from the admin app: reinstalling over it would keep the old update URL and key.

### Versions

`mise run build-userscript` hashes the bundle and compares it with `versionHash` in
`packages/userscript/package.json`. When they differ it increments the last number of `version`,
records the new hash and writes the version into `@version`. Commit `package.json` together with the
change. A build whose bundle did not change (a comment, a type) keeps the version. The Docker build
runs the same check with `CHECK_USERSCRIPT_VERSION=1`, which fails instead of bumping.

With the server running, open the transaction history in iPKO: every page of transactions that the
site loads is sent to the server together with its account, and the result is logged to the browser
console. Whenever the site loads the list of accounts, their names and balances are sent too.

### Sync

On the transaction history the userscript shows a floating "Sync" button. It asks the server for the
newest `order_date` stored for the account the history shows, sets iPKO's date filter from 30 days
before that until today, and then presses "Load More" until the button is gone or the table does not
change within 10 seconds. The overlap catches transactions that iPKO lists late. For an account
without stored transactions it asks for the start date.

By default it waits 0.5 s before every press and scrolls to the bottom of the page in one smooth
scroll. With `humanLikeInput` in `packages/userscript/src/input.ts` set to `true`, it instead pauses
like a person would (mostly 0.6-2.5 s, sometimes 3-8 s), scrolls in wheel-sized steps, clicks with
the full sequence of pointer and mouse events, and waits while the tab is hidden. Either way the
events are untrusted (`isTrusted: false`), as every event a script dispatches is.

When it finished, it scrolls to the bottom of the table.

A sync stops with an error when a page could not be stored on the server, when the history switches
to another account or when the page leaves the history. Pressing "Stop" ends it after the current
step.

## API

`POST /api/transactions/raw` stores `{ sourceAccount, transactions: [{ bankId, data }] }` and returns
the rows that were new. It needs the ingest key in the `x-api-key` header.

`GET /api/accounts/:sourceAccount/last-transaction-date` answers `{ orderDate }`: the newest
`order_date` among the stored transactions of the account, holds left out, or `null`. It takes the
same key; the userscript's sync starts from it.

`POST /api/accounts/balances` stores `{ accounts: [{ sourceAccount, name, currency, balance, ledger }] }`
with the same key. `balance` and `ledger` are the bank's two amounts: the money on the account, and
that amount with holds deducted. The name is used only while the account was not renamed.

`GET /api/userscript/version` answers `{ version }` of the userscript the server serves, without a
key. `GET /api/userscript/:token/bank-scraper.user.js` serves the script itself with this server's
URL and key filled in, for any other token it answers 404. The admin app gets the install path from
`GET /api/admin/userscript`.

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
