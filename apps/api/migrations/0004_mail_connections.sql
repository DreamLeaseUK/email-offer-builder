CREATE TABLE `mail_connections` (
	`email` text PRIMARY KEY NOT NULL,
	`refresh_token_enc` text NOT NULL,
	`scopes` text NOT NULL,
	`connected_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_sent_at` text
);
