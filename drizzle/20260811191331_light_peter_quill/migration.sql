CREATE TABLE "raw_transactions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"bank_id" text NOT NULL,
	"data" json NOT NULL
);
--> statement-breakpoint
CREATE INDEX "raw_transactions_bank_id_index" ON "raw_transactions" ("bank_id");