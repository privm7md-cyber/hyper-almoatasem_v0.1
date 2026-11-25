import {Client} from 'pg';
import fs from 'node:fs';
const c=new Client({connectionString:process.env.V1_OPS_DATABASE_URL});await c.connect();
const proof=(await c.query("SELECT current_database() db,inet_server_port() port")).rows[0];
if(proof.db!=='hyper_v1_ops_disposable'||proof.port!==55449)throw Error('Isolated seed guard');
const admin='02900000-0000-7000-8000-000000000010';
const permissions=['products.view','products.create','products.update','products.delete','prices.view','prices.update','inventory.view','inventory.adjust','orders.view','orders.update','orders.cancel','customers.view','customers.update','customers.anonymize','promotions.view','promotions.create','promotions.update','promotions.disable','coupons.view','coupons.create','coupons.update','coupons.disable','delivery.view','delivery.assign','reports.view','users.view','users.manage','roles.view','roles.manage','settings.view','settings.manage','audit.view','audit_logs.view','cost.view'];
for(const key of permissions){
  await c.query('INSERT INTO permissions (key,description) VALUES ($1::text,$1::text) ON CONFLICT(key) DO NOTHING',[key]);
  await c.query("INSERT INTO role_permissions (role_id,permission_id) SELECT '02900000-0000-7000-8000-000000000001',id FROM permissions WHERE key=$1 ON CONFLICT DO NOTHING",[key]);
}
await c.query("INSERT INTO store_settings (key,value_text,value_type) VALUES ('delivery.default_fee','10.00','NUMERIC'),('delivery.enabled','false','BOOLEAN') ON CONFLICT(key) DO NOTHING");
const cluster=(await c.query("SELECT (pg_control_system()).system_identifier::text cluster,current_setting('data_directory') directory")).rows[0];
const file='_recovery/v1-ops/isolated-secrets.json',s=JSON.parse(fs.readFileSync(file));s.adminId=admin;fs.writeFileSync(file,JSON.stringify(s));
fs.writeFileSync('_recovery/v1-ops/evidence/isolation.json',JSON.stringify({...proof,...cluster,syntheticOnly:true,schemaSource:'Primary schema-only read-only dump; zero data copied'},null,2));
await c.end();console.log('Synthetic administrator/permissions/settings ready.');
