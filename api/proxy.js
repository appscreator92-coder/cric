// The URL of your raw M3U playlist on GitHub.
const M3U_URL = 'https://raw.githubusercontent.com/appscreator92-coder/cric/refs/heads/main/playlist.m3u';

module.exports = async (req, res) => {
    // 1. Added 'origin' to the query parameters
    const { channel, url, referer, origin } = req.query;

    try {
        if (channel) {
            const m3uResponse = await fetch(M3U_URL);
            if (!m3uResponse.ok) return res.status(502).send('Error fetching playlist.');
            
            const m3uText = await m3uResponse.text();
            const lines = m3uText.split(/\r\n|\n|\r/);
            let streamUrl = '';
            let streamReferer = '';
            let streamOrigin = ''; // 2. Placeholder for Origin

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line.startsWith('#EXTINF:')) {
                    const namePart = line.split(',').pop().trim();

                    if (namePart.toLowerCase() === channel.toLowerCase()) {
                        for (let j = i + 1; j < i + 4; j++) { // Increased range to check for Origin
                            if (!lines[j]) continue;
                            const nextLine = lines[j].trim();
                            if (nextLine.startsWith('#EXTVLCOPT:http-referrer=')) {
                                streamReferer = nextLine.replace('#EXTVLCOPT:http-referrer=', '');
                            } else if (nextLine.startsWith('#EXTVLCOPT:http-origin=')) { // 3. Logic to catch Origin
                                streamOrigin = nextLine.replace('#EXTVLCOPT:http-origin=', '');
                            } else if (nextLine.startsWith('http')) {
                                streamUrl = nextLine;
                            }
                        }
                        if (streamUrl) break;
                    }
                }
            }

            if (!streamUrl) return res.status(404).send(`Channel "${channel}" not found.`);

            const proxyRedirectUrl = new URL(req.url, `https://${req.headers.host}`);
            proxyRedirectUrl.search = ''; 
            proxyRedirectUrl.searchParams.set('url', streamUrl);
            if (streamReferer) proxyRedirectUrl.searchParams.set('referer', streamReferer);
            if (streamOrigin) proxyRedirectUrl.searchParams.set('origin', streamOrigin); // 4. Pass Origin to redirect

            return res.redirect(302, proxyRedirectUrl.toString());
        }

        if (url) {
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            };
            if (referer) headers['Referer'] = referer;
            if (origin) headers['Origin'] = origin; // 5. Inject Origin into the outgoing request

            const targetResponse = await fetch(url, { headers });

            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', '*');

            targetResponse.headers.forEach((value, name) => {
                if (!['content-encoding', 'transfer-encoding', 'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers'].includes(name.toLowerCase())) {
                    res.setHeader(name, value);
                }
            });

            const contentType = targetResponse.headers.get('content-type') || '';

            if (contentType.includes('mpegurl')) {
                const body = await targetResponse.text();
                const requestUrl = new URL(req.url, `https://${req.headers.host}`).toString();
                // 6. Updated rewrite function to pass origin
                const rewrittenBody = rewritePlaylist(body, url, referer, origin, requestUrl);
                return res.status(targetResponse.status).send(rewrittenBody);
            }

            res.writeHead(targetResponse.status);
            const reader = targetResponse.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(value);
            }
            res.end();
            return;
        }

        res.status(200).send('Vercel M3U Proxy active with Origin support!');

    } catch (error) {
        res.status(500).send('Internal Server Error');
    }
};

// 7. Updated helper to include origin in rewritten segment URLs
function rewritePlaylist(body, playlistUrl, referer, origin, requestUrl) {
    const playlistBaseUrl = new URL(playlistUrl);
    const proxyBaseUrl = new URL(requestUrl);
    proxyBaseUrl.search = ''; 

    return body.trim().split(/\r\n|\n|\r/).map(line => {
        line = line.trim();
        if (!line) return '';

        if (!line.startsWith('#')) {
            const absoluteUrl = new URL(line, playlistBaseUrl).href;
            const proxyUrl = new URL(proxyBaseUrl.toString());
            proxyUrl.searchParams.set('url', absoluteUrl);
            if (referer) proxyUrl.searchParams.set('referer', referer);
            if (origin) proxyUrl.searchParams.set('origin', origin);
            return proxyUrl.toString();
        }
        
        const uriMatch = line.match(/URI="([^"]+)"/);
        if (uriMatch && uriMatch[1]) {
            const absoluteUri = new URL(uriMatch[1], playlistBaseUrl).href;
            const proxyUrl = new URL(proxyBaseUrl.toString());
            proxyUrl.searchParams.set('url', absoluteUri);
            if (referer) proxyUrl.searchParams.set('referer', referer);
            if (origin) proxyUrl.searchParams.set('origin', origin);
            return line.replace(uriMatch[1], proxyUrl.toString());
        }

        return line;
    }).join('\n');
}
