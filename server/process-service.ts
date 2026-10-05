import { spawn, ChildProcess } from 'node:child_process';

/** Processes created by these services have their own POSIX process group. */
export function terminateProcessTree(child: ChildProcess, force = false): void {
  const signal = force ? 'SIGKILL' : 'SIGTERM';
  const send = (sig: NodeJS.Signals) => {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, sig);
      else child.kill(sig);
    } catch (error: any) { if (error.code !== 'ESRCH') { try { child.kill(sig); } catch {} } }
  };
  send(signal);
  if (!force) { const timer = setTimeout(() => send('SIGKILL'), 1000); timer.unref(); }
}

export async function runProcess(command: string, args: string[], cwd = process.cwd(), timeoutMs = 60000, onStderr?: (text: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let stdout = '', stderr = '', failure: Error | null = null;
    const timer = setTimeout(() => { failure = new Error(`Timeout após ${timeoutMs}ms: ${command}`); terminateProcessTree(child); }, timeoutMs);
    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { const text = data.toString(); stderr += text; onStderr?.(text); });
    child.once('error', error => { failure = error; });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (failure || signal || code !== 0) {
        const error = failure || new Error(`Comando falhou: ${command} (status=${code}, signal=${signal || 'nenhum'})`);
        Object.assign(error, { stdout, stderr, code, signal }); reject(error);
      } else resolve(stdout);
    });
  });
}
