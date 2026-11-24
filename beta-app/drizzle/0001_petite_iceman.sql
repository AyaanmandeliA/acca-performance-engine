CREATE TABLE `diagnostic_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`reviewer_id` text NOT NULL,
	`packet_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_diagnostic_exports_attempt_created` ON `diagnostic_exports` (`attempt_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `diagnostic_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`reviewer_id` text NOT NULL,
	`diagnostic_hash` text NOT NULL,
	`pipeline_version` text NOT NULL,
	`pipeline_result_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `diagnostic_imports_attempt_id_unique` ON `diagnostic_imports` (`attempt_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diagnostic_imports_diagnostic_hash_unique` ON `diagnostic_imports` (`diagnostic_hash`);--> statement-breakpoint
CREATE TABLE `submission_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`user_id` text NOT NULL,
	`privacy_notice_version` text NOT NULL,
	`experimental_ai_analysis` integer NOT NULL,
	`human_review` integer NOT NULL,
	`consented_at` text NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submission_consents_attempt_id_unique` ON `submission_consents` (`attempt_id`);--> statement-breakpoint
ALTER TABLE `question_inputs` ADD `marking_context_text` text;