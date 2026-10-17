import fs from 'fs';
import path from 'path';

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    if (file === 'node_modules' || file === '.git' || file === '.pgdata' || file === 'dist') return;
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(fullPath));
    } else if (file.endsWith('.mjs') || file.endsWith('.ts') || file.endsWith('.js') || file.endsWith('.md')) {
      results.push(fullPath);
    }
  });
  return results;
}

const groqKey = 'process.env.GROQ_API_KEY || ''';
const geminiKey = 'process.env.GEMINI_API_KEY || ''';

const files = walk(process.cwd());
files.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  if (content.includes(groqKey) || content.includes(geminiKey)) {
    console.log('Sanitizing:', f);
    content = content.replaceAll(groqKey, "process.env.GROQ_API_KEY || ''");
    content = content.replaceAll(geminiKey, "process.env.GEMINI_API_KEY || ''");
    fs.writeFileSync(f, content, 'utf8');
  }
});
