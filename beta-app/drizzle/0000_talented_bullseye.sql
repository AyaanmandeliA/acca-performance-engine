CREATE TABLE `answer_inputs` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`answer_text` text NOT NULL,
	`source_type` text DEFAULT 'PASTED_TEXT' NOT NULL,
	`retention_until` text,
	`deletion_requested_at` text,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `answer_inputs_attempt_id_unique` ON `answer_inputs` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`paper` text NOT NULL,
	`question_label` text NOT NULL,
	`provider` text NOT NULL,
	`fixture` integer DEFAULT true NOT NULL,
	`analysis_status` text DEFAULT 'COMPLETED' NOT NULL,
	`review_status` text DEFAULT 'PENDING' NOT NULL,
	`release_status` text DEFAULT 'HELD' NOT NULL,
	`diagnostic_confidence` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_attempts_user_created` ON `attempts` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_attempts_review_status` ON `attempts` (`review_status`);--> statement-breakpoint
CREATE TABLE `diagnostic_results` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`contract_version` text NOT NULL,
	`student_payload_json` text NOT NULL,
	`raw_diagnostic_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `diagnostic_results_attempt_id_unique` ON `diagnostic_results` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`user_id` text NOT NULL,
	`usefulness` text NOT NULL,
	`accurate_text` text DEFAULT '' NOT NULL,
	`confusing_text` text DEFAULT '' NOT NULL,
	`next_wish_text` text DEFAULT '' NOT NULL,
	`reuse_intent` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_attempt_id_unique` ON `feedback` (`attempt_id`);--> statement-breakpoint
CREATE INDEX `idx_feedback_user` ON `feedback` (`user_id`);--> statement-breakpoint
CREATE TABLE `normalised_attempt_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`evidence_version` text NOT NULL,
	`evidence_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `normalised_attempt_evidence_attempt_id_unique` ON `normalised_attempt_evidence` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `performance_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`safe_profile_json` text NOT NULL,
	`evidence_attempt_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `performance_profiles_user_id_unique` ON `performance_profiles` (`user_id`);--> statement-breakpoint
CREATE TABLE `question_inputs` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`scenario_text` text NOT NULL,
	`requirement_text` text NOT NULL,
	`marks_available` integer,
	`source_type` text DEFAULT 'PASTED_TEXT' NOT NULL,
	`retention_until` text,
	`deletion_requested_at` text,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_inputs_attempt_id_unique` ON `question_inputs` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`reviewer_id` text NOT NULL,
	`decision` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_reviews_attempt_created` ON `reviews` (`attempt_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`email` text,
	`demo` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
