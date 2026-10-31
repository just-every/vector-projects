import type { WorkerBindings } from '../../app/bindings';
import { visibilityDatabase } from '../roles/visibility-database';
import { IntegrationError } from '../integrations/errors';
import { readExport } from './read';
import { exportResources } from './schema';
import { exportScope } from './cursor';

export type ExportRecord={resource:string;id:string;digest:string;row:Record<string,unknown>};
/** Bounded native traversal. Fail visibly rather than silently truncating an
 * installation too large for this first scheduled-export adapter. */
export async function exportSnapshot(env:WorkerBindings,actor:string,team?:string) {
  const db=visibilityDatabase(env.DB,actor),records:ExportRecord[]=[];
  for(const resource of exportResources) {
    let cursor:string|undefined;
    do {
      const page=await readExport(db,actor,resource,{limit:100,team,cursor},env.SESSION_SECRET);
      for(const row of page.rows)records.push({resource,id:String(row.id),digest:await exportScope(row),row});
      if(records.length>20000)throw new IntegrationError(409,'export_capacity_exceeded');
      cursor=page.nextCursor??undefined;
    }while(cursor);
  }
  return records;
}
export function encodeBucketRows(format:'json'|'csv',changes:{resource:string;id:string;operation:string;row:unknown}[]) {
  if(format==='json')return JSON.stringify({version:1,records:changes});
  // Every field is quoted. Prefix spreadsheet formula initiators in metadata;
  // row values are JSON objects and therefore cannot become CSV formulas.
  const cell=(value:string)=>'"'+(/^[=+@\-\t\r]/.test(value)?"'":'')+value.replaceAll('"','""')+'"';
  return 'resource,id,operation,row\r\n'+changes.map(row=>[row.resource,row.id,row.operation,JSON.stringify(row.row)].map(cell).join(',')).join('\r\n')+'\r\n';
}
