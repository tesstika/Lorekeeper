CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text,
	`file_path` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`width` integer,
	`height` integer,
	`size_bytes` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`tagline` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`avatar_path` text,
	`description` text DEFAULT '' NOT NULL,
	`creator_notes` text DEFAULT '' NOT NULL,
	`extensions` text DEFAULT '{}' NOT NULL,
	`personality` text DEFAULT '' NOT NULL,
	`behavior` text DEFAULT '' NOT NULL,
	`communication_style` text DEFAULT '' NOT NULL,
	`likes` text DEFAULT '' NOT NULL,
	`dislikes` text DEFAULT '' NOT NULL,
	`backstory` text DEFAULT '' NOT NULL,
	`scenario` text DEFAULT '' NOT NULL,
	`example_dialogue` text DEFAULT '' NOT NULL,
	`first_message` text DEFAULT '' NOT NULL,
	`alternate_greetings` text DEFAULT '[]' NOT NULL,
	`system_extras` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chats` (
	`id` text PRIMARY KEY NOT NULL,
	`character_id` text NOT NULL,
	`persona_id` text,
	`title` text NOT NULL,
	`ribbon` text,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`provider_id` text,
	`model_id` text,
	`preset_id` text,
	`last_message_at` text NOT NULL,
	`last_message_preview` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`persona_id`) REFERENCES `personas`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`preset_id`) REFERENCES `presets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`seq` integer NOT NULL,
	`role` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`group_id` text,
	`variant_index` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`is_greeting` integer DEFAULT false NOT NULL,
	`provider_id` text,
	`model_id` text,
	`finish_reason` text,
	`is_error` integer DEFAULT false NOT NULL,
	`error` text,
	`usage` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_messages_chat_seq` ON `messages` (`chat_id`,`seq`);--> statement-breakpoint
CREATE TABLE `personas` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`avatar_path` text,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `presets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`temperature` real DEFAULT 0.85 NOT NULL,
	`top_p` real DEFAULT 0.92 NOT NULL,
	`top_k` integer,
	`max_tokens` integer DEFAULT 4096 NOT NULL,
	`frequency_penalty` real DEFAULT 0 NOT NULL,
	`presence_penalty` real DEFAULT 0 NOT NULL,
	`repetition_penalty` real,
	`stop_sequences` text DEFAULT '[]' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
