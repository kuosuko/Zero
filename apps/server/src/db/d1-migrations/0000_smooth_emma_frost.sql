CREATE TABLE `mail0_account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `mail0_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `mail0_account` (`user_id`);--> statement-breakpoint
CREATE INDEX `account_provider_user_id_idx` ON `mail0_account` (`provider_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `account_expires_at_idx` ON `mail0_account` (`access_token_expires_at`);--> statement-breakpoint
CREATE TABLE `mail0_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`picture` text,
	`access_token` text,
	`refresh_token` text,
	`scope` text NOT NULL,
	`provider_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `mail0_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connection_user_email_idx` ON `mail0_connection` (`user_id`,`email`);--> statement-breakpoint
CREATE INDEX `connection_user_id_idx` ON `mail0_connection` (`user_id`);--> statement-breakpoint
CREATE INDEX `connection_expires_at_idx` ON `mail0_connection` (`expires_at`);--> statement-breakpoint
CREATE INDEX `connection_provider_id_idx` ON `mail0_connection` (`provider_id`);--> statement-breakpoint
CREATE TABLE `mail0_early_access` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`is_early_access` integer DEFAULT false NOT NULL,
	`has_used_ticket` text DEFAULT ''
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail0_early_access_email_unique` ON `mail0_early_access` (`email`);--> statement-breakpoint
CREATE INDEX `early_access_is_early_access_idx` ON `mail0_early_access` (`is_early_access`);--> statement-breakpoint
CREATE TABLE `mail0_email_template` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`subject` text,
	`body` text,
	`to` text,
	`cc` text,
	`bcc` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `mail0_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_mail0_email_template_user_id` ON `mail0_email_template` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mail0_email_template_user_id_name_unique` ON `mail0_email_template` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `mail0_jwks` (
	`id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jwks_created_at_idx` ON `mail0_jwks` (`created_at`);--> statement-breakpoint
CREATE TABLE `mail0_note` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`content` text NOT NULL,
	`color` text DEFAULT 'default' NOT NULL,
	`is_pinned` integer DEFAULT false,
	`order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `mail0_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `note_user_id_idx` ON `mail0_note` (`user_id`);--> statement-breakpoint
CREATE INDEX `note_thread_id_idx` ON `mail0_note` (`thread_id`);--> statement-breakpoint
CREATE INDEX `note_user_thread_idx` ON `mail0_note` (`user_id`,`thread_id`);--> statement-breakpoint
CREATE INDEX `note_is_pinned_idx` ON `mail0_note` (`is_pinned`);--> statement-breakpoint
CREATE TABLE `mail0_oauth_access_token` (
	`id` text PRIMARY KEY NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`client_id` text,
	`user_id` text,
	`scopes` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail0_oauth_access_token_access_token_unique` ON `mail0_oauth_access_token` (`access_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `mail0_oauth_access_token_refresh_token_unique` ON `mail0_oauth_access_token` (`refresh_token`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_user_id_idx` ON `mail0_oauth_access_token` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_client_id_idx` ON `mail0_oauth_access_token` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_expires_at_idx` ON `mail0_oauth_access_token` (`access_token_expires_at`);--> statement-breakpoint
CREATE TABLE `mail0_oauth_application` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`icon` text,
	`metadata` text,
	`client_id` text,
	`client_secret` text,
	`redirect_u_r_ls` text,
	`type` text,
	`disabled` integer,
	`user_id` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail0_oauth_application_client_id_unique` ON `mail0_oauth_application` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_application_user_id_idx` ON `mail0_oauth_application` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauth_application_disabled_idx` ON `mail0_oauth_application` (`disabled`);--> statement-breakpoint
CREATE TABLE `mail0_oauth_consent` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text,
	`user_id` text,
	`scopes` text,
	`created_at` integer,
	`updated_at` integer,
	`consent_given` integer
);
--> statement-breakpoint
CREATE INDEX `oauth_consent_user_id_idx` ON `mail0_oauth_consent` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauth_consent_client_id_idx` ON `mail0_oauth_consent` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_consent_given_idx` ON `mail0_oauth_consent` (`consent_given`);--> statement-breakpoint
CREATE TABLE `mail0_session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `mail0_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail0_session_token_unique` ON `mail0_session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `mail0_session` (`user_id`);--> statement-breakpoint
CREATE INDEX `session_expires_at_idx` ON `mail0_session` (`expires_at`);--> statement-breakpoint
CREATE TABLE `mail0_summary` (
	`message_id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`connection_id` text NOT NULL,
	`saved` integer DEFAULT false NOT NULL,
	`tags` text,
	`suggested_reply` text,
	FOREIGN KEY (`connection_id`) REFERENCES `mail0_connection`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `summary_connection_id_idx` ON `mail0_summary` (`connection_id`);--> statement-breakpoint
CREATE INDEX `summary_connection_id_saved_idx` ON `mail0_summary` (`connection_id`,`saved`);--> statement-breakpoint
CREATE INDEX `summary_saved_idx` ON `mail0_summary` (`saved`);--> statement-breakpoint
CREATE TABLE `mail0_user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`default_connection_id` text,
	`custom_prompt` text,
	`phone_number` text,
	`phone_number_verified` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail0_user_email_unique` ON `mail0_user` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `mail0_user_phone_number_unique` ON `mail0_user` (`phone_number`);--> statement-breakpoint
CREATE TABLE `mail0_user_hotkeys` (
	`user_id` text PRIMARY KEY NOT NULL,
	`shortcuts` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `mail0_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_hotkeys_shortcuts_idx` ON `mail0_user_hotkeys` (`shortcuts`);--> statement-breakpoint
CREATE TABLE `mail0_user_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`settings` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `mail0_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail0_user_settings_user_id_unique` ON `mail0_user_settings` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_settings_settings_idx` ON `mail0_user_settings` (`settings`);--> statement-breakpoint
CREATE TABLE `mail0_verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `mail0_verification` (`identifier`);--> statement-breakpoint
CREATE INDEX `verification_expires_at_idx` ON `mail0_verification` (`expires_at`);--> statement-breakpoint
CREATE TABLE `mail0_writing_style_matrix` (
	`connectionId` text PRIMARY KEY NOT NULL,
	`numMessages` integer NOT NULL,
	`style` text NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`connectionId`) REFERENCES `mail0_connection`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `writing_style_matrix_style_idx` ON `mail0_writing_style_matrix` (`style`);