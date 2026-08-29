#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const output = path.resolve(__dirname, 'expected', 'recovery-canary-binary.bin');
const size = 300123; // Exercises metadata plus three 128 KiB plaintext chunks.
const bytes = Buffer.alloc(size);
for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = (i * 73 + 19) & 0xff;
}
Buffer.from('CRYPTPAD-BINARY-CANARY-04\0', 'utf8').copy(bytes, 0);
const footer = Buffer.from('\0CP-BINARY-END-04\n', 'utf8');
footer.copy(bytes, bytes.length - footer.length);
fs.writeFileSync(output, bytes, { mode: 0o600 });
console.log(output);
