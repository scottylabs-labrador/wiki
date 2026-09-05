CREATE TABLE "question_rate" (
	"user_id" text PRIMARY KEY NOT NULL,
	"window_started_at" timestamp NOT NULL,
	"count" integer NOT NULL
);
