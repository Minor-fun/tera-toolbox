const path = require('path');

module.exports = {
    publicPath: './',
    outputDir: path.resolve(__dirname, '../skylight'),
    productionSourceMap: false,
    filenameHashing: false,
    pages: {
        main: { entry: 'src/main.js', template: 'public/main.html', filename: 'main.html', title: 'TERA Toolbox' }
    },
    configureWebpack: {
        optimization: { splitChunks: false },
        performance: { hints: false }
    },
    chainWebpack(config) {
        config.plugins.delete('prefetch-main');
        config.plugins.delete('preload-main');
    }
};
