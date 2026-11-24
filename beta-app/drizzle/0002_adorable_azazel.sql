CREATE TABLE `pilot_enrolments` (
	`invite_key` text PRIMARY KEY NOT NULL,
	`site_user_id` text NOT NULL,
	`enrolled_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pilot_enrolments_site_user_id_unique` ON `pilot_enrolments` (`site_user_id`);