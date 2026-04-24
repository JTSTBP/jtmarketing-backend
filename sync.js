const fs = require('fs');
const content = fs.readFileSync('c:/MyProjects/OfficeProjects/newlovable/backend/worker.js', 'utf8');
const updateScript = `const fs = require('fs');\nconst path = require('path');\nconst newWorker = \`${content.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`;\n\nfs.writeFileSync('worker.js', newWorker);\n`;
fs.writeFileSync('c:/MyProjects/OfficeProjects/newlovable/backend/updateWorker.cjs', updateScript);
