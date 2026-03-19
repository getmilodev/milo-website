export default function middleware(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  // Block internal docs from public access
  if (
    path.startsWith('/ops/') ||
    path.startsWith('/ops') ||
    path.startsWith('/mockups/') ||
    path.startsWith('/mockups') ||
    path.startsWith('/ref/') ||
    path.startsWith('/ref') ||
    path.startsWith('/research/') ||
    path.startsWith('/research') ||
    path === '/CLAUDE.md' ||
    path === '/CLAUDE.local.md' ||
    path.endsWith('.md')
  ) {
    return new Response('Not Found', { status: 404 });
  }
}

export const config = {
  matcher: [
    '/ops/:path*',
    '/mockups/:path*',
    '/ref/:path*',
    '/research/:path*',
    '/CLAUDE.md',
    '/CLAUDE.local.md',
    '/:path*.md',
  ],
};
