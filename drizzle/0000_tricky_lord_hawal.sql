CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"status" text NOT NULL,
	"model" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"context_hash" text NOT NULL,
	"decision" text,
	"confidence" real,
	"feedback" text,
	"reason" text,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_output" jsonb,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"comment_applied_at" timestamp with time zone,
	"decision_applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checks_status_check" CHECK ("checks"."status" IN ('pending', 'running', 'completed', 'needs_review', 'apply_pending', 'applied', 'failed')),
	CONSTRAINT "checks_decision_check" CHECK ("checks"."decision" IS NULL OR "checks"."decision" IN ('accept', 'reject', 'needs_review'))
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courses_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector(768) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_path" text,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_documents_kind_check" CHECK ("knowledge_documents"."kind" IN ('transcript', 'notes', 'criteria'))
);
--> statement-breakpoint
CREATE TABLE "lesson_dependencies" (
	"lesson_id" uuid NOT NULL,
	"depends_on_lesson_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_dependencies_pk" PRIMARY KEY("lesson_id","depends_on_lesson_id")
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"module_id" uuid,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"order_index" integer NOT NULL,
	"getcourse_lesson_id" text,
	"getcourse_lesson_url" text,
	"summary" text,
	"learning_objectives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"grading_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"common_mistakes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"order_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"external_submission_id" text NOT NULL,
	"external_user_id" text,
	"external_lesson_id" text,
	"lesson_id" uuid,
	"source_url" text NOT NULL,
	"lesson_title" text,
	"assignment_text" text NOT NULL,
	"answer_text" text NOT NULL,
	"has_attachments" boolean NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revision_hash" text NOT NULL,
	"status" text NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submissions_source_check" CHECK ("submissions"."source" = 'getcourse'),
	CONSTRAINT "submissions_status_check" CHECK ("submissions"."status" IN ('pending', 'checking', 'checked', 'needs_review', 'applied', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_dependencies" ADD CONSTRAINT "lesson_dependencies_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_dependencies" ADD CONSTRAINT "lesson_dependencies_depends_on_lesson_id_lessons_id_fk" FOREIGN KEY ("depends_on_lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_chunks_lesson_id_index" ON "knowledge_chunks" USING btree ("lesson_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunks_document_chunk_index_unique" ON "knowledge_chunks" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_embedding_hnsw_index" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_documents_lesson_kind_hash_unique" ON "knowledge_documents" USING btree ("lesson_id","kind","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "lessons_course_slug_unique" ON "lessons" USING btree ("course_id","slug");--> statement-breakpoint
CREATE INDEX "lessons_getcourse_lesson_id_index" ON "lessons" USING btree ("getcourse_lesson_id");--> statement-breakpoint
CREATE INDEX "lessons_getcourse_lesson_url_index" ON "lessons" USING btree ("getcourse_lesson_url");--> statement-breakpoint
CREATE UNIQUE INDEX "modules_course_slug_unique" ON "modules" USING btree ("course_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_source_external_revision_unique" ON "submissions" USING btree ("source","external_submission_id","revision_hash");