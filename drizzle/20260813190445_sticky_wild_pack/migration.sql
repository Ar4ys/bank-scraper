CREATE TABLE `raw_transactions` (
	`id` text PRIMARY KEY,
	`bank_id` text NOT NULL,
	`data` blob NOT NULL,
	`hash` text NOT NULL,
	`processed` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
) STRICT, WITHOUT ROWID;
--> statement-breakpoint
CREATE INDEX `raw_transactions_bank_id_index` ON `raw_transactions` (`bank_id`);