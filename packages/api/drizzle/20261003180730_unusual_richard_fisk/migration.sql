ALTER TABLE `transactions` ADD `raw_transaction_id` text REFERENCES raw_transactions(id);--> statement-breakpoint
ALTER TABLE `transactions` ADD `rule_revision_id` text REFERENCES rule_revisions(id);