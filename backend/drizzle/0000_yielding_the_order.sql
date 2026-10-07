CREATE TABLE `cinema_replies` (
	`request_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`telegram_message_id` integer
);
