import { NextRequest, NextResponse } from 'next/server';

async function proxy(
  request: NextRequest,
  props: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await props.params;
  const targetPath = path && path.length > 0 ? path.join('/') : '';
  
  const defaultInternal = process.env.NODE_ENV === 'development' ? 'http://localhost:8000' : 'http://api:8000';
  const internalBase = (process.env.INTERNAL_API_URL || defaultInternal).replace(/\/$/, '');
  const search = request.nextUrl.search;
  const targetUrl = `${internalBase}/api/${targetPath}${search}`;

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('connection');

  let body: BodyInit | undefined = undefined;
  if (!['GET', 'HEAD'].includes(request.method)) {
    body = await request.blob();
  }

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
    return NextResponse.json(
      { error: 'Internal API proxy error', detail: err.message },
      { status: 502 }
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
