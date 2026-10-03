# Todo

Deferred work, not part of the current plan.

- **Own Sure provider for this service.** Sure's Lunch Flow importer only re-fetches transactions
  from about 7 days before the last sync, so a rule change that rewrites older transactions never
  reaches Sure. A dedicated provider could fetch by "changed since" and carry more fields than the
  Lunch Flow shape allows.
- **Holds as pending transactions.** Holds (`is_hold: true`) are stored raw and never exposed.
  Exposing them as `isPending` needs a way to retire a hold when the settled operation arrives.
- **Rule editor for the remaining fields.** The rule engine can override any internal field, the
  admin app only exposes merchant, description and date.
