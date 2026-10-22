import { NextRequest, NextResponse } from 'next/server';

async function proxy(
  request: NextRequest,
  props: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await props.params;
  const targetPath = path && path.length > 0 ? path.join('/') : '';
  
  const search = request.nextUrl.search;
  const subPath = `api/${targetPath}${search}`;

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('connection');

  let body: BodyInit | undefined = undefined;
  if (!['GET', 'HEAD'].includes(request.method)) {
    body = await request.blob();
  }

  // Candidate bases: explicit env var, then docker service 'http://api:8000', then local host 'http://127.0.0.1:8000'
  const explicitBase = process.env.INTERNAL_API_URL?.replace(/\/$/, '');
  const candidateBases = explicitBase
    ? [explicitBase]
    : ['http://api:8000', 'http://127.0.0.1:8000', 'http://localhost:8000'];

  let lastError: any = null;
  for (const base of candidateBases) {
    const targetUrl = `${base}/${subPath}`;
    try {
      const res = await fetch(targetUrl, {
        method: request.method,
        headers,
        body,
        cache: 'no-store',
        redirect: 'manual',
      });

      const responseHeaders = new Headers(res.headers);
      responseHeaders.delete('transfer-encoding');

      return new NextResponse(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: responseHeaders,
      });
    } catch (err: any) {
      lastError = err;
      continue;
    }
  }

  return NextResponse.json(
    { error: 'Internal API proxy error', detail: lastError?.message || 'Failed to reach API backend' },
    { status: 502 }
  );
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
