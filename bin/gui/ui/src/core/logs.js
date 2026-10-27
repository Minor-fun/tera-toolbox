const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function createFormatter(window, purify) {
    return raw => {
        // Logs may contain markup, never scripts, media, forms, arbitrary CSS or local links.
        const html = purify.sanitize(raw, {
            ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'u', 's', 'span', 'font', 'br', 'a'],
            ALLOWED_ATTR: ['color', 'href'], ALLOW_DATA_ATTR: false
        });
        const template = window.document.createElement('template');
        template.innerHTML = html;
        template.content.querySelectorAll('a').forEach(link => {
            if (!/^https?:\/\//i.test(link.getAttribute('href') || '')) link.removeAttribute('href');
        });
        template.content.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
        return { html: template.innerHTML, plain: template.content.textContent };
    };
}

class LogBuffer {
    constructor(format, limit = Infinity, byteLimit = Infinity) {
        this.format = format;
        this.limit = limit;
        this.byteLimit = byteLimit;
        this.entries = [];
        this.nextId = 0;
        this.bytes = 0;
        this.dropped = 0;
    }

    append(message, type, timestamp) {
        const raw = (timestamp || '') + String(message);
        const rendered = this.format(raw);
        const entry = { id: this.nextId++, raw, ...rendered, type: ['warn', 'error'].includes(type) ? type : 'log' };
        entry.bytes = 2 * (entry.raw.length + entry.html.length + entry.plain.length);
        this.entries.push(entry);
        this.bytes += entry.bytes;
        while (this.entries.length > this.limit || (this.bytes > this.byteLimit && this.entries.length > 1)) {
            this.bytes -= this.entries.shift().bytes;
            this.dropped++;
        }
    }

    clear() {
        this.entries = [];
        this.bytes = 0;
        this.dropped = 0;
    }

    export(rawHTML) {
        return this.entries.map(entry => ({ text: rawHTML ? entry.raw : entry.plain, type: `log-${entry.type}` }));
    }
}

function findMatches(entries, query, rawHTML, limit = 50000) {
    const needle = query.toLocaleLowerCase();
    const matches = [];
    if (!needle) return matches;
    for (let row = 0; row < entries.length; row++) {
        const entry = entries[row];
        const text = (rawHTML ? entry.raw : entry.plain).toLocaleLowerCase();
        for (let position = text.indexOf(needle); position !== -1; position = text.indexOf(needle, position + needle.length)) {
            matches.push({ row, id: entry.id, position });
            if (matches.length === limit) return matches;
        }
    }
    return matches;
}

function highlight(text, query, activePosition = -1) {
    if (!query) return escapeHTML(text);
    const lower = text.toLocaleLowerCase();
    const needle = query.toLocaleLowerCase();
    let result = '', start = 0, position = lower.indexOf(needle);
    while (position !== -1) {
        result += escapeHTML(text.slice(start, position)) + `<mark${position === activePosition ? ' class="current-match"' : ''}>` +
            escapeHTML(text.slice(position, position + query.length)) + '</mark>';
        start = position + query.length;
        position = lower.indexOf(needle, start);
    }
    return result + escapeHTML(text.slice(start));
}

function timestamp(now) {
    return `[${[now.getHours(), now.getMinutes(), now.getSeconds()].map(n => String(n).padStart(2, '0')).join(':')}.${String(now.getMilliseconds()).padStart(3, '0')}] `;
}

module.exports = { LogBuffer, createFormatter, findMatches, highlight, escapeHTML, timestamp };
