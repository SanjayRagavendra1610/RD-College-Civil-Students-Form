CREATE TABLE "registration_feedback" (
	"id" text PRIMARY KEY,
	"feedback" text DEFAULT '' NOT NULL,
	"attendance_confirmed" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
