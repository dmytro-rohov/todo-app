#!/usr/bin/env node
'use strict';
// Render the deploy profile for ONE release from the template. The only value filled in is the image digest;
// everything else is reviewed text. Output goes to stdout. No network, no registry access, no secrets.
//   node scripts/render-deploy-profile.cjs sha256:<64 hex> > deploy-profile.json
const fs = require('node:fs');
const path = require('node:path');

const DIGEST = /^sha256:[0-9a-f]{64}$/;

function render(digest, template) {
  if (typeof digest !== 'string' || !DIGEST.test(digest)) {
    throw new Error('image digest must look like sha256:<64 lowercase hex>');
  }
  const text = template.replaceAll('__IMAGE_DIGEST__', digest);
  if (text.includes('__IMAGE_DIGEST__')) throw new Error('unreplaced placeholder');
  return JSON.stringify(JSON.parse(text), null, 2) + '\n';
}

module.exports = { render, DIGEST };

if (require.main === module) {
  const template = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'deploy-profile.template.json'), 'utf8');
  try {
    process.stdout.write(render(process.argv[2], template));
  } catch (error) {
    process.stderr.write(`render-deploy-profile: ${error.message}\n`);
    process.exit(2);
  }
}
