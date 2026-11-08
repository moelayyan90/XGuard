import { escape } from '../live/util.ts';
export const siteBrand = () => '<a class="brand" href="/" aria-label="XGuard home"><span class="brand-symbol" aria-hidden="true">x</span><span class="brand-word">XGuard</span></a>';
export function siteHeader(path: string) {
  const links = [['/routes', 'Routes'], ['/network?service=discover', 'Discover'], ['/network', 'Execute'], ['/network/docs', 'Developers']];
  return `<a class="skip-link" href="#main-content">Skip to content</a><header class="site-header"><nav class="site-nav" aria-label="Main navigation">${siteBrand()}<div class="links">${links.map(([href,label])=>`<a href="${href}"${path === href ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</div><a class="nav-cta" href="/install">Connect agent <span aria-hidden="true">↗</span></a></nav></header>`;
}
export function siteFooter() {
  const groups = [
    ['Platform', [['/routes','Task routes'],['/network','Execution workspace'],['/network?service=discover','Service discovery'],['/topics','Source index']]],
    ['Build with XGuard', [['/network/docs','Documentation'],['/install','Connect an agent'],['/openapi.json','OpenAPI'],['/v1/payments/coverage','Payment coverage']]],
    ['Company', [['/identity','Operator & contact'],['/status','System status'],['/terms','Terms'],['/privacy','Privacy'],['/refund-policy','Refund policy']]],
  ] as const;
  return `<footer class="site-footer"><div class="site-footer-inner"><section>${siteBrand()}<p>The route layer for AI.<br>Discover. Execute. Verify.</p><span class="footer-protocol">MCP / A2A / x402 / HTTP</span></section>${groups.map(([heading,links])=>`<section><h2>${heading}</h2>${links.map(([href,label])=>`<a href="${href}">${label}</a>`).join('')}</section>`).join('')}</div><div class="footer-bottom"><span>© 2026 XGuard</span><span>Pay per operation. Know the cost before you run.</span></div></footer>`;
}
export function pageShell(path: string, title: string, description: string, content: string, script = true) {
  return `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} | XGuard</title><meta name="description" content="${escape(description)}"><meta name="color-scheme" content="dark"><meta name="theme-color" content="#090e17"><link rel="canonical" href="https://xguardgate.com${escape(path)}"><link rel="stylesheet" href="/assets/network-v1.css"></head><body>${siteHeader(path)}<main id="main-content" class="network-main">${content}</main>${siteFooter()}${script ? '<script src="/assets/network-v1.js" defer></script>' : ''}</body></html>`;
}
