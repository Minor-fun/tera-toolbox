const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../skylight');

function list(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(dir, entry.name);
        return entry.isDirectory() ? list(file) : path.relative(root, file).replace(/\\/g, '/');
    });
}

const files = list(root).filter(file => file !== 'ui-assets.json').sort();
fs.writeFileSync(path.join(root, 'ui-assets.json'), JSON.stringify({ version: 1, files }, null, 2) + '\n');
console.log(`Skylight UI: ${files.length} runtime assets; legacy files untouched.`);
