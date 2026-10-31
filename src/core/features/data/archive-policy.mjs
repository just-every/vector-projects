// Document issue references retain live and removed backlinks as portable domain data.
// Webhook event selections and team filters are portable configuration. Restored
// event history remains held and destination secrets still require re-entry.
// Comment description anchors are portable domain data; deletion clears their retained quotes.
// Initiative channel bindings are portable domain configuration, like vector_channel_bindings.
// Initiative destination approvals and scoped binding custody are portable domain configuration; approvals name
// provider identities, never credentials, and a restored Discord copy still needs its webhook re-entered.
// Destination credentials remain excluded in vector_integration_secret_keys and require re-entry.
// OAuth registrations and member consent are installation credentials; restore requires fresh registration and consent.
// Documents, revisions, comments and issue specifications are portable domain data, retained with their parent identities.
// The verified Slack team ID is portable installation identity, never a credential; restored installations still require credential re-entry.
// Slack event receipts are portable identifier-only replay history; secrets and member links remain excluded.
// 0100 changes only the subscription capture trigger; inventory columns and portable event history stay unchanged.
// issue_reactions retains description/comment targets, emoji, actor and creation time as portable domain data.
// operators.role retains the Viewer grant; invitation grants remain excluded credentials.
// issue_deletions.team_id is retained receipt access state; older unscoped receipts remain Owner-only.
// teams.is_private is portable domain access state, restored with its memberships.
// Domain identities and history stay portable; authentication is established at the destination.
// Triage rotations and consumed creation receipts are portable domain state.
// Scheduling never reconstructs notices from restored receipts.
export const portabilityPolicy = {
 product: 'just-every/vector-projects',
 excludeTables: ['agent_door_state', 'agent_door_agents', 'agent_door_audit', 'agent_door_calls', 'agent_door_approvals', 'agent_door_reviews', 'agent_door_events', 'agent_door_usage', 'bs_settings', 'bs_overrides', 'bs_logo', 'bs_team', 'bs_audit', 'bs_assert', 'vector_oauth_apps', 'vector_oauth_codes', 'vector_oauth_grants', 'calendar_feed_tokens', 'subissue_progress_events', 'operator_sessions', 'magic_links', 'local_mail_outbox', 'access_rate_limits', 'notification_development_mail', 'vector_restore_status', 'vector_restore_operator_grants', 'vector_restore_mail_holds', 'notification_channel_restore_holds', 'integration_tokens', 'vector_integration_secret_keys', 'vector_webhook_restore_holds', 'vector_integration_authority_guard', 'vector_http_bootstrap', 'vector_http_restore', 'vector_slack_member_links', 'vector_slack_request_keys', 'vector_invitation_roles'],
 includeTables: ['oa_operators'],
 replaceableTables: ['search_index_state', 'issue_list_revision', 'subscription_clock'],
 derivedTables: ['search_issues', 'search_projects', 'search_views'],
 secretColumns: { team_email_intake: ['event_verification_key'], notification_digest_batches: ['claim_token'], notification_deliveries: ['claim_token'], ik_jobs: ['lease_token'], integration_deliveries: ['claim'] },
 buckets: { FILES: {} },
 requiredConfiguration: ['FIRST_OWNER_EMAIL', 'SESSION_SECRET', 'APP_ORIGIN', 'MAIL_MODE', 'MAIL_FROM'],
};

// Older archives name the retired setup credential. Match that inventory only;
// keep the original manifest intact because both archive digests authenticate it.
export function archiveImportPolicy(manifest) {
 const names=manifest?.requiredConfiguration,current=portabilityPolicy.requiredConfiguration;
 if(Array.isArray(names)&&names.length===current.length+1&&names.includes('SETUP_TOKEN')&&
  JSON.stringify(names.filter(name=>name!=='SETUP_TOKEN'))===JSON.stringify(current)) {
  return {...portabilityPolicy,requiredConfiguration:[...names]};
 }
 return portabilityPolicy;
}
