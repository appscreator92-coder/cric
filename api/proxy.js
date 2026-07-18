const M3U_URL = 'https://raw.githubusercontent.com/hasanhabibmottakin/h2so4/refs/heads/main/playlist.m3u';

module.exports = async (req, res) => {
    const { channel, url, referer, origin } = req.query;

    try {
        if (channel) {
            const m3uResponse = await fetch(M3U_URL);
            if (!m3uResponse.ok) return res.status(502).send('Error fetching playlist.');
            
            const m3uText = await m3uResponse.text();
            const lines = m3uText.split(/\r\n|\n|\r/);
            let streamUrl = '', streamReferer = '', streamOrigin = '';

            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes(channel)) {
                    for (let j = i + 1; j < i + 6; j++) {
                        if (!lines[j]) continue;
                        const line = lines[j].trim();
                        if (line.startsWith('#EXTVLCOPT:http-referrer=')) streamReferer = line.split('=')[1];
                        else if (line.startsWith('#EXTVLCOPT:http-origin=')) streamOrigin = line.split('=')[1];
                        else if (line.startsWith('http')) { streamUrl = line; break; }
                    }
                    if (streamUrl) break;
                }
            }

            if (!streamUrl) return res.status(404).send('Channel not found.');
            const proxyRedirectUrl = new URL(req.url, `https://${req.headers.host}`);
            proxyRedirectUrl.search = `?url=${encodeURIComponent(streamUrl)}${streamReferer ? `&referer=${encodeURIComponent(streamReferer)}` : ''}${streamOrigin ? `&origin=${encodeURIComponent(streamOrigin)}` : ''}`;
            return res.redirect(302, proxyRedirectUrl.toString());
        }

        if (url) {
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': referer || '',
                'Origin': origin || '',
                'Cookie': req.headers.cookie || ''
            };

            // Using { redirect: 'follow' } to ensure headers persist through CDN redirects
            const targetResponse = await fetch(url, { headers, redirect: 'follow' });

            res.setHeader('Access-Control-Allow-Origin', '*');
            targetResponse.headers.forEach((v, n) => {
                if (!['content-encoding', 'transfer-encoding'].includes(n.toLowerCase())) res.setHeader(n, v);
            });

            if (targetResponse.headers.get('content-type')?.includes('mpegurl')) {
                const body = await targetResponse.text();
                return res.status(200).send(rewritePlaylist(body, url, referer, origin, req));
            }

            res.status(targetResponse.status);
            // Stream the chunks directly to the client
            for await (const chunk of targetResponse.body) {
                res.write(chunk);
            }
            return res.end();
        }
        res.status(200).send('Proxy Active');
    } catch (e) {
        res.status(500).send('Internal Server Error');
    }
};

function rewritePlaylist(body, playlistUrl, referer, origin, req) {
    const baseUrl = new URL(playlistUrl);
    const proxyUrl = new URL(req.url, `https://${req.headers.host}`);
    proxyUrl.search = '';

    return body.split('\n').map(line => {
        if (line.startsWith('#') || !line.trim()) return line;
        const absUrl = new URL(line, baseUrl).href;
        const pUrl = new URL(proxyUrl);
        pUrl.searchParams.set('url', absUrl);
        if (referer) pUrl.searchParams.set('referer', referer);
        if (origin) pUrl.searchParams.set('origin', origin);
        return pUrl.toString();
    }).join('\n');
}
