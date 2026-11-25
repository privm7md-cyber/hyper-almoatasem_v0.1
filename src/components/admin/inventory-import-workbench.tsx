"use client";
import { useRef, useState } from "react";
import { apiRequest } from "@/lib/frontend/api-client";
import { adminErrorMessage } from "@/lib/admin/errors";
import { differencesCsv, type StockImportInput, type StockDifference } from "@/lib/inventory/import-validation";
import type { ImportFileTable } from "@/lib/inventory/import-file";
import { Panel } from "@/components/admin/ui/surfaces";

type Preview={applied:boolean;importId:string|null;previewReceipt:string|null;summary:{total:number;accepted:number;rejected:number;created:number;changed:number;unchanged:number};differences:StockDifference[]};
const fields=[['code','الباركود / كود الصنف'],['productCode','كود إضافي للمطابقة (اختياري)'],['quantity','الرصيد الفعلي الإجمالي'],['unit','وحدة رصيد المخزون'],['sourcePrice','سعر المصدر للمراجعة فقط (اختياري)']] as const;
export function InventoryImportWorkbench() {
  const [table,setTable]=useState<ImportFileTable|null>(null),[mapping,setMapping]=useState<Record<string,string>>({});
  const [unit,setUnit]=useState(""),[source,setSource]=useState(""),[asOf,setAsOf]=useState(""),[reason,setReason]=useState("");
  const [preview,setPreview]=useState<Preview|null>(null),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const fileRef=useRef<File|null>(null), submitted=useRef<StockImportInput|null>(null);
  const invalidate=()=>{setPreview(null);setConfirmed(false);submitted.current=null;};
  async function upload(file:File,sheet?:string) {
    invalidate();setBusy(true);setError("");
    try {
      const data=new FormData();data.set("file",file);if(sheet)data.set("sheet",sheet);
      const response=await fetch("/api/admin/inventory/import/file",{method:"POST",body:data});
      const json=await response.json();if(!response.ok)throw Error(json.error?.message ?? "تعذر قراءة الملف");
      setTable(json.data);setMapping({});fileRef.current=file;
    }catch(e){setError(e instanceof Error ? e.message : "تعذر قراءة الملف");setTable(null);}finally{setBusy(false);}
  }
  async function run(apply:boolean) {
    setBusy(true);setError("");
    try {
      if(!table || !asOf || (!mapping.code && !mapping.productCode) || !mapping.quantity || (!mapping.unit && !unit)) throw Error("حدد المصدر والتوقيت وأعمدة الكود والرصيد ووحدة المخزون.");
      const cell=(cells:string[],key:string)=>mapping[key] ? cells[Number(mapping[key])-1] ?? "" : "";
      const input:StockImportInput=apply && submitted.current ? {...submitted.current,dryRun:false,confirmed,previewReceipt:preview?.previewReceipt ?? undefined} : {
        source,asOf:new Date(asOf).toISOString(),location:"GLOBAL",reason,dryRun:true,
        rows:table.rows.map(r=>({row:r.row,code:cell(r.cells,"code"),productCode:cell(r.cells,"productCode"),quantity:cell(r.cells,"quantity"),unit:cell(r.cells,"unit") || (mapping.unit ? "" : unit),sourcePrice:cell(r.cells,"sourcePrice")}))
      };
      const result=await apiRequest<Preview>("/api/admin/inventory/import",{method:"POST",body:input});
      if(!apply)submitted.current=input;
      setPreview(result.data);setConfirmed(false);
    } catch(e){setError(e instanceof Error && !("status" in e) ? e.message : adminErrorMessage(e,"تعذر تنفيذ الاستيراد. راجع المعاينة مجددًا."));if(apply)invalidate();}finally{setBusy(false);}
  }
  function download(rejectedOnly:boolean) {
    if(!preview)return;
    const url=URL.createObjectURL(new Blob([differencesCsv(preview.differences.filter(r=>!rejectedOnly || r.status==="rejected"))],{type:"text/csv;charset=utf-8"}));
    const a=document.createElement("a");a.href=url;a.download=rejectedOnly ? "stock-errors.csv" : "stock-differences.csv";a.click();URL.revokeObjectURL(url);
  }
  return <div className="adm-form">
    <Panel title="١. المصدر وربط الأعمدة" sub="CSV UTF-8 أو XLSX حتى 5 MB و20,000 صف. الخلايا الحسابية والمندمجة مرفوضة. الكود نص يحافظ على الأصفار الأولى.">
      <fieldset disabled={busy} className="adm-form-grid" onChange={invalidate}>
        <label>الملف<input className="adm-input" type="file" accept=".csv,.xlsx" onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);}} /></label>
        {table && <label>ورقة العمل<select className="adm-select" value={table.sheet} onChange={e=>{if(fileRef.current)void upload(fileRef.current,e.target.value);}}>{table.sheets.map(s=><option key={s}>{s}</option>)}</select></label>}
        <label>مرجع المصدر المعتمد<input className="adm-input" value={source} onChange={e=>setSource(e.target.value)} maxLength={120} /></label>
        <label>وقت الرصيد (التوقيت المحلي)<input className="adm-input" type="datetime-local" value={asOf} onChange={e=>setAsOf(e.target.value)} /></label>
        <label>سبب الاستيراد<input className="adm-input" value={reason} onChange={e=>setReason(e.target.value)} maxLength={500} /></label>
        {table && fields.map(([key,label])=><label key={key}>{label}<select className="adm-select" value={mapping[key]??""} onChange={e=>setMapping({...mapping,[key]:e.target.value})}><option value="">اختر العمود</option>{table.headers.map((h,i)=><option key={h} value={i+1}>{h}</option>)}</select></label>)}
        {!mapping.unit && <label>وحدة موحدة معتمدة لكل الصفوف<select className="adm-select" value={unit} onChange={e=>setUnit(e.target.value)}><option value="">اختر صراحة</option><option value="PIECE">PIECE — عدد العبوات</option><option value="KG">KG — كيلوجرام مباع بالوزن</option><option value="GRAM">GRAM — جرام مباع بالوزن</option></select></label>}
      </fieldset>
      <p>الاستيراد لرصيد الموقع الإجمالي فقط (GLOBAL)، وليس الرصيد المتاح بعد الحجز. الخانة الفارغة مخزون مجهول؛ الصفر رصيد مؤكد. لا تدمج الفروع أو المخازن دون مراجعة.</p>
      {table && <p>عدد صفوف الملف غير الفارغة: {table.rows.length}. يشمل الرفض صفوف العناوين الناقصة.</p>}
      <button className="adm-btn adm-btn--secondary" disabled={busy || !table} onClick={()=>void run(false)}>معاينة الاستيراد دون كتابة</button>
    </Panel>
    {error && <p role="alert" className="adm-note adm-note--danger">{error}</p>}
    {preview && <Panel title="٢. الفروق والتأكيد">
      <p role="status">الإجمالي {preview.summary.total} | مقبول {preview.summary.accepted} | مرفوض {preview.summary.rejected} | إنشاء {preview.summary.created} | تعديل {preview.summary.changed} | دون تغيير {preview.summary.unchanged}</p>
      <div className="adm-btn-row"><button className="adm-btn adm-btn--secondary" onClick={()=>download(false)}>تنزيل تقرير الفروق</button><button className="adm-btn adm-btn--secondary" onClick={()=>download(true)}>تنزيل الصفوف المرفوضة</button></div>
      <div className="adm-table-scroll"><table className="adm-table"><caption>أول 200 صف — التقرير القابل للتنزيل يتضمن جميع الصفوف</caption><thead><tr>{["الصف","الكود","المنتج","قبل","بعد","الفرق","النتيجة"].map(h=><th scope="col" key={h}>{h}</th>)}</tr></thead><tbody>{preview.differences.slice(0,200).map(r=><tr key={r.row}><td>{r.row}</td><td>{r.code}</td><td>{r.name??"—"}</td><td>{r.before??"مجهول"}</td><td>{r.after??"—"}</td><td>{r.delta??"رصيد افتتاحي"}</td><td>{r.errors.join("، ") || "مقبول"} {r.warnings.join("، ")}</td></tr>)}</tbody></table></div>
      {preview.applied ? <p role="status">اكتمل الاستيراد: {preview.importId}. احتفظ بالتقرير للمطابقة؛ التصحيح يحتاج معاينة جديدة.</p> : <><label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)} />أؤكد صحة المصدر وتوقيت الرصيد ووحدة كل صنف، وأوافق على تطبيق {preview.summary.accepted} صف مقبول فقط مع استبعاد {preview.summary.rejected} صف مرفوض.</label><button className="adm-btn adm-btn--primary" disabled={busy || !confirmed || !preview.summary.accepted} onClick={()=>void run(true)}>تطبيق الأرصدة المعتمدة</button></>}
    </Panel>}
  </div>;
}
