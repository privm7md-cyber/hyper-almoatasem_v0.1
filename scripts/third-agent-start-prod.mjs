import "dotenv/config";
import { spawn } from "node:child_process";
import fs from "node:fs";
const REPO="D:/Hyper_el-moatasem";
const OUT="D:/Hyper_Data_Review/Third_Agent_Final_Acceptance/Run_20261107_211349";
const PORT=process.argv[2]||"3233";
const TRUSTED=process.argv[3]||"1";
const DIST=process.argv[4]||".next-closure-verify";
const base=new URL(process.env.MIGRATION_DATABASE_URL);
base.pathname="/hyper_almoatasem_e2e_20261106";
const e2eUrl=base.toString();
const logPath=OUT+"/Logs/third-prod-"+PORT+".log";
fs.mkdirSync(OUT+"/Logs",{recursive:true});
const log=fs.createWriteStream(logPath,{flags:"a"});
const nextBin=REPO+"/node_modules/next/dist/bin/next";
const child=spawn(process.execPath,[nextBin,"start","-p",PORT],{
 cwd:REPO,
 env:{...process.env,NODE_ENV:"production",NEXT_DIST_DIR:DIST,DATABASE_URL:e2eUrl,MIGRATION_DATABASE_URL:e2eUrl,PORT,
  TRUSTED_PROXY:TRUSTED,
  REG_RATE_LIMIT_PHONE_SECRET:"9f".repeat(32)},
 stdio:["ignore","pipe","pipe"],detached:true});
child.stdout.on("data",d=>log.write(d));
child.stderr.on("data",d=>log.write(d));
child.on("exit",code=>fs.appendFileSync(logPath,"\nSERVER-EXIT="+code+"\n"));
child.unref();
fs.writeFileSync(OUT+"/Logs/third-prod-"+PORT+".pid",String(child.pid));
console.log("STARTED pid="+child.pid+" port="+PORT+" trusted="+TRUSTED+" dist="+DIST);
