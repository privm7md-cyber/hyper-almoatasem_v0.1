// Disposable, synthetic-only PostgreSQL cluster. Never reuses Primary or Scratch.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import dotenv from 'dotenv';
import { Client } from 'pg';
import argon2 from 'argon2';
const root=path.resolve('_recovery/v1-ops'), data=path.join(root,'pgdata'), bin='C:/pgprov/pg18/bin';
const port=55449, database='hyper_v1_ops_disposable';
const pgtools='C:/pgtools/pg18/pgsql/bin';
const secretFile=path.join(root,'isolated-secrets.json');
const mode=process.argv[2] ?? 'up';
fs.mkdirSync(root,{recursive:true});
const command=(exe,args,env={})=>{
  const r=spawnSync(exe,args,{encoding:'utf8',windowsHide:true,env:{...process.env,...env},...(exe.endsWith('pg_ctl.exe') ? {stdio:'ignore'} : {})});
  if(r.status!==0)throw Error(`${path.basename(exe)} failed: ${r.stderr?.replace(/postgresql:\/\/[^\s]+/g,'[redacted]')}`);
  return r.stdout;
};
const connect=async(url)=>{const c=new Client({connectionString:url});await c.connect();return c;};
const envUrl=(s,role='app',db=database)=>`postgresql://${role==='app'?'hyper_app':'v1_dba'}:${role==='app'?s.appPassword:s.dbaPassword}@127.0.0.1:${port}/${db}`;
if(mode==='up' || mode==='resume-setup') {
  if(mode==='up' && (fs.existsSync(data)||fs.existsSync(secretFile)))throw Error('Refusing to replace an existing isolated cluster.');
  const s=mode==='resume-setup' ? JSON.parse(fs.readFileSync(secretFile)) : {port,database,dbaPassword:crypto.randomBytes(24).toString('hex'),appPassword:crypto.randomBytes(24).toString('hex'),adminPassword:crypto.randomBytes(24).toString('hex'),hmac:crypto.randomBytes(32).toString('hex')};
  if(mode==='up') {
  fs.writeFileSync(secretFile,JSON.stringify(s));
  const pw=path.join(root,'init-password.txt');fs.writeFileSync(pw,s.dbaPassword);
  try {command(`${bin}/initdb.exe`,['-D',data,'-U','v1_dba','-E','UTF8','--locale-provider=builtin','--builtin-locale=C.UTF-8','--auth=scram-sha-256',`--pwfile=${pw}`]);}
  finally{fs.unlinkSync(pw);}
  fs.appendFileSync(path.join(data,'postgresql.conf'),`\nlisten_addresses='127.0.0.1'\nport=${port}\nmax_connections=80\n`);
  command(`${bin}/pg_ctl.exe`,['-D',data,'-l',path.join(root,'postgres.log'),'-w','start']);
  }
  if(mode==='resume-setup' && spawnSync(`${bin}/pg_ctl.exe`,['-D',data,'status'],{stdio:'ignore',windowsHide:true}).status!==0) command(`${bin}/pg_ctl.exe`,['-D',data,'-l',path.join(root,'postgres.log'),'-w','start']);
  const dba=await connect(envUrl(s,'dba','postgres'));
  const proof=(await dba.query("SELECT (pg_control_system()).system_identifier::text cluster, current_setting('data_directory') directory, inet_server_port() port")).rows[0];
  if(proof.port!==port || path.resolve(proof.directory)!==data || proof.cluster==='7687734853145036120')throw Error('Isolation proof failed');
  const local={...dotenv.parse(fs.readFileSync('.env')),...dotenv.parse(fs.readFileSync('.env.local'))};
  const primary=new URL(local.DATABASE_URL);
  if(primary.pathname!=='/hyper_almoatasem'||!['localhost','127.0.0.1'].includes(primary.hostname))throw Error('Primary identity mismatch');
  primary.searchParams.set('options','-c default_transaction_read_only=on');
  const reader=await connect(primary.toString());
  const roles=(await reader.query("SELECT rolname FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY rolname")).rows;
  await reader.end();
  for(const r of roles) {
    if(!/^[a-zA-Z0-9_]+$/.test(r.rolname))throw Error('Unexpected role identifier');
    if(r.rolname==='v1_dba')continue;
    if(!(await dba.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[r.rolname])).rowCount) await dba.query(`CREATE ROLE "${r.rolname}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  }
  await dba.query(`ALTER ROLE hyper_app LOGIN PASSWORD '${s.appPassword}'`);
  if(!(await dba.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount) await dba.query(`CREATE DATABASE ${database} TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8'`);
  await dba.end();
  const empty=await connect(envUrl(s,'dba'));
  if((await empty.query("SELECT 1 FROM pg_tables WHERE schemaname='public'")).rowCount)throw Error('Refusing schema restore into nonempty disposable database');
  await empty.end();
  const sql=command(`${pgtools}/pg_dump.exe`,['--schema-only','--no-comments','--host',primary.hostname,'--port',primary.port||'5432','--username',decodeURIComponent(primary.username),'--dbname','hyper_almoatasem'],{PGPASSWORD:decodeURIComponent(primary.password),PGOPTIONS:'-c default_transaction_read_only=on'});
  const dump=path.join(root,'primary-schema-only.sql');fs.writeFileSync(dump,sql);
  command(`${pgtools}/psql.exe`,['-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',String(port),'-U','v1_dba','-d',database,'-f',dump],{PGPASSWORD:s.dbaPassword});
  const c=await connect(envUrl(s,'dba'));
  const admin='02900000-0000-7000-8000-000000000010';
  await c.query("INSERT INTO roles (id,name,description,is_active) VALUES ('02900000-0000-7000-8000-000000000001','SUPER_ADMIN','Synthetic closure owner',true)");
  await c.query('INSERT INTO users (id,name,email,password_hash,is_active) VALUES ($1, $2, $3, $4, true)',[admin,'مالك تجريبي','owner@hyper-al-moatasem.local',await argon2.hash(s.adminPassword,{type:argon2.argon2id})]);
  await c.query("INSERT INTO user_roles (user_id,role_id) VALUES ($1,'02900000-0000-7000-8000-000000000001')",[admin]);
  const permissions=['products.view','products.create','products.update','products.delete','prices.view','prices.update','inventory.view','inventory.adjust','orders.view','orders.update','orders.cancel','customers.view','customers.update','customers.anonymize','promotions.view','promotions.create','promotions.update','promotions.disable','coupons.view','coupons.create','coupons.update','coupons.disable','delivery.view','delivery.assign','reports.view','users.view','users.manage','roles.view','roles.manage','settings.view','settings.manage','audit.view','audit_logs.view','cost.view'];
  for(const name of permissions) {
    await c.query('INSERT INTO permissions (key,description) VALUES ($1::text,$1::text)',[name]);
    await c.query("INSERT INTO role_permissions (role_id,permission_id) SELECT '02900000-0000-7000-8000-000000000001',id FROM permissions WHERE key=$1",[name]);
  }
  await c.query("INSERT INTO store_settings (key,value_text,value_type) VALUES ('delivery.default_fee','10.00','NUMERIC'),('delivery.enabled','false','BOOLEAN')");
  await c.end();
  s.adminId=admin;fs.writeFileSync(secretFile,JSON.stringify(s));
  fs.writeFileSync(path.join(root,'evidence/isolation.json'),JSON.stringify({...proof,database,syntheticOnly:true,schemaSource:'Primary schema-only read-only dump; zero data copied'},null,2));
  console.log('Disposable cluster provisioned; no Primary/Scratch writes.');
} else {
  const s=JSON.parse(fs.readFileSync(secretFile));
  const c=await connect(envUrl(s,'dba'));
  const proof=(await c.query("SELECT current_database() db, current_setting('data_directory') directory,inet_server_port() port")).rows[0];await c.end();
  if(proof.db!==database||proof.port!==port||path.resolve(proof.directory)!==data)throw Error('Isolation guard failed');
  const isolatedEnv={...process.env,DATABASE_URL:envUrl(s),MIGRATION_DATABASE_URL:envUrl(s,'dba'),RATE_LIMIT_HMAC_SECRET:s.hmac,ADMIN_READ_ONLY_PREVIEW:'0',NEXT_DIST_DIR:'.next-v1-ops',DELIVERY_ELIGIBILITY_POLICY:'reject',V1_OPS_DATABASE_URL:envUrl(s,'dba'),V1_OPS_ADMIN_PASSWORD:s.adminPassword,V1_OPS_ADMIN_ID:s.adminId};
  if(mode==='stop') command(`${bin}/pg_ctl.exe`,['-D',data,'-m','fast','-w','stop']);
  else {
    const args=process.argv.slice(3);if(!args.length)throw Error('Pass a Node script and arguments');
    const child=spawn(process.execPath,args,{env:isolatedEnv,stdio:'inherit',windowsHide:true});
    child.once('exit',code=>{process.exitCode=code ?? 1;});
  }
}
