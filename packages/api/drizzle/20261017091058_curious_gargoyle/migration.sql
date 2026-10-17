ALTER TABLE `accounts` ADD `number` text NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_accounts` (
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
INSERT INTO `__new_accounts`(`id`, `name`, `currency`, `balance_amount`, `ledger_amount`, `balance_currency`, `balance_at`, `balance_source`, `created_at`) SELECT `id`, `name`, `currency`, `balance_amount`, `ledger_amount`, `balance_currency`, `balance_at`, `balance_source`, `created_at` FROM `accounts`;--> statement-breakpoint
DROP TABLE `accounts`;--> statement-breakpoint
ALTER TABLE `__new_accounts` RENAME TO `accounts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;