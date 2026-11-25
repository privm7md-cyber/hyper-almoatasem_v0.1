// @vitest-environment node
import {describe,it,expect,vi} from "vitest";
import {deliveryScopeKey} from "../delivery-scope";
import {resolveDeliveryQuote} from "../delivery-fee";
const zone={id:"z",name:"قرية تجريبية",normalized_name:deliveryScopeKey("مركز أول","قرية تجريبية","village"),fee:"7.25",is_active:true,scope_text:JSON.stringify({city:"مركز أول",locality:"قرية تجريبية",field:"village",eligible:true})};
const db=(rows:unknown[])=>({$queryRaw:vi.fn(async(s:TemplateStringsArray)=>s.join().includes("FROM store_settings WHERE")?[{v:"10.00"}]:rows)});
describe("delivery scopes",()=>{
  it("matches only the specified city and uses the backend zone fee",async()=>{const q=await resolveDeliveryQuote(db([zone]) as never,{city:"مركز أول",village:"قرية تجريبية"});expect(q.eligibility.serviceable).toBe(true);expect(q.fee.fee).toBe("7.25");});
  it("rejects a same-name village in another center even if legacy policy allows",async()=>{const q=await resolveDeliveryQuote(db([zone]) as never,{city:"مركز آخر",village:"قرية تجريبية"});expect(q.eligibility.serviceable).toBe(false);});
  it.each([false,true])("preserves explicit denial when inactive=%s",async inactive=>{const q=await resolveDeliveryQuote(db([{...zone,is_active:!inactive,scope_text:JSON.stringify({city:"مركز أول",locality:"قرية تجريبية",field:"village",eligible:false})}]) as never,{city:"مركز أول",village:"قرية تجريبية"});expect(q.eligibility.serviceable).toBe(false);});
  it("fails closed when stored scoped-zone configuration is absent",async()=>{await expect(resolveDeliveryQuote(db([{...zone,scope_text:null}]) as never,{city:"مركز أول"})).rejects.toThrow("Missing delivery scope");});
  it("does not throw on customer delimiter/oversize text and cannot match it",async()=>{expect((await resolveDeliveryQuote(db([zone]) as never,{city:"|",area:"x"})).eligibility.serviceable).toBe(false);});
});
