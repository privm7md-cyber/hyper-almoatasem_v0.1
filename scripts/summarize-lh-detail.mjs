import fs from 'node:fs';
import path from 'node:path';
const dir = 'D:/Hyper_Data_Review/Final_Project_Closure/Run_20261106_150414/Lighthouse';
const files = fs.readdirSync(dir).filter(x=>x.endsWith('.json'));
for (const f of files.sort()) {
  const j = JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
  const a = j.audits || {};
  console.log(`\n=== ${f} ===`);
  console.log(' fetchTime', j.fetchTime, ' config', j.config?.formFactor, j.config?.throttling?.method, 'finalUrl', j.finalUrl?.slice(0,160));
  for (const id of ['server-response-time','first-contentful-paint','largest-contentful-paint','speed-index','interactive','cumulative-layout-shift','total-blocking-time','mainthread-work-breakdown','bootup-time','unused-javascript','render-blocking-resources','prioritize-lcp-image','uses-responsive-images','efficient-animated-content','network-requests','network-rtt','network-throughput','resource-summary','dom-size','long-tasks','interaction-to-next-paint']) {
    const x=a[id]; if(!x) continue;
    // details summary
    let extra='';
    if(id==='server-response-time') extra=`sv=${x.score} dv=${x.displayValue} root=${x.details?.overallSavingsMs||''} items=${(x.details?.items||[]).length}`;
    else if(id==='network-requests') extra=`count=${x.details?.items?.length}`;
    else if(id==='mainthread-work-breakdown') extra=`items=${JSON.stringify((x.details?.items||[]).map(i=>[i.group,i.duration?.toFixed(0)]))}`;
    else if(id==='bootup-time') extra=`items=${JSON.stringify((x.details?.items||[]).map(i=>[i.url?.slice(-60),i.scripting?.toFixed(0)]))}`;
    else if(id==='unused-javascript') extra=`items=${JSON.stringify((x.details?.items||[]).map(i=>[i.url?.slice(-50), i.totalBytes, i.wastedBytes]))}`;
    else if(id==='long-tasks') extra=`thr=${x.details?.overallSavingsMs} count=${x.details?.items?.length} max=${Math.max(...(x.details?.items||[]).map(i=>i.duration||0),0)}`;
    else extra=`score=${x.score} dv=${x.displayValue}`;
    console.log(` - ${id}: ${extra}`);
  }
}
