import fs from 'node:fs';
const bases = [
  'C:/Users/MEGA/AppData/Local/ms-playwright',
  'C:/Users/MEGA/AppData/Local/Temp',
];
for (const b of bases) {
  console.log('BASE', b, fs.existsSync(b));
  if (fs.existsSync(b)) {
    for (const e of fs.readdirSync(b)) console.log(' ', e);
  }
}
// try google chrome
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
console.log('chrome exists', fs.existsSync(chrome));
if (fs.existsSync(chrome)) {
  console.log('ok');
}
