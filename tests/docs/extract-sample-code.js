// Extract the fenced ts examples from SAMPLE.md and write them to .tmp-verify,
// so the documented code is typechecked against the real shipped templates.
const fs = require('fs');

const WORK = process.argv[2] || '.tmp-sample-verify';
const md = fs.readFileSync('SAMPLE.md', 'utf8');
const lines = md.split(/\r?\n/);

/** Collect the lines of the fenced block whose first line is `// <marker>`. */
function grab(marker) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '// ' + marker) continue;
    // Walk back to the opening fence, forward to the closing one.
    const out = [];
    for (let j = i; j < lines.length; j++) {
      if (lines[j].startsWith('```')) break;
      out.push(lines[j]);
    }
    return out.join('\n');
  }
  throw new Error('block not found: ' + marker);
}

const targets = [
  ['pages/login.page.ts', WORK + '/pages/login.page.ts'],
  ['pages/dashboard.page.ts', WORK + '/pages/dashboard.page.ts'],
  ['tests/e2e/login.spec.ts', WORK + '/tests/e2e/login.spec.ts'],
];

for (const [marker, out] of targets) {
  let code = grab(marker);
  // login.page.ts references DashboardPage; the doc omits the import for brevity.
  if (marker === 'pages/login.page.ts' && !code.includes('dashboard.page')) {
    code = code.replace(
      "import { BasePage } from './base.page';",
      "import { BasePage } from './base.page';\nimport { DashboardPage } from './dashboard.page';",
    );
  }
  fs.writeFileSync(out, code + '\n');
  console.log('extracted ' + marker + ' (' + code.split('\n').length + ' lines)');
}
