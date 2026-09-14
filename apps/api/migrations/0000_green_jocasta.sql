CREATE TABLE `brochures` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_key` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`fetched_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `brochures_vehicle_key_status` ON `brochures` (`vehicle_key`,`status`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`use_case` text NOT NULL,
	`status` text NOT NULL,
	`hosted_slug` text NOT NULL,
	`template_id` text NOT NULL,
	`template_version` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`sent_at` text,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaigns_hosted_slug` ON `campaigns` (`hosted_slug`);--> statement-breakpoint
CREATE INDEX `campaigns_created_by` ON `campaigns` (`created_by`);--> statement-breakpoint
CREATE INDEX `campaigns_status` ON `campaigns` (`status`);--> statement-breakpoint
CREATE TABLE `clicks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` text NOT NULL,
	`link_id` text NOT NULL,
	`kind` text NOT NULL,
	`ua_class` text NOT NULL,
	`ts` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `clicks_campaign_ts` ON `clicks` (`campaign_id`,`ts`);--> statement-breakpoint
CREATE TABLE `lookup_cache` (
	`url_key` text PRIMARY KEY NOT NULL,
	`fetched_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `offers` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_key` text NOT NULL,
	`contract_type` text NOT NULL,
	`valid_until` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `offers_vehicle_key` ON `offers` (`vehicle_key`);--> statement-breakpoint
CREATE INDEX `offers_valid_until` ON `offers` (`valid_until`);--> statement-breakpoint
CREATE TABLE `senders` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`updated_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `suppressions` (
	`email` text PRIMARY KEY NOT NULL,
	`added_by` text NOT NULL,
	`added_at` text NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`created_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `templates_name_version` ON `templates` (`name`,`version`);--> statement-breakpoint
CREATE INDEX `templates_status` ON `templates` (`status`);