ALTER TABLE "checks" ADD COLUMN "score" integer;--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "passed" boolean;--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "strengths" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "weaknesses" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "prompt_version" text;--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "latency_ms" integer;--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "usage_metadata" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "checks_submission_id_unique" ON "checks" USING btree ("submission_id");