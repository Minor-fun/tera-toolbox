const fs = require('fs');
const path = require('path');
const assert = require('assert').strict;
const root = path.resolve(__dirname, '../../../..');
const { resolveUI } = require('../../ui-resources');
const { languages } = require('../../ui-i18n');
const { buildManifest } = require(path.join(root, '.manifest.js'));
const manifestBefore = fs.readFileSync(path.join(root, 'manifest.json'));
const generated = buildManifest(root);
const files = Object.keys(generated.files);
const bundledMuiLocales = ['ar', 'ba', 'de', 'es', 'it', 'pl', 'pt-BR', 'tr'];
assert.ok(files.includes('bin/gui/skylight/main.html'));
assert.ok(files.includes('bin/gui/skylight/splash.html'));
assert.ok(files.includes('bin/gui/skylight/media/success.mp3'));
for (const asset of ['skylight-default.png', 'skylight-default.mp4', 'skylight-default-poster.jpg'])
    assert.ok(files.includes(`bin/gui/skylight/assets/backgrounds/${asset}`), `Missing built-in background: ${asset}`);
assert.ok(!files.includes('success.mp3'), 'The audio source must stay in the UI source assets directory.');
assert.ok(fs.readFileSync(path.join(root, 'bin/gui/ui/src/assets/audio/success.mp3')).equals(fs.readFileSync(path.join(root, 'bin/gui/skylight/media/success.mp3'))));
assert.ok(files.includes('bin/gui/ui-appearance.js'));
assert.ok(files.includes('bin/gui/ui-i18n.js'), 'The shared translator must be distributed.');
for (const language of languages) assert.ok(files.includes(`bin/gui/locales/${language}.json`), `Missing runtime locale: ${language}`);
for (const language of bundledMuiLocales)
    assert.ok(files.includes(`node_modules/tera-toolbox-mui/language/${language}.js`), `Missing bundled MUI locale: ${language}`);
assert.ok(files.includes('bin/gui/main.html'));
assert.ok(files.every(file => !/^(docs\/|bin\/gui\/ui\/|ui\/|tools\/|mods\/|node_modules\/electron\/|[._])/i.test(file)));
assert.equal(resolveUI().skylight, true);
assert.equal(resolveUI(undefined, { TERA_TOOLBOX_UI: 'legacy' }).skylight, false);
assert.ok(fs.readFileSync(path.join(root, 'manifest.json')).equals(manifestBefore));
assert.deepEqual(JSON.parse(manifestBefore), generated, 'Release manifest is outdated. Run npm run manifest at the repository root.');
console.log(JSON.stringify({ ok: true, runtimeFiles: files.length, skylightFiles: files.filter(file => file.startsWith('bin/gui/skylight/')).length,
    runtimeLocales: languages.length, privateMediaExcluded: true, devDependenciesAndTestsExcluded: true, modulesAndElectronExcluded: true,
    legacyFallback: true, releaseManifestUnchanged: true, releaseManifestCurrent: true }, null, 2));
