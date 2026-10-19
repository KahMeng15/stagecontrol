import { NextRequest, NextResponse } from 'next/server';

async function proxyLive(
  request: NextRequest,
  props: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await props.params;
  const targetPath = path && path.length > 0 ? path.join('/') : '';
  const search = request.nextUrl.search;

  // Determine if this is a WebRTC / WHIP / WHEP request (port 8889) or HLS / web player (port 8888)
  const isWebRtc = targetPath.endsWith('/whip') || 
                   targetPath.endsWith('/whep') || 
                   targetPath.endsWith('/whep/') || 
                   targetPath.endsWith('/whip/') ||
                   request.headers.get('content-type')?.includes('application/sdp');

  const defaultHls = process.env.NODE_ENV === 'development' ? 'http://localhost:8888' : 'http://mediamtx:8888';
  const defaultWebRtc = process.env.NODE_ENV === 'development' ? 'http://localhost:8889' : 'http://mediamtx:8889';

  const hlsBase = (process.env.INTERNAL_MEDIAMTX_HLS_URL || defaultHls).replace(/\/$/, '');
  const webrtcBase = (process.env.INTERNAL_MEDIAMTX_WEBRTC_URL || defaultWebRtc).replace(/\/$/, '');

  const base = isWebRtc ? webrtcBase : hlsBase;
  const targetUrl = `${base}/live/${targetPath}${search}`;

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
    // Ensure CORS headers for cross-origin players
    if (!responseHeaders.has('Access-Control-Allow-Origin')) {
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
      responseHeaders.set('Access-Control-Allow-Headers', '*');
    }

    return new NextResponse(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'MediaMTX stream proxy error', detail: err.message },
      { status: 502 }
    );
  }
}

export const GET = proxyLive;
export const POST = proxyLive;
export const PUT = proxyLive;
export const PATCH = proxyLive;
export const DELETE = proxyLive;
export const HEAD = proxyLive;
export const OPTIONS = proxyLive;
