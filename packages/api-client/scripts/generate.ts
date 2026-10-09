/**
 * Generate TypeScript types from the canonical OpenAPI document at
 * packages/contracts/openapi.json into packages/api-client/src/generated.ts.
 *
 * The web app imports the API client wrapper (src/index.ts) which itself
 * imports the generated types. After running this script, restart any
 * Vite watcher so the new types are picked up.
 *
 * Run via:
 *   npm run generate -w @syncpath/api-client
 */
import openapiTS, { astToString } from 'openapi-typescript';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

async function main(): Promise<void> {
  const input = resolve(
    process.cwd(),
    '..',
    '..',
    'packages',
    'contracts',
    'openapi.json'
  );
  const output = resolve(
    process.cwd(),
    'src',
    'generated.ts'
  );

  // eslint-disable-next-line no-console
  console.log(`Generating types from ${input} → ${output}`);
  const nodes = await openapiTS(new URL(`file://${input}`));
  const contents = astToString(nodes);
  writeFileSync(output, contents);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${output} (${contents.length} bytes)`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to generate OpenAPI types:', err);
  process.exit(1);
});
