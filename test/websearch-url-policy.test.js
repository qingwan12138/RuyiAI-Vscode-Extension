// The URL/SSRF policy of the bundled web tools.
//
// These rules are what stands between "the model can read a page" and "the model
// can make this machine probe its own network". They are pure functions so every
// case below is a real, offline assertion.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_FETCH_LIMITS,
  boundBody,
  checkUrl,
  htmlToText,
  isPublicAddress,
  isSameOrigin
} = require('../dist/yisi/mcp-server/websearch/urlPolicy');

const ok = raw => {
  const result = checkUrl(raw);
  assert.equal(result.ok, true, `expected a valid URL: ${raw} (${result.reason})`);
  return result.url;
};

const denied = raw => {
  const result = checkUrl(raw);
  assert.equal(result.ok, false, `expected ${raw} to be refused`);
  return result.reason;
};

test('only http and https are accepted', () => {
  assert.equal(ok('https://example.com/a?b=1').hostname, 'example.com');
  assert.equal(ok('http://example.com/').protocol, 'http:');
  assert.match(denied('file:///etc/passwd'), /Only http and https/);
  assert.match(denied('ftp://example.com/x'), /Only http and https/);
  assert.match(denied('data:text/html,<b>x</b>'), /Only http and https/);
  // The obvious bypass: whitespace or a scheme hidden behind the parser.
  assert.match(denied(' java\nscript:alert(1)'), /whitespace or control/);
  assert.match(denied('https://exa mple.com/'), /whitespace or control/);
});

test('credentials in a URL are refused', () => {
  assert.match(denied('https://user:pass@example.com/'), /Credentials in a URL/);
  assert.match(denied('https://token@example.com/'), /Credentials in a URL/);
});

test('relative, empty and oversized URLs are refused', () => {
  assert.match(denied(''), /URL is required/);
  assert.match(denied('   '), /URL is required/);
  assert.match(denied('/just/a/path'), /not a valid absolute URL/);
  assert.match(denied(`https://example.com/${'a'.repeat(DEFAULT_FETCH_LIMITS.maxUrlCharacters)}`), /longer than/);
});

test('private, loopback, link-local and metadata addresses are refused', () => {
  for (const address of [
    '127.0.0.1',
    '127.1.2.3',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',   // cloud metadata
    '0.0.0.0',
    '100.64.0.1',        // carrier-grade NAT
    '192.0.0.1',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255'
  ]) {
    assert.equal(isPublicAddress(address), false, `${address} must be refused`);
  }
});

test('public addresses are allowed, including the adjacent ones', () => {
  for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '192.169.0.1', '223.255.255.255']) {
    assert.equal(isPublicAddress(address), true, `${address} must be allowed`);
  }
});

test('IPv6 loopback, unique-local, link-local and multicast are refused', () => {
  for (const address of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '2001:db8::1']) {
    assert.equal(isPublicAddress(address), false, `${address} must be refused`);
  }
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true, 'public IPv6 must be allowed');
  assert.equal(isPublicAddress('[2606:4700:4700::1111]'), true, 'brackets are stripped');
});

test('an IPv4 address hidden inside IPv6 is judged, not trusted', () => {
  // ::ffff:127.0.0.1 is loopback wearing an IPv6 costume.
  assert.equal(isPublicAddress('::ffff:127.0.0.1'), false);
  assert.equal(isPublicAddress('::ffff:169.254.169.254'), false);
  assert.equal(isPublicAddress('::ffff:8.8.8.8'), true);
  assert.equal(isPublicAddress('::8.8.8.8'), true, 'IPv4-compatible form');
});

test('an unrecognised address is refused, not allowed', () => {
  assert.equal(isPublicAddress(''), false);
  assert.equal(isPublicAddress('not-an-address'), false);
  assert.equal(isPublicAddress('999.1.1.1'), false);
  assert.equal(isPublicAddress('12345::1'), false);
});

test('only same-origin redirects are allowed', () => {
  assert.equal(isSameOrigin(ok('https://example.com/a'), ok('https://example.com/b')), true);
  assert.equal(isSameOrigin(ok('https://example.com/a'), ok('https://other.com/a')), false);
  assert.equal(isSameOrigin(ok('https://example.com/a'), ok('http://example.com/a')), false, 'scheme downgrade');
  assert.equal(isSameOrigin(ok('https://example.com/a'), ok('https://example.com:8443/a')), false, 'port change');
  assert.equal(isSameOrigin(ok('https://example.com/a'), ok('https://example.com:443/b')), true, 'default port');
});

test('HTML is collapsed to readable text', () => {
  const html = '<html><head><style>p{color:red}</style><script>alert(1)</script></head>'
    + '<body><h1>Title</h1><p>Hello&nbsp;&amp; welcome</p><ul><li>one</li><li>two</li></ul></body></html>';
  const text = htmlToText(html);
  assert.match(text, /Title/);
  assert.match(text, /Hello & welcome/);
  assert.match(text, /one\ntwo/, 'list items become lines');
  assert.equal(/alert\(1\)/.test(text), false, 'script bodies are dropped');
  assert.equal(/color:red/.test(text), false, 'style bodies are dropped');
  assert.equal(/</.test(text), false, 'no tags survive');
});

test('the body is bounded with a visible marker, keeping both ends', () => {
  const short = 'x'.repeat(50);
  assert.equal(boundBody(short, 100), short, 'nothing is changed below the bound');
  const long = `START${'y'.repeat(5_000)}END`;
  const bounded = boundBody(long, 1_000);
  assert.ok(bounded.length < long.length);
  assert.match(bounded, /characters omitted/);
  assert.match(bounded, /^START/);
  assert.match(bounded, /END$/);
});

test('the defaults match the specification recorded in docs/14', () => {
  assert.equal(DEFAULT_FETCH_LIMITS.maxResponseBytes, 5 * 1024 * 1024);
  assert.equal(DEFAULT_FETCH_LIMITS.maxBodyCharacters, 100_000);
  assert.equal(DEFAULT_FETCH_LIMITS.timeoutMs, 30_000);
  assert.equal(DEFAULT_FETCH_LIMITS.maxRedirects, 5);
  assert.equal(DEFAULT_FETCH_LIMITS.maxUrlCharacters, 2_048);
});
