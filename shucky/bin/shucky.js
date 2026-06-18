#!/usr/bin/env node
'use strict';

// shucky — pry open an agent skill and inspect it before you trust it.
// This binary ONLY reads files as text. It never executes the skill under review.

require('../lib/cli')
  .runCli(process.argv.slice(2))
  .then(function (code) { process.exit(code); })
  .catch(function (err) {
    console.error('shucky: ' + ((err && err.message) || err));
    process.exit(3);
  });
