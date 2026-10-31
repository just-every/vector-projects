import { z } from 'zod';
export const githubPayload=z.object({
 action:z.enum(['opened','edited','closed','reopened','synchronize','review_requested','ready_for_review']),number:z.number().int().positive(),
 repository:z.object({full_name:z.string().min(1).max(200)}),
 pull_request:z.object({number:z.number().int().positive(),title:z.string().max(500),body:z.string().max(100000).nullable(),html_url:z.string().max(2000),state:z.enum(['open','closed']),merged:z.boolean(),draft:z.boolean().optional(),head:z.object({ref:z.string().max(1024),sha:z.string().regex(/^[a-f0-9]{40}$/i).transform(s=>s.toLowerCase()).optional()}).optional(),merge_commit_sha:z.string().regex(/^[a-f0-9]{40}$/i).nullable().optional(),updated_at:z.string().datetime({offset:true})}),
});
export function githubReferences(...texts:(string|null|undefined)[]){
 return [...new Set((texts.filter(Boolean).join('\n').match(/\b[A-Z][A-Z0-9_]{1,99}-[1-9][0-9]*\b/gi)??[]).map(key=>key.toUpperCase()))].sort();
}
export function githubReferenceKind(key:string,...texts:(string|null|undefined)[]):'closes'|'contributes'|'reference'{
 const text=texts.filter(Boolean).join('\n'), escaped=key.replace(/[.*+?^\$()|[\]\\]/g,'\\$&');
 if(new RegExp('\\b(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)\\s+(?:#)?'+escaped+'\\b','i').test(text))return 'closes';
 if(new RegExp('\\b(?:part of|refs|related to|contributes to)\\s+(?:#)?'+escaped+'\\b','i').test(text))return 'contributes';
 return 'reference';
}
