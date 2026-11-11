CREATE TABLE "artifact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"anthropic_file_id" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"downloadable" boolean DEFAULT false NOT NULL,
	"file_created_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_size_bytes_check" CHECK ("artifact"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "artifact_save" (
	"artifact_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_save_artifact_id_user_id_pk" PRIMARY KEY("artifact_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "auth_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL,
	CONSTRAINT "invitation_status_check" CHECK ("invitation"."status" in ('pending', 'accepted', 'rejected', 'canceled'))
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "member_role_check" CHECK ("member"."role" in ('owner', 'admin', 'member'))
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"purge_attempted_at" timestamp with time zone,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"timezone" text,
	"browser_timezone" text,
	"time_format" text,
	"reply_language" text,
	"purge_attempted_at" timestamp with time zone,
	"account_status" text DEFAULT 'live' NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_email" text,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_time_format_check" CHECK ("user"."time_format" in ('12h', '24h')),
	CONSTRAINT "user_account_status_check" CHECK ("user"."account_status" in ('live', 'deleted', 'anonymized')),
	CONSTRAINT "user_account_tombstone_check" CHECK (("user"."account_status" = 'live' and "user"."deleted_at" is null and "user"."deleted_email" is null) or ("user"."account_status" in ('deleted', 'anonymized') and "user"."deleted_at" is not null and "user"."email" = 'deleted+' || "user"."id" || '@deleted.agentcore.local' and ("user"."account_status" <> 'anonymized' or "user"."deleted_email" is null)))
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auto_topup_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"status" text DEFAULT 'creating' NOT NULL,
	"credits" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"payment_method_id" text,
	"stripe_payment_intent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auto_topup_attempt_intent_state_check" CHECK (("auto_topup_attempt"."status" not in ('pending', 'succeeded') or "auto_topup_attempt"."stripe_payment_intent_id" is not null) and ("auto_topup_attempt"."status" <> 'superseded' or "auto_topup_attempt"."stripe_payment_intent_id" is null)),
	CONSTRAINT "auto_topup_attempt_card_state_check" CHECK (("auto_topup_attempt"."status" <> 'creating' or "auto_topup_attempt"."payment_method_id" is null) and ("auto_topup_attempt"."status" <> 'charging' or "auto_topup_attempt"."payment_method_id" is not null)),
	CONSTRAINT "auto_topup_attempt_status_check" CHECK ("auto_topup_attempt"."status" in ('creating', 'charging', 'pending', 'succeeded', 'failed', 'superseded')),
	CONSTRAINT "auto_topup_attempt_credits_positive_check" CHECK ("auto_topup_attempt"."credits" > 0),
	CONSTRAINT "auto_topup_attempt_amount_positive_check" CHECK ("auto_topup_attempt"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "browser_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"status" text DEFAULT 'creating' NOT NULL,
	"browserbase_session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "browser_candidate_tool_name_check" CHECK ("browser_candidate"."tool_name" in ('browse_open', 'browse_page')),
	CONSTRAINT "browser_candidate_status_check" CHECK ("browser_candidate"."status" in ('creating', 'created')),
	CONSTRAINT "browser_candidate_identity_check" CHECK (("browser_candidate"."status" = 'creating') = ("browser_candidate"."browserbase_session_id" is null))
);
--> statement-breakpoint
CREATE TABLE "credit_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"amount" integer NOT NULL,
	"consumed" integer DEFAULT 0 NOT NULL,
	"source_ref" text NOT NULL,
	"debt_kind" text,
	"parent_grant_id" uuid,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "credit_grant_status_check" CHECK ("credit_grant"."status" in ('issued', 'retired')),
	CONSTRAINT "credit_grant_source_check" CHECK ("credit_grant"."source" in ('plan', 'topup', 'welcome', 'debt')),
	CONSTRAINT "credit_grant_amount_positive_check" CHECK ("credit_grant"."amount" > 0),
	CONSTRAINT "credit_grant_consumed_range_check" CHECK ("credit_grant"."consumed" >= 0 and (("credit_grant"."source" = 'debt' and "credit_grant"."consumed" between "credit_grant"."amount" and 2 * "credit_grant"."amount") or ("credit_grant"."source" <> 'debt' and "credit_grant"."consumed" <= "credit_grant"."amount"))),
	CONSTRAINT "credit_grant_debt_kind_check" CHECK (("credit_grant"."source" = 'debt') = ("credit_grant"."debt_kind" is not null) and ("credit_grant"."debt_kind" is null or "credit_grant"."debt_kind" in ('usage', 'hold', 'refund', 'restored'))),
	CONSTRAINT "credit_grant_hold_parent_check" CHECK ("credit_grant"."debt_kind" is distinct from 'hold' or "credit_grant"."parent_grant_id" is not null),
	CONSTRAINT "credit_grant_expiry_after_issue_check" CHECK ("credit_grant"."expires_at" > "credit_grant"."issued_at")
);
--> statement-breakpoint
CREATE TABLE "welcome_credit_grant" (
	"user_id" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_tool_dispatch" (
	"tool_use_id" text PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"status" text DEFAULT 'claimed' NOT NULL,
	"delivery" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_tool_dispatch_status_check" CHECK ("custom_tool_dispatch"."status" in ('awaiting_decision', 'claimed', 'executing', 'ready', 'delivering', 'delivered', 'completed', 'abandoned')),
	CONSTRAINT "custom_tool_dispatch_delivery_check" CHECK (("custom_tool_dispatch"."status" in ('awaiting_decision', 'claimed', 'executing') and "custom_tool_dispatch"."delivery" is null) or ("custom_tool_dispatch"."status" in ('ready', 'delivering', 'delivered') and "custom_tool_dispatch"."delivery" is not null) or "custom_tool_dispatch"."status" in ('completed', 'abandoned'))
);
--> statement-breakpoint
CREATE TABLE "deployment_setting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"changed_by_user_id" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployment_setting_key_check" CHECK (char_length("deployment_setting"."key") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"source" text NOT NULL,
	"session_id" uuid,
	"storage_path" text NOT NULL,
	"thumbnail_path" text,
	"folder_path" text DEFAULT '/' NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "file_storage_path_unique" UNIQUE("storage_path"),
	CONSTRAINT "file_source_check" CHECK ("file"."source" in ('user_upload', 'agent_generated', 'session_output'))
);
--> statement-breakpoint
CREATE TABLE "folder_share" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"folder_id" uuid,
	"file_id" uuid,
	"mode" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "folder_share_token_unique" UNIQUE("token"),
	CONSTRAINT "folder_share_target_check" CHECK ("folder_share"."file_id" is null or "folder_share"."folder_id" is null),
	CONSTRAINT "folder_share_file_view_only_check" CHECK ("folder_share"."file_id" is null or "folder_share"."mode" = 'view'),
	CONSTRAINT "folder_share_mode_check" CHECK ("folder_share"."mode" in ('view', 'edit'))
);
--> statement-breakpoint
CREATE TABLE "folder" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"path" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "integration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"toolkit" text NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_workspace_user_toolkit_uq" UNIQUE("workspace_id","user_id","toolkit"),
	CONSTRAINT "integration_status_check" CHECK ("integration"."status" in ('connected', 'disconnecting', 'disconnected'))
);
--> statement-breakpoint
CREATE TABLE "shared_integration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"toolkit" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"connected_account_id" text,
	"shared_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_integration_workspace_toolkit_uq" UNIQUE("workspace_id","toolkit"),
	CONSTRAINT "shared_integration_status_check" CHECK ("shared_integration"."status" in ('pending', 'active', 'removing')),
	CONSTRAINT "shared_integration_active_account_check" CHECK ("shared_integration"."status" <> 'active' or "shared_integration"."connected_account_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "integration_cleanup" (
	"composio_user_id" text PRIMARY KEY NOT NULL,
	"requires_composio" boolean DEFAULT true NOT NULL,
	"vault_id" text,
	"memory_store_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"purge_attempted_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	CONSTRAINT "integration_cleanup_status_check" CHECK ("integration_cleanup"."status" in ('pending', 'working')),
	CONSTRAINT "integration_cleanup_claim_check" CHECK (("integration_cleanup"."status" = 'working') = ("integration_cleanup"."claimed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "manual_topup_attempt" (
	"workspace_id" uuid NOT NULL,
	"attempt_key" text NOT NULL,
	"credits" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"stripe_payment_intent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_topup_attempt_workspace_id_attempt_key_pk" PRIMARY KEY("workspace_id","attempt_key"),
	CONSTRAINT "manual_topup_attempt_status_check" CHECK ("manual_topup_attempt"."status" in ('open', 'processing', 'succeeded', 'failed', 'expired')),
	CONSTRAINT "manual_topup_attempt_intent_check" CHECK ("manual_topup_attempt"."status" <> 'processing' or "manual_topup_attempt"."stripe_payment_intent_id" is not null),
	CONSTRAINT "manual_topup_attempt_credits_positive_check" CHECK ("manual_topup_attempt"."credits" > 0)
);
--> statement-breakpoint
CREATE TABLE "message_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'message' NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid,
	"user_id" text NOT NULL,
	"anthropic_event_id" text,
	"rating" text,
	"comment" text,
	"body" text,
	"route" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_feedback_kind_check" CHECK ("message_feedback"."kind" in ('message', 'app')),
	CONSTRAINT "message_feedback_rating_check" CHECK ("message_feedback"."rating" in ('up', 'down')),
	CONSTRAINT "message_feedback_comment_length_check" CHECK (char_length("message_feedback"."comment") <= 2000),
	CONSTRAINT "message_feedback_body_length_check" CHECK (char_length("message_feedback"."body") <= 4000),
	CONSTRAINT "message_feedback_message_shape_check" CHECK ("message_feedback"."kind" <> 'message' or ("message_feedback"."session_id" is not null and "message_feedback"."anthropic_event_id" is not null and "message_feedback"."rating" is not null)),
	CONSTRAINT "message_feedback_app_shape_check" CHECK ("message_feedback"."kind" <> 'app' or ("message_feedback"."body" is not null and "message_feedback"."route" is not null))
);
--> statement-breakpoint
CREATE TABLE "model_usage_observation" (
	"event_id" text PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_creation_tokens" integer NOT NULL,
	"cache_read_tokens" integer NOT NULL,
	"vendor_cost_cents" numeric(20, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"idempotency_key" text,
	"email_status" text DEFAULT 'skipped' NOT NULL,
	"email_claimed_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_kind_check" CHECK ("notification"."kind" in ('task.completed', 'task.failed', 'task.needs_input', 'topup.granted', 'credits.low', 'credits.paused', 'payment.failed', 'plan.updated', 'integration.broken', 'team.member_joined', 'team.added_to_workspace', 'share.received')),
	CONSTRAINT "notification_email_status_check" CHECK ("notification"."email_status" in ('pending', 'sending', 'sent', 'skipped', 'expired')),
	CONSTRAINT "notification_email_claim_check" CHECK (("notification"."email_status" = 'sending') = ("notification"."email_claimed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preference_user_category_unique" UNIQUE("user_id","category"),
	CONSTRAINT "notification_preference_category_check" CHECK ("notification_preference"."category" in ('account_billing', 'connections', 'team_sharing', 'task_alerts'))
);
--> statement-breakpoint
CREATE TABLE "payment_credit_reversal" (
	"charge_id" text NOT NULL,
	"grant_id" uuid NOT NULL,
	"removed_credits" integer NOT NULL,
	"balance_removed" integer DEFAULT 0 NOT NULL,
	"debt_credits" integer DEFAULT 0 NOT NULL,
	"revision" integer NOT NULL,
	CONSTRAINT "payment_credit_reversal_charge_id_grant_id_pk" PRIMARY KEY("charge_id","grant_id"),
	CONSTRAINT "payment_credit_reversal_values_check" CHECK ("payment_credit_reversal"."removed_credits" >= 0 and "payment_credit_reversal"."revision" > 0 and "payment_credit_reversal"."balance_removed" >= "payment_credit_reversal"."debt_credits" and "payment_credit_reversal"."debt_credits" >= 0 and "payment_credit_reversal"."balance_removed" <= "payment_credit_reversal"."removed_credits")
);
--> statement-breakpoint
CREATE TABLE "pending_confirmation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"tool_use_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"input" jsonb NOT NULL,
	"requested_by_user_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "pending_confirmation_decision_check" CHECK (("pending_confirmation"."status" = 'pending' and "pending_confirmation"."decided_at" is null) or ("pending_confirmation"."status" in ('approved', 'denied') and "pending_confirmation"."decided_at" is not null)),
	CONSTRAINT "pending_confirmation_status_check" CHECK ("pending_confirmation"."status" in ('pending', 'approved', 'denied'))
);
--> statement-breakpoint
CREATE TABLE "processed_webhook_event" (
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_webhook_event_provider_event_id_pk" PRIMARY KEY("provider","event_id"),
	CONSTRAINT "processed_webhook_provider_check" CHECK ("processed_webhook_event"."provider" in ('stripe', 'composio', 'anthropic')),
	CONSTRAINT "processed_webhook_stripe_receipt_check" CHECK ("processed_webhook_event"."provider" <> 'stripe' or "processed_webhook_event"."payload" is null)
);
--> statement-breakpoint
CREATE TABLE "realtime_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"audience_user_id" text,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"tier" text NOT NULL,
	"workspace_memory_access" text NOT NULL,
	"permission_mode" text DEFAULT 'ask' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"kind" text NOT NULL,
	"task_id" uuid,
	"anthropic_session_id" text,
	"browserbase_session_id" text,
	"browserbase_session_status" text,
	"browserbase_session_started_at" timestamp with time zone,
	"browserbase_session_ended_at" timestamp with time zone,
	"browserbase_session_url" text,
	"browserbase_session_title" text,
	"browser_lease_expires_at" timestamp with time zone,
	"title" text,
	"search_text" text,
	"search_text_event_id" text,
	"status" text DEFAULT 'idle' NOT NULL,
	"review_outcome" text,
	"container_seconds" integer DEFAULT 0 NOT NULL,
	"credits_consumed" integer DEFAULT 0 NOT NULL,
	"vendor_cost_cents" numeric(20, 6) DEFAULT 0 NOT NULL,
	"provider_archived_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"favorited_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"paused_reason" text,
	"stop_reason" text,
	"state_version" integer DEFAULT 0 NOT NULL,
	"last_status_probe_at" timestamp with time zone,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_event_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"usage_reconciled_at" timestamp with time zone,
	"usage_reconcile_attempted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_stop_reason_check" CHECK ("session"."stop_reason" in ('end_turn', 'requires_action', 'budget_reached', 'retries_exhausted', 'interrupted')),
	CONSTRAINT "session_pause_consistency_check" CHECK (("session"."status" in ('pausing', 'paused_no_credits', 'resuming') and "session"."paused_at" is not null and "session"."paused_reason" is not null) or ("session"."status" not in ('pausing', 'paused_no_credits', 'resuming') and "session"."paused_at" is null and "session"."paused_reason" is null)),
	CONSTRAINT "session_hidden_check" CHECK ("session"."hidden_at" is null or "session"."status" in ('creation_cleanup', 'terminated')),
	CONSTRAINT "session_archive_check" CHECK ("session"."provider_archived_at" is null or "session"."hidden_at" is not null),
	CONSTRAINT "session_tier_check" CHECK ("session"."tier" in ('fast', 'default', 'pro')),
	CONSTRAINT "session_permission_mode_check" CHECK ("session"."permission_mode" in ('ask', 'auto')),
	CONSTRAINT "session_visibility_check" CHECK ("session"."visibility" in ('private', 'workspace')),
	CONSTRAINT "session_kind_check" CHECK ("session"."kind" in ('chat', 'task_run')),
	CONSTRAINT "session_status_check" CHECK ("session"."status" in ('creating', 'creation_cleanup', 'awaiting_opening', 'opening', 'resuming', 'idle', 'running', 'rescheduling', 'requires_input', 'pausing', 'paused_no_credits', 'terminated')),
	CONSTRAINT "session_review_outcome_check" CHECK ("session"."review_outcome" in ('passed', 'passed_after_revision', 'not_passed')),
	CONSTRAINT "session_paused_reason_check" CHECK ("session"."paused_reason" in ('credits', 'budget', 'member_limit')),
	CONSTRAINT "session_workspace_memory_access_check" CHECK ("session"."workspace_memory_access" in ('none', 'read_only', 'read_write')),
	CONSTRAINT "session_browser_lease_check" CHECK (("session"."browserbase_session_status" is not null and "session"."browserbase_session_status" in ('user', 'acting', 'closing')) = ("session"."browser_lease_expires_at" is not null)),
	CONSTRAINT "session_browser_end_check" CHECK (("session"."browserbase_session_status" is not null and "session"."browserbase_session_status" in ('closed', 'ended')) = ("session"."browserbase_session_ended_at" is not null)),
	CONSTRAINT "session_browser_identity_check" CHECK (("session"."browserbase_session_status" is null and "session"."browserbase_session_id" is null) or ("session"."browserbase_session_status" is not null and "session"."browserbase_session_id" is not null and "session"."browserbase_session_started_at" is not null)),
	CONSTRAINT "session_browserbase_session_status_check" CHECK ("session"."browserbase_session_status" is null or "session"."browserbase_session_status" in ('active', 'user', 'acting', 'closing', 'closed', 'ended'))
);
--> statement-breakpoint
CREATE TABLE "session_file_mount" (
	"anthropic_file_id" text PRIMARY KEY NOT NULL,
	"file_id" uuid,
	"session_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_read_state" (
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"last_read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "session_read_state_session_id_user_id_pk" PRIMARY KEY("session_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "session_send" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"status" text NOT NULL,
	"event_id" text,
	"processed_at" text,
	"attempt_token" uuid,
	"recover_after" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_send_status_check" CHECK ("session_send"."status" in ('sending', 'delivered', 'error', 'unconfirmed')),
	CONSTRAINT "session_send_echo_check" CHECK (("session_send"."status" = 'delivered') = ("session_send"."event_id" is not null)),
	CONSTRAINT "session_send_attempt_check" CHECK (("session_send"."status" in ('sending', 'unconfirmed')) = ("session_send"."attempt_token" is not null and "session_send"."recover_after" is not null))
);
--> statement-breakpoint
CREATE TABLE "session_share" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_share_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "session_tool_approval" (
	"session_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_tool_approval_session_id_tool_name_pk" PRIMARY KEY("session_id","tool_name"),
	CONSTRAINT "session_tool_approval_tool_name_check" CHECK (btrim("session_tool_approval"."tool_name") <> '')
);
--> statement-breakpoint
CREATE TABLE "session_turn_claim" (
	"session_id" uuid NOT NULL,
	"terminal_event_id" text NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_turn_claim_session_id_terminal_event_id_pk" PRIMARY KEY("session_id","terminal_event_id")
);
--> statement-breakpoint
CREATE TABLE "skill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anthropic_skill_id" text,
	"kind" text NOT NULL,
	"owner_workspace_id" uuid,
	"created_by_user_id" text,
	"name" text NOT NULL,
	"description" text,
	"latest_version" text,
	"source_hash" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"publication" jsonb,
	"retained_skill_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_status_check" CHECK ("skill"."status" in ('ready', 'publishing', 'deleting')),
	CONSTRAINT "skill_publication_check" CHECK (("skill"."status" = 'publishing' and "skill"."publication" is not null) or ("skill"."status" = 'ready' and "skill"."publication" is null) or "skill"."status" = 'deleting'),
	CONSTRAINT "skill_remote_version_check" CHECK (("skill"."anthropic_skill_id" is null) = ("skill"."latest_version" is null)),
	CONSTRAINT "skill_kind_check" CHECK ("skill"."kind" in ('anthropic', 'preset', 'custom')),
	CONSTRAINT "skill_owner_kind_check" CHECK (("skill"."kind" in ('anthropic', 'preset') and "skill"."owner_workspace_id" is null) or ("skill"."kind" = 'custom' and "skill"."owner_workspace_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "skill_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"path" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_file_path_check" CHECK ("skill_file"."path" <> ''),
	CONSTRAINT "skill_file_path_relative_check" CHECK ("skill_file"."path" not like '/%'),
	CONSTRAINT "skill_file_path_no_traversal_check" CHECK ("skill_file"."path" not like '%..%' and "skill_file"."path" not like '%//%')
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"tier" text DEFAULT 'default' NOT NULL,
	"auto_approve" boolean DEFAULT false NOT NULL,
	"notification" text DEFAULT 'email_app' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"title" text NOT NULL,
	"icon" text,
	"description" text,
	"success_criteria" text,
	"attachments" jsonb,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"provider_sync" text DEFAULT 'synced' NOT NULL,
	"sync_claimed_at" timestamp with time zone,
	"trigger_type" text NOT NULL,
	"cron_schedule" text,
	"run_at" timestamp with time zone,
	"timezone" text,
	"anthropic_deployment_id" text,
	"deployment_snapshot_hash" text,
	"runs_checked_at" timestamp with time zone,
	"deployment_checked_at" timestamp with time zone,
	"composio_trigger_id" text,
	"event_toolkit" text,
	"event_type" text,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"run_now_claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_tier_check" CHECK ("task"."tier" in ('fast', 'default', 'pro')),
	CONSTRAINT "task_notification_check" CHECK ("task"."notification" in ('email_app', 'email', 'app', 'off')),
	CONSTRAINT "task_visibility_check" CHECK ("task"."visibility" in ('private', 'workspace')),
	CONSTRAINT "task_status_check" CHECK ("task"."status" in ('creating', 'upcoming', 'paused', 'running', 'done', 'removed')),
	CONSTRAINT "task_provider_sync_check" CHECK ("task"."provider_sync" in ('synced', 'status', 'definition')),
	CONSTRAINT "task_trigger_type_check" CHECK ("task"."trigger_type" in ('schedule', 'event')),
	CONSTRAINT "task_schedule_definition_check" CHECK ("task"."trigger_type" <> 'schedule' or ("task"."cron_schedule" is not null and "task"."run_at" is null) or ("task"."cron_schedule" is null and "task"."run_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "tool_permission" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"toolkit" text NOT NULL,
	"tool_name" text NOT NULL,
	"policy_source" text DEFAULT 'member' NOT NULL,
	"policy" text NOT NULL,
	"settings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_permission_organization_id_user_id_toolkit_tool_name_pk" PRIMARY KEY("organization_id","user_id","toolkit","tool_name"),
	CONSTRAINT "tool_permission_policy_source_check" CHECK ("tool_permission"."policy_source" in ('default', 'member')),
	CONSTRAINT "tool_permission_policy_check" CHECK ("tool_permission"."policy" in ('allow', 'ask', 'block')),
	CONSTRAINT "tool_permission_toolkit_check" CHECK ("tool_permission"."toolkit" <> ''),
	CONSTRAINT "tool_permission_tool_name_check" CHECK ("tool_permission"."tool_name" <> ''),
	CONSTRAINT "tool_permission_exact_tool_check" CHECK ("tool_permission"."tool_name" not like '*%')
);
--> statement-breakpoint
CREATE TABLE "tool_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_request_message_check" CHECK ("tool_request"."message" <> '')
);
--> statement-breakpoint
CREATE TABLE "usage_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid,
	"user_id" text,
	"event_type" text NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"cache_creation_tokens" integer,
	"cache_read_tokens" integer,
	"container_seconds" integer,
	"audio_seconds" integer,
	"platform_paid" boolean DEFAULT false NOT NULL,
	"vendor_cost_cents" numeric(20, 6),
	"settlement_status" text DEFAULT 'complete' NOT NULL,
	"credits_delta" integer NOT NULL,
	"usage_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_event_pending_settlement_identity_check" CHECK ("usage_event"."settlement_status" <> 'pending' or "usage_event"."usage_key" is not null),
	CONSTRAINT "usage_event_settlement_status_check" CHECK ("usage_event"."settlement_status" in ('pending', 'complete')),
	CONSTRAINT "usage_event_vendor_cost_check" CHECK ("usage_event"."vendor_cost_cents" >= 0),
	CONSTRAINT "usage_event_platform_paid_check" CHECK (not "usage_event"."platform_paid" or ("usage_event"."credits_delta" = 0 and "usage_event"."vendor_cost_cents" is not null)),
	CONSTRAINT "usage_event_event_type_check" CHECK ("usage_event"."event_type" in ('model_request', 'tool_call', 'container_runtime', 'voice_transcription', 'voice_tts', 'generation', 'title_generation')),
	CONSTRAINT "usage_event_container_seconds_check" CHECK ("usage_event"."container_seconds" is null or "usage_event"."event_type" = 'container_runtime'),
	CONSTRAINT "usage_event_audio_seconds_check" CHECK ("usage_event"."audio_seconds" is null or "usage_event"."event_type" = 'voice_transcription')
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"budget_sync_status" text DEFAULT 'idle' NOT NULL,
	"budget_sync_revision" integer DEFAULT 0 NOT NULL,
	"budget_sync_lease" uuid,
	"budget_sync_lease_until" timestamp with time zone,
	"billing_revision" integer DEFAULT 0 NOT NULL,
	"stripe_customer_id" text,
	"stripe_customer_generation" integer DEFAULT 0 NOT NULL,
	"stripe_subscription_id" text,
	"plan_tier" text DEFAULT 'none' NOT NULL,
	"plan_billing_interval" text,
	"plan_credits" integer,
	"credit_reset_at" timestamp with time zone,
	"auto_topup_enabled" boolean DEFAULT false NOT NULL,
	"auto_topup_threshold_credits" integer DEFAULT 20 NOT NULL,
	"auto_topup_credits" integer DEFAULT 1000 NOT NULL,
	"auto_topup_monthly_cap_cents" integer DEFAULT 25000 NOT NULL,
	"workspace_memory_store_id" text,
	"browser_context_cleanup_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"lifecycle_status" text DEFAULT 'live' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purge_attempted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_organization_id_unique" UNIQUE("organization_id"),
	CONSTRAINT "workspace_budget_sync_status_check" CHECK ("workspace"."budget_sync_status" in ('idle', 'pending', 'syncing')),
	CONSTRAINT "workspace_budget_sync_lease_check" CHECK (("workspace"."budget_sync_status" = 'syncing' and "workspace"."budget_sync_lease" is not null and "workspace"."budget_sync_lease_until" is not null) or ("workspace"."budget_sync_status" <> 'syncing' and "workspace"."budget_sync_lease" is null and "workspace"."budget_sync_lease_until" is null)),
	CONSTRAINT "workspace_lifecycle_status_check" CHECK ("workspace"."lifecycle_status" in ('live', 'deleting', 'deleted', 'purging')),
	CONSTRAINT "workspace_lifecycle_timestamp_check" CHECK (("workspace"."lifecycle_status" = 'live') = ("workspace"."deleted_at" is null)),
	CONSTRAINT "workspace_plan_entitlement_check" CHECK (("workspace"."plan_tier" = 'none' and "workspace"."stripe_subscription_id" is null and "workspace"."plan_credits" is null) or ("workspace"."plan_tier" in ('pro', 'max') and "workspace"."stripe_subscription_id" is not null and "workspace"."plan_billing_interval" is not null and "workspace"."plan_credits" is not null and "workspace"."plan_credits" > 0)),
	CONSTRAINT "workspace_plan_tier_check" CHECK ("workspace"."plan_tier" in ('none', 'pro', 'max')),
	CONSTRAINT "workspace_plan_billing_interval_check" CHECK (("workspace"."plan_tier" = 'none' and "workspace"."plan_billing_interval" is null) or ("workspace"."plan_tier" in ('pro', 'max') and "workspace"."plan_billing_interval" in ('month', 'year'))),
	CONSTRAINT "workspace_no_plan_auto_topup_disabled_check" CHECK ("workspace"."plan_tier" <> 'none' or "workspace"."auto_topup_enabled" = false),
	CONSTRAINT "workspace_auto_topup_threshold_nonnegative_check" CHECK ("workspace"."auto_topup_threshold_credits" >= 0),
	CONSTRAINT "workspace_auto_topup_credits_positive_check" CHECK ("workspace"."auto_topup_credits" > 0),
	CONSTRAINT "workspace_auto_topup_monthly_cap_nonnegative_check" CHECK ("workspace"."auto_topup_monthly_cap_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "workspace_member" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"composio_user_id" text NOT NULL,
	"browserbase_context_id" text,
	"user_memory_store_id" text,
	"mcp_proxy_vault_id" text,
	"vault_status" text DEFAULT 'unprovisioned' NOT NULL,
	"vault_claimed_at" timestamp with time zone,
	"vault_credential_key" text,
	"vault_credential_updated_at" timestamp with time zone,
	"tool_router_url" text,
	"tool_router_minted_at" timestamp with time zone,
	"tool_router_generation" integer DEFAULT 0 NOT NULL,
	"provisioning_status" text DEFAULT 'pending' NOT NULL,
	"provision_capability_key" text,
	"last_active_at" timestamp with time zone,
	"notifications_seen_at" timestamp with time zone,
	"credit_limit" integer,
	CONSTRAINT "workspace_member_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id"),
	CONSTRAINT "workspace_member_composio_user_id_unique" UNIQUE("composio_user_id"),
	CONSTRAINT "workspace_member_provisioning_status_check" CHECK ("workspace_member"."provisioning_status" in ('pending', 'ready')),
	CONSTRAINT "workspace_member_provisioning_key_check" CHECK ("workspace_member"."provisioning_status" <> 'ready' or "workspace_member"."provision_capability_key" is not null),
	CONSTRAINT "workspace_member_vault_status_check" CHECK ("workspace_member"."vault_status" in ('unprovisioned', 'provisioning', 'provisioned')),
	CONSTRAINT "workspace_member_vault_state_check" CHECK (("workspace_member"."vault_status" = 'unprovisioned' and "workspace_member"."vault_claimed_at" is null) or ("workspace_member"."vault_status" = 'provisioning' and "workspace_member"."vault_claimed_at" is not null) or ("workspace_member"."vault_status" = 'provisioned' and "workspace_member"."mcp_proxy_vault_id" is not null and "workspace_member"."vault_credential_updated_at" is not null and "workspace_member"."vault_claimed_at" is null)),
	CONSTRAINT "workspace_member_router_cache_check" CHECK (("workspace_member"."tool_router_url" is null) = ("workspace_member"."tool_router_minted_at" is null)),
	CONSTRAINT "workspace_member_credit_limit_nonnegative_check" CHECK ("workspace_member"."credit_limit" is null or "workspace_member"."credit_limit" >= 0)
);
--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_save" ADD CONSTRAINT "artifact_save_artifact_id_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_save" ADD CONSTRAINT "artifact_save_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_save" ADD CONSTRAINT "artifact_save_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_topup_attempt" ADD CONSTRAINT "auto_topup_attempt_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_candidate" ADD CONSTRAINT "browser_candidate_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grant" ADD CONSTRAINT "credit_grant_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grant" ADD CONSTRAINT "credit_grant_parent_grant_id_credit_grant_id_fk" FOREIGN KEY ("parent_grant_id") REFERENCES "public"."credit_grant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "welcome_credit_grant" ADD CONSTRAINT "welcome_credit_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_tool_dispatch" ADD CONSTRAINT "custom_tool_dispatch_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_setting" ADD CONSTRAINT "deployment_setting_changed_by_user_id_user_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_share" ADD CONSTRAINT "folder_share_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_share" ADD CONSTRAINT "folder_share_folder_id_folder_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folder"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_share" ADD CONSTRAINT "folder_share_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_share" ADD CONSTRAINT "folder_share_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder" ADD CONSTRAINT "folder_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder" ADD CONSTRAINT "folder_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_integration" ADD CONSTRAINT "shared_integration_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_integration" ADD CONSTRAINT "shared_integration_shared_by_user_id_user_id_fk" FOREIGN KEY ("shared_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_topup_attempt" ADD CONSTRAINT "manual_topup_attempt_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_feedback" ADD CONSTRAINT "message_feedback_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_feedback" ADD CONSTRAINT "message_feedback_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_feedback" ADD CONSTRAINT "message_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_usage_observation" ADD CONSTRAINT "model_usage_observation_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_credit_reversal" ADD CONSTRAINT "payment_credit_reversal_grant_id_credit_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."credit_grant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_confirmation" ADD CONSTRAINT "pending_confirmation_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_confirmation" ADD CONSTRAINT "pending_confirmation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_confirmation" ADD CONSTRAINT "pending_confirmation_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_confirmation" ADD CONSTRAINT "pending_confirmation_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realtime_event" ADD CONSTRAINT "realtime_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realtime_event" ADD CONSTRAINT "realtime_event_audience_user_id_user_id_fk" FOREIGN KEY ("audience_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_file_mount" ADD CONSTRAINT "session_file_mount_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_file_mount" ADD CONSTRAINT "session_file_mount_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_file_mount" ADD CONSTRAINT "session_file_mount_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_read_state" ADD CONSTRAINT "session_read_state_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_read_state" ADD CONSTRAINT "session_read_state_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_read_state" ADD CONSTRAINT "session_read_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_send" ADD CONSTRAINT "session_send_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_share" ADD CONSTRAINT "session_share_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_share" ADD CONSTRAINT "session_share_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_share" ADD CONSTRAINT "session_share_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_tool_approval" ADD CONSTRAINT "session_tool_approval_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_turn_claim" ADD CONSTRAINT "session_turn_claim_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill" ADD CONSTRAINT "skill_owner_workspace_id_workspace_id_fk" FOREIGN KEY ("owner_workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill" ADD CONSTRAINT "skill_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_file" ADD CONSTRAINT "skill_file_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_permission" ADD CONSTRAINT "tool_permission_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."workspace_member"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_request" ADD CONSTRAINT "tool_request_member_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."workspace_member"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_event" ADD CONSTRAINT "usage_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_event" ADD CONSTRAINT "usage_event_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_event" ADD CONSTRAINT "usage_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_anthropic_file_id_uidx" ON "artifact" USING btree ("anthropic_file_id");--> statement-breakpoint
CREATE INDEX "artifact_workspace_id_idx" ON "artifact" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "artifact_session_id_idx" ON "artifact" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_save_file_id_uidx" ON "artifact_save" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_session_userId_idx" ON "auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_pending_email_uq" ON "invitation" USING btree ("organization_id",lower("email")) WHERE "invitation"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_organization_user_uq" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "auto_topup_attempt_workspace_created_idx" ON "auto_topup_attempt" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auto_topup_attempt_one_open_uidx" ON "auto_topup_attempt" USING btree ("workspace_id") WHERE "auto_topup_attempt"."status" in ('creating', 'charging', 'pending');--> statement-breakpoint
CREATE UNIQUE INDEX "auto_topup_attempt_payment_intent_uidx" ON "auto_topup_attempt" USING btree ("stripe_payment_intent_id") WHERE "auto_topup_attempt"."stripe_payment_intent_id" is not null;--> statement-breakpoint
CREATE INDEX "browser_candidate_created_at_idx" ON "browser_candidate" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "browser_candidate_session_id_idx" ON "browser_candidate" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "browser_candidate_browserbase_session_id_uidx" ON "browser_candidate" USING btree ("browserbase_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_grant_workspace_source_ref_uidx" ON "credit_grant" USING btree ("workspace_id","source_ref");--> statement-breakpoint
CREATE INDEX "credit_grant_workspace_expiry_idx" ON "credit_grant" USING btree ("workspace_id","expires_at","issued_at");--> statement-breakpoint
CREATE INDEX "credit_grant_parent_idx" ON "credit_grant" USING btree ("parent_grant_id") WHERE "credit_grant"."parent_grant_id" is not null;--> statement-breakpoint
CREATE INDEX "custom_tool_dispatch_recovery_idx" ON "custom_tool_dispatch" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "custom_tool_dispatch_session_id_idx" ON "custom_tool_dispatch" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "deployment_setting_key_changed_at_idx" ON "deployment_setting" USING btree ("key","changed_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "file_thumbnail_path_idx" ON "file" USING btree ("thumbnail_path");--> statement-breakpoint
CREATE INDEX "file_workspace_id_idx" ON "file" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "file_workspace_folder_path_idx" ON "file" USING btree ("workspace_id","folder_path");--> statement-breakpoint
CREATE INDEX "folder_share_folder_id_idx" ON "folder_share" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "folder_share_workspace_id_idx" ON "folder_share" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "folder_share_file_id_idx" ON "folder_share" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "folder_workspace_path_uidx" ON "folder" USING btree ("workspace_id","path") WHERE "folder"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "integration_workspace_id_idx" ON "integration" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "shared_integration_shared_by_idx" ON "shared_integration" USING btree ("shared_by_user_id");--> statement-breakpoint
CREATE INDEX "message_feedback_session_id_idx" ON "message_feedback" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "message_feedback_workspace_id_created_at_idx" ON "message_feedback" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "message_feedback_message_vote_uidx" ON "message_feedback" USING btree ("session_id","anthropic_event_id","user_id") WHERE "message_feedback"."kind" = 'message';--> statement-breakpoint
CREATE INDEX "model_usage_observation_session_idx" ON "model_usage_observation" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "notification_email_retry_idx" ON "notification" USING btree ("created_at") WHERE "notification"."email_status" in ('pending', 'sending');--> statement-breakpoint
CREATE INDEX "notification_recipient_created_idx" ON "notification" USING btree ("organization_id","recipient_user_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_occurrence_idx" ON "notification" USING btree ("organization_id","recipient_user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "pending_confirmation_tool_use_id_uidx" ON "pending_confirmation" USING btree ("tool_use_id");--> statement-breakpoint
CREATE INDEX "pending_confirmation_session_id_status_idx" ON "pending_confirmation" USING btree ("session_id","status");--> statement-breakpoint
CREATE INDEX "realtime_event_workspace_cursor_idx" ON "realtime_event" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "realtime_event_created_idx" ON "realtime_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "session_workspace_id_last_event_at_idx" ON "session" USING btree ("workspace_id","last_event_at");--> statement-breakpoint
CREATE INDEX "session_status_last_event_at_idx" ON "session" USING btree ("status","last_event_at");--> statement-breakpoint
CREATE INDEX "session_task_id_idx" ON "session" USING btree ("task_id") WHERE "session"."task_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "session_anthropic_session_id_uidx" ON "session" USING btree ("anthropic_session_id") WHERE "session"."anthropic_session_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "session_workspace_active_browser_uidx" ON "session" USING btree ("workspace_id") WHERE "session"."browserbase_session_status" in ('active', 'user', 'acting', 'closing');--> statement-breakpoint
CREATE INDEX "session_file_mount_file_idx" ON "session_file_mount" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "session_file_mount_workspace_idx" ON "session_file_mount" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "session_read_state_workspace_id_idx" ON "session_read_state" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "session_send_session_id_idx" ON "session_send" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_send_recover_after_idx" ON "session_send" USING btree ("recover_after") WHERE "session_send"."recover_after" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "session_share_one_live_per_session" ON "session_share" USING btree ("session_id") WHERE "session_share"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "session_share_workspace_id_idx" ON "session_share" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "session_share_session_id_idx" ON "session_share" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_turn_claim_session_claimed_idx" ON "session_turn_claim" USING btree ("session_id","claimed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_anthropic_skill_id_uidx" ON "skill" USING btree ("anthropic_skill_id") WHERE "skill"."anthropic_skill_id" is not null and "skill"."owner_workspace_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_owner_workspace_id_name_uidx" ON "skill" USING btree ("owner_workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_global_name_uidx" ON "skill" USING btree ("name") WHERE "skill"."owner_workspace_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_file_skill_id_path_uidx" ON "skill_file" USING btree ("skill_id","path");--> statement-breakpoint
CREATE INDEX "task_workspace_id_idx" ON "task" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "task_next_run_at_idx" ON "task" USING btree ("next_run_at") WHERE "task"."status" = 'upcoming';--> statement-breakpoint
CREATE UNIQUE INDEX "task_anthropic_deployment_id_uidx" ON "task" USING btree ("anthropic_deployment_id") WHERE "task"."anthropic_deployment_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "task_composio_trigger_id_uidx" ON "task" USING btree ("composio_trigger_id") WHERE "task"."composio_trigger_id" is not null;--> statement-breakpoint
CREATE INDEX "task_provider_sync_idx" ON "task" USING btree ("sync_claimed_at") WHERE "task"."provider_sync" <> 'synced';--> statement-breakpoint
CREATE INDEX "usage_event_workspace_id_created_at_idx" ON "usage_event" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_event_usage_key_uidx" ON "usage_event" USING btree ("usage_key") WHERE "usage_event"."usage_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_stripe_customer_id_uidx" ON "workspace" USING btree ("stripe_customer_id") WHERE "workspace"."stripe_customer_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_stripe_subscription_id_uidx" ON "workspace" USING btree ("stripe_subscription_id") WHERE "workspace"."stripe_subscription_id" is not null;--> statement-breakpoint
CREATE INDEX "workspace_member_user_id_idx" ON "workspace_member" USING btree ("user_id");