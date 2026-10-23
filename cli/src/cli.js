import { parseArgs } from 'node:util';
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { setupCommand } from './setup.js';

const HELP = `Local Chog CLI — Node 24+

  chog login [--no-open]                 Prove wallet control locally (no transaction)
  chog import <token-id>                 Import your awakened Chog from Monad
       [--metadata-file <file.json>]     Explicit trait fallback; provenance is labeled
  chog context [--offline]               Persona; live mode includes verified local memory
       [--out <new-file.json>]           Export public offline persona only, never memories
  chog whoami                           Show local wallet proof status
  chog skills list                      List workflows and working tools
  chog memory add <text>                 Explicit local memory save
  chog memory list                       Read current generation's local memories
  chog memory export --out <new-file>     Export current generation's private memories
  chog memory clear --confirm            Delete current generation's local memories
  chog report transaction <hash>         Read-only Monad transaction/receipt
  chog report token <wallet-address>     On-chain $CHOG balance and supply
  chog setup codex|claude-code           Print native MCP registration command
  chog mcp                              Run local MCP over stdio
  chog logout                           Forget local wallet proof and selection

CHOG_HOME: local data directory (default ~/.chog)
CHOG_RPC_URL: Monad RPC (default https://rpc.monad.xyz)
No Chog World server, hosted model API key or $CHOG payment is required.
Offline persona copies do not prove current ownership. Local memory is not encrypted.
`;

function exportNew(path, data) { writeFileSync(resolve(path), JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); return { exported: resolve(path) }; }
function openBrowser(url) {
  const [command, args] = process.platform === 'win32' ? ['cmd.exe', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  execFile(command, args, { windowsHide: true }, error => { if (error) process.stderr.write('Open the printed local login URL in your wallet-enabled browser.\n'); });
}
export async function run(argv) {
  const { values: flags, positionals: args } = parseArgs({ args: argv, allowPositionals: true, strict: true, options: { help: { type: 'boolean', short: 'h' }, 'no-open': { type: 'boolean' }, offline: { type: 'boolean' }, confirm: { type: 'boolean' }, out: { type: 'string' }, 'metadata-file': { type: 'string' } } });
  const command = args[0];
  if (!command || flags.help) { process.stdout.write(HELP); return; }
  if (command === 'setup') { process.stdout.write(setupCommand(args[1]) + '\n'); process.stderr.write('Run this command yourself to register Chog. No client configuration has been changed.\n'); return; }
  const allowed = new Set(['login', 'import', 'context', 'whoami', 'skills', 'memory', 'report', 'mcp', 'logout']);
  if (!allowed.has(command)) throw Error('Unknown command. Run chog --help.');
  const { LocalStore } = await import('./store.js');
  const { Chain } = await import('./chain.js');
  const { ChogCore } = await import('./core.js');
  const { SKILLS } = await import('./skills.js');
  const store = new LocalStore();
  const core = new ChogCore({ store, chain: new Chain() });
  const output = data => process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  if (command === 'mcp') { const { runMcp } = await import('./mcp.js'); runMcp(core); return; }
  try {
    if (command === 'login') {
      const { startLogin } = await import('./login.js');
      const flow = await startLogin({ save: login => store.saveLogin(login) });
      process.stderr.write(`Local wallet login: ${flow.url}\n`);
      if (!flags['no-open']) openBrowser(flow.url);
      const cancel = () => flow.close(); process.once('SIGINT', cancel);
      try { output(await flow.promise); } finally { process.removeListener('SIGINT', cancel); flow.close(); }
    } else if (command === 'import') {
      let data;
      if (flags['metadata-file']) { if (statSync(flags['metadata-file']).size > 262144) throw Error('Metadata file is too large.'); data = JSON.parse(readFileSync(flags['metadata-file'], 'utf8')); }
      output(await core.importToken(args[1], data));
    } else if (command === 'context') {
      if (flags.out) output(exportNew(flags.out, core.offlineContext()));
      else output(flags.offline ? core.offlineContext() : await core.context());
    } else if (command === 'whoami') { const login = store.login(); output({ ...login, selected: store.selection()?.identity ?? null }); }
    else if (command === 'skills' && args[1] === 'list') output(SKILLS);
    else if (command === 'memory') {
      if (args[1] === 'add') output(await core.addMemory(args.slice(2).join(' ')));
      else if (args[1] === 'list') output(await core.memories());
      else if (args[1] === 'clear' && flags.confirm) output(await core.clearMemory());
      else if (args[1] === 'export' && flags.out) output(exportNew(flags.out, await core.memories(undefined, true)));
      else throw Error('Choose memory add, list, export --out, or clear --confirm.');
    } else if (command === 'report') {
      if (args[1] === 'transaction') output(await core.chain.transaction(args[2]));
      else if (args[1] === 'token') output(await core.chain.tokenReport(args[2]));
      else throw Error('Choose report transaction <hash> or report token <wallet-address>.');
    } else if (command === 'logout') { store.logout(); output({ loggedOut: true, publicPersonaRetained: true, memoriesRetainedLocally: true }); }
    else throw Error('Unknown subcommand. Run chog --help.');
  } finally { store.close(); }
}
