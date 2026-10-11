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
ALTER TABLE `transactions` ADD `merchant_id` text REFERENCES merchants(id);--> statement-breakpoint
CREATE INDEX `merchant_names_merchant_id_index` ON `merchant_names` (`merchant_id`);--> statement-breakpoint
CREATE INDEX `transactions_merchant_id_index` ON `transactions` (`merchant_id`);