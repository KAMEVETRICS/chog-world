#!/usr/bin/env node
import { run } from '../src/cli.js';
try { await run(process.argv.slice(2)); }
catch (error) { process.stderr.write((error instanceof Error ? error.message : 'Chog command failed.') + '\n'); process.exitCode = 1; }
