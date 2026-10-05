import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workflow = await readFile(resolve(root, '.github', 'workflows', 'deploy.yml'), 'utf8');

function fail(message) {
  console.error(`deploy gate check failed: ${message}`);
  process.exit(1);
}

const trigger = workflow.match(/workflow_run:\s*\n\s*workflows:\s*\[(.+?)\]/);
if (!trigger || !trigger[1].split(',').map((name) => name.trim().replace(/['"]/g, '')).includes('ci')) {
  fail('deploy.yml must trigger on workflow_run of the ci workflow.');
}
if (!/types:\s*\[(.+?)\]/.test(workflow) || !workflow.match(/types:\s*\[(.+?)\]/)[1].includes('completed')) {
  fail('deploy.yml must trigger on workflow_run completion.');
}

const gate = workflow.match(/if:\s*(.+)$/m);
if (!gate) {
  fail('deploy.yml publish job must define an eligibility condition.');
}
const condition = gate[1].trim();

const successRefs = condition.match(/conclusion\s*==\s*'success'/g) ?? [];
if (successRefs.length === 0) {
  fail("the publish job condition must require github.event.workflow_run.conclusion == 'success'.");
}

function eligibleFor(conclusion, eventName) {
  if (eventName === 'workflow_dispatch') return true;
  return successRefs.length > 0 && conclusion === 'success' && !/conclusion\s*==\s*'failure'/.test(condition);
}

const cases = [
  { conclusion: 'success', eventName: 'workflow_run', expected: true },
  { conclusion: 'failure', eventName: 'workflow_run', expected: false },
  { conclusion: 'cancelled', eventName: 'workflow_run', expected: false }
];

for (const { conclusion, eventName, expected } of cases) {
  if (eligibleFor(conclusion, eventName) !== expected) {
    fail(`a ${conclusion} CI run must ${expected ? 'allow' : 'block'} the publish path.`);
  }
  console.log(`ci ${conclusion} on workflow_run -> publish eligible: ${eligibleFor(conclusion, eventName)}`);
}

if (!/cloudflare\/wrangler-action/.test(workflow)) {
  fail('deploy.yml must upload the verified artifact with wrangler.');
}
if (/actions\/deploy-pages/.test(workflow) || /actions\/upload-pages-artifact/.test(workflow)) {
  fail('deploy.yml still publishes through GitHub Pages.');
}
if (!/download-artifact@v4/.test(workflow) || !/production-dist/.test(workflow)) {
  fail('deploy.yml must download the production-dist artifact CI already verified.');
}
if (/npm run build/.test(workflow)) {
  fail('deploy.yml must not rebuild. It publishes the CI artifact.');
}

console.log('deploy gate check passed: publication uploads the verified artifact only after a successful ci run.');
