import {populateGithubReviewUpgrade} from './github-review-upgrade';
import {it} from 'vitest';
import {provePopulatedUpgrade} from './populated-upgrade';
// 0038-0042 are Base operator-auth's sign-in ledgers; 0043 and 0044 are import-kit's
// retirement journal and indexed reversal fences, which replace one stream trigger.
// Bound this historical schema comparison at 0044; the helper still applies all
// newer migrations before proving data preservation, owner sign-in and archives.
it('[BASE-ACCESS-002 DATA-011] a populated store keeps every row, index and trigger when Base sign-in ledgers, import retirement and reversal fences are added, and the owner signs in after',async()=>provePopulatedUpgrade('0038_identity_providers.sql',{
 added:[
  'table oa_auth_audit','table oa_auth_settings','table oa_credentials','table oa_domain_rules','table oa_identity_provider_health','table oa_identity_providers',
  'table oa_logout_events','table oa_oidc_limits','table oa_oidc_transactions','table oa_provider_session_pins','table oa_provider_sessions','table oa_setup_links','table oa_step_up_challenges',
  'index oa_oidc_transactions_expiry','index oa_provider_session_identity','index oa_step_up_session',
  'trigger oa_first_setup_provider_setting','trigger oa_native_claim_closes_provider_setup',
  'table ik_d1_erasure_journal','table ik_d1_erasure_tally','table ik_d1_retirements','index ik_d1_erasure_journal_time',
  'trigger ik_d1_erasure_journal_delete','trigger ik_d1_erasure_journal_insert','trigger ik_d1_erasure_journal_update','trigger ik_d1_retirement_delete','trigger ik_d1_retirement_insert','trigger ik_d1_retirement_update',
  'table ik_d1_reversal_fences','index ik_d1_history_source','index ik_provenance_job','index ik_provenance_source','index ik_sources_job',
 ],until:'0044_import_reversal_fence.sql',removed:[],changed:['trigger ik_d1_stream_revision_update'],signIn:'after',
},['cycles','issues','issue_comments','issue_files','evidence_revisions','operators','oa_sessions','oa_tokens','integration_tokens','vector_github_pull_requests','vector_github_issue_links','vector_github_deliveries'],populateGithubReviewUpgrade),120_000);
