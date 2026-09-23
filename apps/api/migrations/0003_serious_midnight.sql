CREATE TABLE `library_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`category` text,
	`status` text NOT NULL,
	`url_health` text NOT NULL,
	`make` text NOT NULL,
	`model` text NOT NULL,
	`fuel_type` text,
	`body_style` text,
	`contract_type` text NOT NULL,
	`monthly` integer NOT NULL,
	`vehicle_key` text NOT NULL,
	`valid_until` text NOT NULL,
	`added_by` text NOT NULL,
	`added_at` text NOT NULL,
	`archived_at` text,
	`last_priced_at` text,
	`updated_at` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `library_scope_status_added` ON `library_entries` (`scope`,`status`,`added_at`);--> statement-breakpoint
CREATE INDEX `library_owner_status` ON `library_entries` (`added_by`,`status`);--> statement-breakpoint
CREATE INDEX `library_facets` ON `library_entries` (`make`,`model`,`contract_type`);--> statement-breakpoint
CREATE INDEX `library_category_status` ON `library_entries` (`category`,`status`);--> statement-breakpoint
CREATE INDEX `library_archived` ON `library_entries` (`status`,`archived_at`);