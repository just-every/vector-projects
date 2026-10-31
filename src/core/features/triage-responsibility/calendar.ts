import {localTimeToInstant} from '../administration/calendar';
import {calendarDay,addDays} from '../cycle-schedule/calendar';
/** Calendar weeks retain the workspace wall time across offset changes.
 * A non-unique boundary waits for the first unambiguous minute afterwards. */
function boundary(local:string,timezone:string){
 for(let minute=0;minute<=180;minute++){
  const candidate=new Date(Date.parse(local+':00Z')+minute*60000).toISOString().slice(0,16);
  try{return localTimeToInstant(candidate,timezone);}catch(error){if(minute===180)throw error;}
 }
 throw new Error('Unavailable handover time.');
}
export function rotationPeriod(startsLocal:string,timezone:string,count:number,now:Date){
 const at=now.toISOString(),day=calendarDay(at,timezone),first=startsLocal.slice(0,10),time=startsLocal.slice(10);
 const days=Math.round((Date.parse(day+'T12:00Z')-Date.parse(first+'T12:00Z'))/86400000);
 let week=Math.max(0,Math.floor(days/7));
 let start=boundary(addDays(first,week*7)+time,timezone);
 if(start>at)week--;
 if(week<0)return null;
 start=boundary(addDays(first,week*7)+time,timezone);
 return {position:week%count,startsAt:start,nextAt:boundary(addDays(first,(week+1)*7)+time,timezone)};
}
