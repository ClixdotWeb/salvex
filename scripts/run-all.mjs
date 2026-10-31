// Start the backend (FastAPI) and the website together with one command.
//
//   npm run dev:all     backend + website in development mode (both reload on code changes)
//   npm run start:all   build the website, then backend + the built website (vite preview, port 5173)
//
// Both use the backend's virtual environment in backend/.venv. Ctrl+C stops both.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = join(root, 'backend');
const preview = process.argv.includes('--preview');

const python = process.platform === 'win32'
  ? join(backendDir, '.venv', 'Scripts', 'python.exe')
  : join(backendDir, '.venv', 'bin', 'python');

if (!existsSync(python)) {
  console.error(`Backend virtual environment not found at ${python}.\nCreate it first: see backend/README.md (python -m venv .venv, pip install -r requirements.txt).`);
  process.exit(1);
}

const COLORS = { api: '\x1b[35m', web: '\x1b[36m' };
const RESET = '\x1b[0m';

const children = [];
let stopping = false;

function run(name, command, args, cwd) {
  const child = spawn(command, args, { cwd, shell: process.platform === 'win32' && command === 'npx', env: process.env });
  const prefix = `${COLORS[name]}[${name}]${RESET} `;
  const pipe = (stream, out) => {
    let buffered = '';
    stream.on('data', (chunk) => {
      buffered += chunk.toString();
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop();
      for (const line of lines) out.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (!stopping) {
      console.log(`${prefix}stopped (exit code ${code}). Stopping the other one too.`);
      stopAll(code ?? 1);
    }
  });
  children.push(child);
}

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });   // ends the whole process tree
    } else {
      child.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(code), 500);
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

const uvicornArgs = ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000'];
if (!preview) uvicornArgs.push('--reload');
run('api', python, uvicornArgs, backendDir);
// Port 5173 in both modes: the backend only accepts requests from the origins in FRONTEND_ORIGINS (5173).
run('web', 'npx', preview ? ['vite', 'preview', '--port', '5173', '--strictPort'] : ['vite'], root);

console.log(preview
  ? 'Backend: http://127.0.0.1:8000   Website (built): http://localhost:5173   Ctrl+C stops both.'
  : 'Backend: http://127.0.0.1:8000   Website: http://localhost:5173   Ctrl+C stops both.');
