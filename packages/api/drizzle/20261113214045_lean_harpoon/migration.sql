CREATE TABLE `ignored_places` (
	`key` text PRIMARY KEY,
	`forever` integer NOT NULL,
	`ignored_on` text NOT NULL,
	`created_at` text DEFAULT (datetime('now', 'subsec')) NOT NULL
) STRICT, WITHOUT ROWID;
