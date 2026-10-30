import {env} from 'cloudflare:workers';
import {proveViewerRoleUpgrade} from './viewer-role-upgrade';
import { it } from 'vitest';
import { provePopulatedUpgrade } from './populated-upgrade';

it('[PROJ-001 DATA-005 BASE-OPS-002] populated project and previous-head upgrades preserve records and export the extended planning inventory',async()=>{
  await proveViewerRoleUpgrade();
  await provePopulatedUpgrade('0062_project_fields.sql',{
    until:'0062_project_fields.sql',preserveAfter:'0113_description_thread_anchors.sql',
    added:['table project_labels','index project_labels_label_idx','trigger project_dates_insert','trigger project_dates_update','trigger project_label_admission','trigger project_label_update_admission','trigger project_label_usage'],
    changed:['table projects','table labels'],removed:[],
  },['projects','labels'],undefined,async()=>{
    const issue=(await env.DB.prepare('SELECT id FROM issues LIMIT 1').first<{id:string}>())!.id;
    const actor=(await env.DB.prepare('SELECT id,workspace_id FROM operators LIMIT 1').first<{id:string;workspace_id:string}>())!;
    await env.DB.prepare("INSERT INTO documents(id,workspace_id,parent_kind,parent_id,title,body,author_operator_id,created_at,updated_at) VALUES('01K00000000000000000000031',?,'issue',?,'synthetic-vector-upgrade-document','🧭 café 🧪',?,'2026-10-01','2026-10-01')").bind(actor.workspace_id,issue,actor.id).run();
    await env.DB.prepare("INSERT INTO document_revisions(id,document_id,version,title,body,author_operator_id,created_at) SELECT '01K00000000000000000000032',id,version,title,body,author_operator_id,created_at FROM documents WHERE id='01K00000000000000000000031'").run();
    await env.DB.prepare("UPDATE issue_comments SET description_anchor=? WHERE id='01K00000000000000000000011'").bind(JSON.stringify({quote:'retained legacy quote',start:0,end:21,removed:true})).run();
  });
},180000);
