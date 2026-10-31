import {proveViewerRoleUpgrade} from './viewer-role-upgrade';
import { it } from 'vitest';
import { provePopulatedUpgrade } from './populated-upgrade';
import { exerciseUpgradedIssueTemplates } from './issue-template-upgrade';

it('[PROJ-001 DATA-005 BASE-OPS-002] populated project and previous-head upgrades preserve records and export the extended planning inventory',async()=>{
  await proveViewerRoleUpgrade();
  const {cookie}=await provePopulatedUpgrade('0062_project_fields.sql',{
    until:'0062_project_fields.sql',preserveAfter:'0095_project_templates.sql',
    added:['table project_labels','index project_labels_label_idx','trigger project_dates_insert','trigger project_dates_update','trigger project_label_admission','trigger project_label_update_admission','trigger project_label_usage'],
    changed:['table projects','table labels'],removed:[],
  },['projects','labels']);
  await exerciseUpgradedIssueTemplates(cookie);
},180000);
