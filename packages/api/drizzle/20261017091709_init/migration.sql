CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY,
	`number` text NOT NULL UNIQUE,
	`name` text NOT NULL,
	`currency` text,
	`balance_amount` integer,
	`ledger_amount` integer,
	`balance_currency` text,
	`balance_at` text,
	`balance_source` text DEFAULT 'ledger' NOT NULL,
	`created_at` text DEFAULT (datetime('now', 'subsec')) NOT NULL
) STRICT;
--> statement-breakpoint
CREATE TABLE `merchant_names` (
	`key` text PRIMARY KEY,
	`name` text NOT NULL,
	`merchant_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now', 'subsec')) NOT NULL,
	CONSTRAINT `fk_merchant_names_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`)
) STRICT, WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE `merchants` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`deleted_at` text,
	`created_at` text DEFAULT (datetime('now', 'subsec')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now', 'subsec')) NOT NULL
) STRICT, WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE `raw_transactions` (
	`id` text PRIMARY KEY,
	`account_id` integer NOT NULL,
	`bank_id` text NOT NULL,
	`data` blob NOT NULL,
	`hash` text NOT NULL,
	`status` text DEFAULT 'unprocessed' NOT NULL,
	`error` blob,
	`created_at` text DEFAULT (datetime('now', 'subsec')) NOT NULL,
	CONSTRAINT `fk_raw_transactions_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`)
) STRICT, WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE `rule_revisions` (
	`id` text PRIMARY KEY,
	`rules` blob NOT NULL,
	`created_at` text DEFAULT (datetime('now', 'subsec')) NOT NULL
) STRICT, WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`priority` integer NOT NULL,
	`enabled` integer NOT NULL,
	`tx_types` blob,
	`conditions` blob NOT NULL,
	`set` blob NOT NULL,
	`created_at` text DEFAULT (datetime('now', 'subsec')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now', 'subsec')) NOT NULL
) STRICT, WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE `transaction_versions` (
	`id` text PRIMARY KEY,
	`transaction_id` text NOT NULL,
	`raw_transaction_id` text NOT NULL,
	`cause` text NOT NULL,
	`rule_revision_id` text,
	`app_commit` text NOT NULL,
	`data` blob NOT NULL,
	`field_sources` blob NOT NULL,
	`created_at` text DEFAULT (datetime('now', 'subsec')) NOT NULL,
	CONSTRAINT `fk_transaction_versions_transaction_id_transactions_id_fk` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`),
	CONSTRAINT `fk_transaction_versions_raw_transaction_id_raw_transactions_id_fk` FOREIGN KEY (`raw_transaction_id`) REFERENCES `raw_transactions`(`id`),
	CONSTRAINT `fk_transaction_versions_rule_revision_id_rule_revisions_id_fk` FOREIGN KEY (`rule_revision_id`) REFERENCES `rule_revisions`(`id`)
) STRICT, WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY,
	`account_id` integer NOT NULL,
	`bank_id` text NOT NULL,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`merchant` text,
	`merchant_id` text,
	`description` text NOT NULL,
	`is_pending` integer NOT NULL,
	`raw_transaction_id` text,
	`rule_revision_id` text,
	`created_at` text DEFAULT (datetime('now', 'subsec')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now', 'subsec')) NOT NULL,
	CONSTRAINT `fk_transactions_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`),
	CONSTRAINT `fk_transactions_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`),
	CONSTRAINT `fk_transactions_raw_transaction_id_raw_transactions_id_fk` FOREIGN KEY (`raw_transaction_id`) REFERENCES `raw_transactions`(`id`),
	CONSTRAINT `fk_transactions_rule_revision_id_rule_revisions_id_fk` FOREIGN KEY (`rule_revision_id`) REFERENCES `rule_revisions`(`id`)
) STRICT, WITHOUT ROWID;
--> statement-breakpoint
CREATE INDEX `merchant_names_merchant_id_index` ON `merchant_names` (`merchant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `raw_transactions_account_id_bank_id_hash_unique` ON `raw_transactions` (`account_id`,`bank_id`,`hash`);--> statement-breakpoint
CREATE INDEX `transaction_versions_transaction_id_index` ON `transaction_versions` (`transaction_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_account_id_bank_id_unique` ON `transactions` (`account_id`,`bank_id`);--> statement-breakpoint
CREATE INDEX `transactions_account_id_date_index` ON `transactions` (`account_id`,`date`);--> statement-breakpoint
CREATE INDEX `transactions_merchant_id_index` ON `transactions` (`merchant_id`);