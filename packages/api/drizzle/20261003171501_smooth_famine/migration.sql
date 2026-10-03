ALTER TABLE `accounts` ADD `ledger_amount` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `balance_source` text DEFAULT 'ledger' NOT NULL;