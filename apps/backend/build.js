import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const handlers = [
  'auth',
  'showsets',
  'notes',
  'issues',
  'sessions',
  'users',
  'activity',
  'translate',
  'translate-api',
  'pdf-translate',
];

async function build() {
  // Clean dist directory
  if (fs.existsSync('dist')) {
    fs.rmSync('dist', { recursive: true });
  }

  for (const handler of handlers) {
    const entryPoint = `src/handlers/${handler}/index.ts`;

    if (!fs.existsSync(entryPoint)) {
      console.log(`Skipping ${handler}: entry point not found`);
      continue;
    }

    const outdir = `dist/handlers/${handler}`;

    await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'esm',
      outdir,
      outExtension: { '.js': '.mjs' },
      banner: {
        js: `
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
        `.trim(),
      },
      external: [
        '@aws-sdk/client-dynamodb',
        '@aws-sdk/lib-dynamodb',
        '@aws-sdk/client-cognito-identity-provider',
        '@aws-sdk/client-sqs',
        '@aws-sdk/client-translate',
        '@aws-sdk/client-textract',
        '@aws-sdk/client-comprehend',
        '@aws-sdk/client-s3',
        '@aws-sdk/s3-request-presigner',
      ],
      minify: true,
      sourcemap: true,
    });

    // Rename to index.js for Lambda
    fs.renameSync(
      path.join(outdir, 'index.mjs'),
      path.join(outdir, 'index.js')
    );

    // Add package.json with type: module for ESM support
    fs.writeFileSync(
      path.join(outdir, 'package.json'),
      JSON.stringify({ type: 'module' }, null, 2)
    );

    console.log(`Built ${handler}`);
  }

  console.log('Build complete');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
