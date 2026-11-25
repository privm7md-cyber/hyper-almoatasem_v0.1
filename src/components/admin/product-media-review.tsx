"use client";
import {useEffect,useState} from "react";
import {apiRequest} from "@/lib/frontend/api-client";
type Review={candidates:{id:string;name:string}[];needsReview:boolean;previewReceipt:string|null;metadata?:{digest:string;width:number;height:number};terms?:{code:string;productCode:string;productId:string;source:string;authorized:true;altText:string}};
export function ProductMediaReview(){
  const [file,setFile]=useState<File|null>(null),[url,setUrl]=useState(""),[code,setCode]=useState(""),[productCode,setProductCode]=useState(""),[source,setSource]=useState(""),[altText,setAltText]=useState(""),[authorized,setAuthorized]=useState(false),[productId,setProductId]=useState("");
  const [review,setReview]=useState<Review|null>(null),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[success,setSuccess]=useState("");
  useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);},[url]);
  const invalidate=()=>{setReview(null);setConfirmed(false);setSuccess("");};
  async function preview(){setBusy(true);setError("");try{
    if(!file)throw Error("اختر صورة أولًا.");
    const form=new FormData();form.set("file",file);form.set("input",JSON.stringify({code,productCode,source,altText,authorized,...(productId?{productId}:{})}));
    const response=await fetch("/api/admin/catalog/media-review",{method:"POST",body:form}),json=await response.json();if(!response.ok)throw Error(json.error?.message ?? "تعذرت المعاينة");setReview(json.data);setConfirmed(false);
  }catch(e){setError(e instanceof Error?e.message:"تعذرت المعاينة");}finally{setBusy(false);}}
  async function apply(){if(!review?.terms||!review.metadata)return;setBusy(true);setError("");try{await apiRequest("/api/admin/catalog/media-review",{method:"POST",body:{...review.terms,digest:review.metadata.digest,previewReceipt:review.previewReceipt,confirmed}});setSuccess("تم اعتماد الصورة وإضافتها للمنتج مع سجل المصدر والمراجعة.");setReview(null);setConfirmed(false);}catch(e){setError(e instanceof Error?e.message:"تعذر الاعتماد");}finally{setBusy(false);}}
  return <div className="adm-form"><fieldset disabled={busy} className="adm-form-grid" onChange={invalidate}>
    <label>صورة العبوة<input className="adm-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const selected=e.target.files?.[0]??null;setFile(selected);setUrl(selected?URL.createObjectURL(selected):"");setProductId("");}}/></label>
    <label>الباركود / الكود<input className="adm-input" value={code} onChange={e=>{setCode(e.target.value);setProductId("");}}/></label>
    <label>كود إضافي للتحقق (اختياري)<input className="adm-input" value={productCode} onChange={e=>{setProductCode(e.target.value);setProductId("");}}/></label>
    <label>مرجع المصدر والتصريح<input className="adm-input" value={source} onChange={e=>setSource(e.target.value)} maxLength={300}/></label>
    <label>الوصف البديل للصورة<input className="adm-input" value={altText} onChange={e=>setAltText(e.target.value)} maxLength={200}/></label>
    <label><input type="checkbox" checked={authorized} onChange={e=>setAuthorized(e.target.checked)}/>المصدر مصرح باستخدامه، والصورة تمثل العبوة الفعلية</label>
  </fieldset>
    {/* Local review only; the server decodes and re-encodes before publication. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {url&&<img src={url} alt="معاينة الملف قبل الاعتماد" width={240} height={240} style={{objectFit:"contain"}}/>}
    <button className="adm-btn adm-btn--secondary" disabled={busy||!authorized||!file} onClick={()=>void preview()}>تحقق من الصورة وطابق المنتج</button>
    {error&&<p role="alert">{error}</p>}{success&&<p role="status">{success}</p>}
    {review&&<section aria-label="نتيجة مطابقة الصورة"><p role="status">{review.needsReview?"المطابقة تحتاج مراجعة؛ صحح الكود أو اختر المنتج المقصود وأعد التحقق.":"تم التحقق من ملف الصورة ومطابقة الكود. راجع اسم المنتج وحجم العبوة."}</p>
      {review.candidates.map(p=><label key={p.id}><input type="radio" name="asset-product" checked={productId===p.id||(!review.needsReview&&review.terms?.productId===p.id)} onChange={()=>{setProductId(p.id);invalidate();}}/>{p.name}</label>)}
      {!review.needsReview&&<><p>{review.metadata?.width} × {review.metadata?.height} بكسل</p><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>راجعت الصورة والمنتج والعبوة وأؤكد النشر</label><button className="adm-btn adm-btn--primary" disabled={busy||!confirmed} onClick={()=>void apply()}>اعتماد الصورة</button></>}
    </section>}
  </div>;
}
