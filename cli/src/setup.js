import { fileURLToPath } from 'node:url';
export function setupCommand(client, { node = process.execPath, entry = fileURLToPath(new URL('../bin/chog.js', import.meta.url)), platform = process.platform, home = process.env.CHOG_HOME, rpc = process.env.CHOG_RPC_URL } = {}) {
  if (!['codex', 'claude-code'].includes(client)) throw Error('Choose codex or claude-code.');
  const quote = value => "'" + String(value).replaceAll("'", platform === 'win32' ? "''" : "'\"'\"'") + "'";
  const env = [home && `CHOG_HOME=${home}`, rpc && `CHOG_RPC_URL=${rpc}`].filter(Boolean);
  const envArgs = env.flatMap(value => ['--env', quote(value)]);
  const prefix = client === 'codex' ? ['codex', 'mcp', 'add', 'chog', ...envArgs] : ['claude', 'mcp', 'add', ...envArgs, '--transport', 'stdio', '--scope', 'user', 'chog'];
  return [...prefix, '--', quote(node), quote(entry), 'mcp'].join(' ');
}
