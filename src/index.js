// Ensure Worker runs for ALL requests — cached or not
// and logs every hit into the Cloudflare Queue.

const encoder = new TextEncoder();
const sizeOfJson = (obj) => encoder.encode(JSON.stringify(obj)).length;
const BATCH_MAX_BYTES = 256 * 1024; // 256 KB ingestion limit

export default {
  async fetch(request, env, ctx) {
    // Force Worker to always run, bypass cache completely
    const cacheBypass = {
      cf: {
        cacheEverything: false,
        cacheTtl: 0,
        bypassCache: true
      }
    };

    const url = new URL(request.url);
    const cf = request.cf || {};

    const log = {
      EdgeStartTimestamp: new Date().toISOString(),
      ClientIP: request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "",
      ClientCountry: cf.country || "",
      ClientCity: cf.city || "",
      ClientRequestScheme: url.protocol.replace(":", ""),
      ClientRequestHost: request.headers.get("host") || url.host,
      ClientRequestURI: url.pathname + (url.search || ""),
      ClientRequestMethod: request.method,
      ClientRequestUserAgent: request.headers.get("user-agent") || "",
      ClientRequestReferer: request.headers.get("referer") || "",
      EdgeResponseStatus: 200
    };

    // Always queue log event
    ctx.waitUntil(env.LOGS_QUEUE.send(log));

    // Fetch origin (but uncached!)
    let originResp = await fetch(request, cacheBypass)
      .catch(() => new Response("OK", { status: 200 }));

    // Still respond with OK for logging-only setups
    return new Response('OK', { status: 200 });
  },

  async queue(batch, env, ctx) {
    const sendToIngestion = async (items) => {
      if (!items.length) return true;

      try {
        const resp = await fetch(env.INGEST_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sentAt: Date.now(), items })
        });
        return resp.ok;
      } catch (e) {
        console.error('Ingestion failed:', e);
        return false;
      }
    };

    const logs = batch.messages.map((m) => m.body);
    let chunk = [];
    let chunkBytes = 0;

    for (const log of logs) {
      const logBytes = sizeOfJson(log);

      if (chunkBytes + logBytes > BATCH_MAX_BYTES && chunk.length > 0) {
        const ok = await sendToIngestion(chunk);
        if (!ok) {
          batch.retryAll();
          return;
        }
        chunk = [];
        chunkBytes = 0;
      }

      chunk.push(log);
      chunkBytes += logBytes;
    }

    if (chunk.length > 0) {
      const ok = await sendToIngestion(chunk);
      if (ok) batch.ackAll();
      else batch.retryAll();
    } else {
      batch.ackAll();
    }
  }
};
