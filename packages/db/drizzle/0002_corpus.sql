CREATE TABLE "chunk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"heading" text,
	"anchor" text,
	"body" text NOT NULL,
	"ordinal" integer NOT NULL,
	"embedding" vector(1536) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"filename" text NOT NULL,
	"public_url" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_ingest" (
	"source_id" text PRIMARY KEY NOT NULL,
	"upstream_sha" text NOT NULL,
	"embedding_model" text NOT NULL,
	"chunker_version" integer NOT NULL,
	"ingested_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chunk" ADD CONSTRAINT "chunk_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunk_pageId_idx" ON "chunk" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "page_sourceId_idx" ON "page" USING btree ("source_id");