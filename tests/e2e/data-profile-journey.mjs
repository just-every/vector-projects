import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {beforePrivateNavigation} from './collaboration-navigation.mjs';

/** DATA-015: Huly JSON review and reconciliation through Settings at both sizes. */
export async function exerciseProfileBrowser({page,runtime,team,status,width,evidence}) {
 await page.setViewportSize({width,height:width===390?844:1000});
 await beforePrivateNavigation(page,runtime.base+'/app/settings/move-in');await page.goto(runtime.base+'/app/settings/move-in');
 const panel=page.locator('#data');await panel.getByRole('heading',{name:'Data / Move in',exact:true}).waitFor();
 for(const format of ['plane-csv','shortcut-csv','huly-json'])await panel.getByLabel('File format',{exact:true}).selectOption(format);
 await panel.getByLabel('Import source name',{exact:true}).fill('huly-ui-'+width);
 await panel.getByLabel('Issue export file',{exact:true}).setInputFiles({name:'huly.json',mimeType:'application/json',buffer:await readFile(new URL('../fixtures/import/huly.json',import.meta.url))});
 await panel.locator('.import-file-fields').screenshot({path:`${evidence}/DATA-015-source-${width}.png`});
 await panel.getByLabel('Default team',{exact:true}).selectOption(team.id);
 await panel.getByLabel('Field to match',{exact:true}).selectOption('status');
 await panel.getByLabel('Name in your file',{exact:true}).fill('Ready');
 await panel.getByLabel('Value in Vector',{exact:true}).selectOption(status.id);
 await panel.getByRole('button',{name:'Add name mapping',exact:true}).click();
 await panel.getByRole('button',{name:'Preview import',exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:`${evidence}/DATA-015-configure-${width}.png`});
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/data/import/preview'&&r.request().method()==='POST');
 await panel.getByRole('button',{name:'Preview import',exact:true}).click();const previewResponse=await response;
 assert.equal(previewResponse.status(),200);const review=await previewResponse.json();assert.equal(review.ready,true);assert.equal(review.count,2);assert.equal(review.omissions.length,5);
 const reviewPanel=panel.locator('.import-review');await reviewPanel.getByRole('heading',{name:'Review 2 source rows',exact:true}).waitFor();
 await reviewPanel.screenshot({path:`${evidence}/DATA-015-review-${width}.png`});
 await panel.getByLabel('I reviewed these omissions.',{exact:true}).check();
 const applied=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/data/import/apply'&&r.request().method()==='POST');
 await panel.getByRole('button',{name:'Apply reviewed run',exact:true}).click();const appliedResponse=await applied;assert.equal(appliedResponse.status(),200);const run=await appliedResponse.json();
 const row=panel.locator('.import-runs > li').filter({has:page.getByText(run.id,{exact:true})});
 await row.getByText(/Completed ·/).waitFor();
 await row.getByRole('button',{name:'Reconciliation report',exact:true}).click();
 const report=row.locator('.import-report');await report.getByRole('heading',{name:'Reconciliation report: huly-ui-'+width,exact:true}).waitFor();
 await report.getByRole('heading',{level:3}).scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/DATA-015-report-viewport-${width}.png`});
 await report.screenshot({path:`${evidence}/DATA-015-report-${width}.png`});
 assert.match(await report.innerText(),/2 Vector issues/);assert.match(await report.innerText(),/5 values/);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 console.log('[DATA-015] Huly browser review, staged apply and reconciliation passed at '+width+'.');
}
