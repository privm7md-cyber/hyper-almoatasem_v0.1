import { chromium } from 'playwright';
import fs from 'node:fs';
console.log(chromium.executablePath());
console.log(fs.existsSync(chromium.executablePath()));
