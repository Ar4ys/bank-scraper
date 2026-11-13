CREATE TABLE `merchant_dismissals` (
	`merchant_id` text NOT NULL,
	`other_merchant_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now', 'subsec')) NOT NULL,
	CONSTRAINT `merchant_dismissals_pk` PRIMARY KEY(`merchant_id`, `other_merchant_id`),
	CONSTRAINT `fk_merchant_dismissals_merchant_id_merchants_id_fk` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_merchant_dismissals_other_merchant_id_merchants_id_fk` FOREIGN KEY (`other_merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE,
	CONSTRAINT "merchant_dismissals_ordered" CHECK("merchant_id" < "other_merchant_id")
) STRICT, WITHOUT ROWID;
--> statement-breakpoint
ALTER TABLE `merchants` ADD `reviewed_at` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `field_sources` blob;