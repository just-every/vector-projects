import { cycleReportFactsSql } from "../cycle-report/facts-sql";
/** All facts are selected inside the closing batch, never from preflight JS reads. */
export const snapshotSql = `
WITH closing AS (
 SELECT c.*,w.timezone FROM cycles c JOIN teams t ON t.id=c.team_id
 JOIN workspace_settings w ON w.id=t.workspace_id
 WHERE c.id=? AND t.cycles_enabled=1 AND c.closed_at IS NULL AND julianday(c.ends_at)<=julianday(?)
 AND NOT EXISTS(SELECT 1 FROM vector_restore_status WHERE effects_held=1)
), committed AS (
 SELECT i.identifier,i.project_id,p.name project_name,i.estimate,s.category FROM issues i
 JOIN workflow_statuses s ON s.id=i.status_id JOIN closing c ON c.id=i.cycle_id
 LEFT JOIN projects p ON p.id=i.project_id ORDER BY i.identifier
), scope AS (
 SELECT count(*) total_count,coalesce(sum(category='completed'),0) completed_count,
 coalesce(sum(estimate),0) total_points,coalesce(sum(CASE WHEN category='completed' THEN estimate ELSE 0 END),0) completed_points,
 coalesce(sum(estimate IS NULL),0) missing,
 coalesce(sum(category!='completed' AND estimate IS NULL),0) remaining_missing,
 coalesce(sum(CASE WHEN category!='completed' THEN estimate ELSE 0 END),0) remaining_points
 FROM committed WHERE category NOT IN ('canceled','duplicate')
)
INSERT INTO cycle_snapshots(cycle_id,close_token,closed_at,next_cycle_id,body_json)
SELECT c.id,?,?,
 (SELECT n.id FROM cycles n WHERE n.team_id=c.team_id AND n.closed_at IS NULL AND julianday(n.starts_at)>=julianday(c.ends_at) ORDER BY julianday(n.starts_at),n.id LIMIT 1),
 json_object('closedAt',?,'timezone',c.timezone,'capacity',c.capacity,'reportFacts',${cycleReportFactsSql},
 'committed',(SELECT json_group_array(json_object('identifier',identifier,'projectId',project_id,'projectName',project_name,'estimate',estimate,'category',category)) FROM committed),
 'completed',(SELECT json_group_array(identifier) FROM committed WHERE category='completed'),
 'estimateTotal',(SELECT coalesce(sum(estimate),0) FROM committed),
 'completedEstimateTotal',s.completed_points,
 'progress',json_object('total',CASE WHEN s.missing=0 THEN s.total_points ELSE s.total_count END,
  'completed',CASE WHEN s.missing=0 THEN s.completed_points ELSE s.completed_count END,
  'unit',CASE WHEN s.missing=0 THEN 'points' ELSE 'issue-count' END,
  'percentage',CASE WHEN s.total_count=0 THEN NULL WHEN s.missing=0 THEN (1.0*s.completed_points/s.total_points)*100 ELSE (1.0*s.completed_count/s.total_count)*100 END,
  'capacity',c.capacity,'remainingPoints',CASE WHEN s.remaining_missing=0 THEN s.remaining_points ELSE NULL END,
  'unestimatedRemaining',s.remaining_missing,
  'capacityRisk',CASE WHEN c.capacity IS NULL OR s.remaining_missing>0 THEN 'unknown' WHEN s.remaining_points>c.capacity THEN 'at-risk' ELSE 'within-capacity' END),
 'changes',(SELECT json_group_array(json_object('identifier',identifier,'direction',direction,'at',occurred_at)) FROM
   (SELECT identifier,direction,occurred_at FROM cycle_membership_events e WHERE e.cycle_id=c.id
    AND julianday(e.occurred_at)>=julianday(c.starts_at) AND julianday(e.occurred_at)<julianday(c.ends_at) ORDER BY e.occurred_at,e.id))
 ) FROM closing c CROSS JOIN scope s`;
