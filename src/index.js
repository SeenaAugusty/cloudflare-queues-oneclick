
// Single Worker: HTTP producer + Queue consumer
// Cloudflare Queues auto-batches (up to 100 messages or 5 seconds)
const encoder = new TextEncoder();
const sizeOfJson = (obj) => encoder.encode(JSON.stringify(obj)).length;
const BATCH_MAX_BYTES = 256 * 1024; // Max payload size to ingestion endpoint

export default {
  async fetch(request, env, ctx) {
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
      EdgeResponseStatus: 200,
    };
    ctx.waitUntil(env.LOGS_QUEUE.send(log));
    return new Response('OK', { status: 200 });
  },

  async queue(batch, env, ctx) {
    // Cloudflare already batched messages for us (up to 100 messages)
    // We just need to forward them to the ingestion endpoint
    
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

    // Split into chunks if payload would be too large
    const logs = batch.messages.map(m => m.body);
    let chunk = [];
    let chunkBytes = 0;

    for (const log of logs) {
      const logBytes = sizeOfJson(log);
      
      // If adding this log exceeds limit, send current chunk first
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

    // Send remaining logs
    if (chunk.length > 0) {
      const ok = await sendToIngestion(chunk);
      if (ok) {
        batch.ackAll();
      } else {
        batch.retryAll();
      }
    } else {
      batch.ackAll();
    }
  }
};
