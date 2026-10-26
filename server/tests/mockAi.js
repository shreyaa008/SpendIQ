import http from 'node:http';

/** A stand-in for the Anthropic Messages API so the AI code paths can be tested offline. */
export async function startMockAi() {
  const state = { requests: [], handler: () => ({ status: 200, body: { content: [{ type: 'text', text: 'ok' }] } }) };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      state.requests.push({ headers: req.headers, body, url: req.url });
      const out = state.handler(body);
      res.writeHead(out.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out.body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  state.url = `http://127.0.0.1:${server.address().port}`;
  state.close = () => new Promise((r) => server.close(r));
  return state;
}
export const textReply = (text) => ({ status: 200, body: { content: [{ type: 'text', text }] } });
