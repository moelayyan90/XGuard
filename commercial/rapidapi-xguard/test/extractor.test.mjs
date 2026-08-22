import assert from 'node:assert/strict';
import { assertPublicHttpUrl, extractHtml } from '../src/extractor.mjs';

const html = `<!doctype html>
<html lang="en">
<head>
  <title>Example Article</title>
  <meta name="description" content="Useful description">
  <link rel="canonical" href="/article">
</head>
<body>
  <nav>Navigation noise</nav>
  <main>
    <h1>Hello XGuard</h1>
    <p>Useful body text.</p>
    <a href="/next">Next page</a>
    <script>steal()</script>
  </main>
  <footer>Footer noise</footer>
</body>
</html>`;

const result = extractHtml(html, 'https://example.com/article');
assert.equal(result.title, 'Example Article');
assert.equal(result.description, 'Useful description');
assert.equal(result.canonical, 'https://example.com/article');
assert.match(result.markdown, /# Hello XGuard/);
assert.match(result.text, /Useful body text/);
assert.doesNotMatch(result.text, /Navigation noise|Footer noise|steal/);
assert.deepEqual(result.links[0], { url: 'https://example.com/next', text: 'Next page' });

assert.throws(() => assertPublicHttpUrl('http://127.0.0.1/admin'));
assert.throws(() => assertPublicHttpUrl('http://169.254.169.254/latest/meta-data'));
assert.throws(() => assertPublicHttpUrl('http://10.0.0.1'));
assert.throws(() => assertPublicHttpUrl('file:///etc/passwd'));
assert.equal(assertPublicHttpUrl('https://example.com/path').hostname, 'example.com');

console.log('XGuard extractor tests passed');
