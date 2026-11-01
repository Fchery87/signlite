import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const workflow = await readFile(resolve(import.meta.dirname, '..', '.github', 'workflows', 'deploy.yml'), 'utf8');
const fail = (message) => { throw new Error(`deploy gate check failed: ${message}`); };
const requireMatch = (pattern, message) => { if (!pattern.test(workflow)) fail(message); };

requireMatch(/workflow_run:\s*\n\s*workflows:\s*\[ci\]\s*\n\s*types:\s*\[completed\]\s*\n\s*branches:\s*\[main\]/, 'trigger must be completed main-branch ci workflow runs');
if (/workflow_dispatch:/.test(workflow)) fail('manual dispatch must remain disabled; re-run the successful ci workflow instead');
requireMatch(/if:\s*github\.event\.workflow_run\.conclusion == 'success'/, 'publish must require successful ci');
requireMatch(/ref:\s*\$\{\{ github\.event\.workflow_run\.head_sha \}\}/, 'checkout must use the triggering ci commit');
requireMatch(/run-id:\s*\$\{\{ github\.event\.workflow_run\.id \}\}/, 'artifact must come from the triggering ci run');
requireMatch(/path:\s*production-artifact/, 'artifact must download into its own directory');
requireMatch(/actions\/setup-node@v4[\s\S]*node-version:\s*24/, 'standalone checker requires explicit Node setup');
requireMatch(/node scripts\/check-production-artifact\.mjs production-artifact\/dist production-artifact\/artifact-manifest\.json \$\{\{ github\.event\.workflow_run\.head_sha \}\}/, 'downloaded artifact must be checked against the triggering commit');
requireMatch(/cloudflare\/wrangler-action@v3/, 'verified artifact must publish with Wrangler');
requireMatch(/pages deploy production-artifact\/dist/, 'Wrangler must publish the checked directory');
if (/npm (ci|install)|npm run build/.test(workflow)) fail('deployment must not install dependencies or rebuild');
if (/actions\/(deploy-pages|upload-pages-artifact)/.test(workflow)) fail('deployment must not use GitHub Pages');

console.log('deploy gate check passed: successful main ci runs publish only their exact verified artifact.');
