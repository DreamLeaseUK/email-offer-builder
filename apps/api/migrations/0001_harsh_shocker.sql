ALTER TABLE `campaigns` ADD `sent_via` text;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `links` text DEFAULT '{}' NOT NULL;