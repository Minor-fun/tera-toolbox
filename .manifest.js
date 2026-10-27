'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const IGNORED_PATHS = new Set([
    'bin/gui/ui', 'ui', 'tools', 'mods', 'node_modules/electron',
    'logs', 'profiles', 'dist', 'docs'
]);
const IGNORED_FILES = new Set([
    'config.json', 'module.config.json', 'manifest.json', 'electron.zip', 'node.exe',
    'build_manifest.py', 'build_manifest.bat', 'manifest-generator.js',
    'manifest-generator.bat', 'manifest-generator.exe', 'local_updates.md'
]);
const IGNORED_START_SYMBOL = ['.', '_'];
const IGNORED_EXTENSIONS = /\.(?:log|jsonl|bak|tmp)$/i;

function buildManifest(root = __dirname) {
    root = fs.realpathSync(root);
    const files = {};

    function visit(directory = '') {
        for (const name of fs.readdirSync(path.join(root, directory)).sort()) {
            const relative = directory ? `${directory}/${name}` : name;
            // Exclude private/development directories before traversing or reading them.
            if (IGNORED_START_SYMBOL.includes(name[0]) || IGNORED_PATHS.has(relative.toLowerCase()) ||
                IGNORED_FILES.has(name.toLowerCase()) || IGNORED_EXTENSIONS.test(name)) continue;
            const absolute = path.join(root, relative);
            const stat = fs.lstatSync(absolute);
            if (stat.isSymbolicLink()) throw new Error('Symbolic links are not supported in the update manifest: ' + relative);
            if (stat.isDirectory()) visit(relative);
            else if (stat.isFile()) files[relative] = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex').toUpperCase();
            else throw new Error('Update path must be a regular file: ' + relative);
        }
    }

    visit();
    return { files };
}

function writeManifest(root = __dirname) {
    const manifest = buildManifest(root);
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Built self-update manifest: ${Object.keys(manifest.files).length} files; blacklist applied.`);
    return manifest;
}

if (require.main === module) writeManifest();
module.exports = { buildManifest, writeManifest };
