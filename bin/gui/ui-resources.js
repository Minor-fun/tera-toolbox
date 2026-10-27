'use strict';

const fs = require('fs');
const path = require('path');

function resolveUI(root = __dirname, env = process.env) {
    const skylightRoot = path.join(root, 'skylight');
    let skylight = env.TERA_TOOLBOX_UI !== 'legacy';
    if (skylight) {
        try {
            const manifest = JSON.parse(fs.readFileSync(path.join(skylightRoot, 'ui-assets.json'), 'utf8'));
            const required = ['main.html', 'splash.html', 'bridge.js', 'media-probe.html', 'js/main.js', 'css/main.css'];
            skylight = manifest.version === 1 && Array.isArray(manifest.files) &&
                required.every(file => manifest.files.includes(file)) && manifest.files.every(file => {
                    if (typeof file !== 'string' || path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) return false;
                    const stat = fs.statSync(path.join(skylightRoot, file));
                    return stat.isFile() && stat.size > 0;
                });
        } catch (_) {
            skylight = false;
        }
    }
    const selected = skylight ? skylightRoot : root;
    return { skylight, root: selected, main: path.join(selected, 'main.html'), splash: path.join(selected, 'splash.html') };
}

module.exports = { resolveUI };
