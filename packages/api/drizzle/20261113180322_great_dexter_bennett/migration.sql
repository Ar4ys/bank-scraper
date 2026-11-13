CREATE TABLE `merchant_map_entries` (
	`id` text PRIMARY KEY,
	`field` text NOT NULL,
	`text` text NOT NULL,
	`match_key` text NOT NULL,
	`merchant` text NOT NULL,
	`created_at` text DEFAULT (datetime('now', 'subsec')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now', 'subsec')) NOT NULL
) STRICT, WITHOUT ROWID;
--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_map_entries_field_match_key_unique` ON `merchant_map_entries` (`field`,`match_key`);