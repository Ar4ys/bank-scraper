-- Accounts were keyed by an id that iPKO changes between sessions, which duplicated them. They are
-- keyed by the account number from now on: scraped data goes, rules and merchants stay.
DELETE FROM `transaction_versions`;
--> statement-breakpoint
DELETE FROM `transactions`;
--> statement-breakpoint
DELETE FROM `raw_transactions`;
--> statement-breakpoint
DELETE FROM `accounts`;
