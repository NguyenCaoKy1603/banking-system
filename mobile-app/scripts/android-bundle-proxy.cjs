const http = require("node:http");
const zlib = require("node:zlib");

const listenPort = Number(process.env.ANDROID_BUNDLE_PROXY_PORT ?? 8081);
const upstreamPort = Number(process.env.METRO_UPSTREAM_PORT ?? 8082);

function forward(request, response) {
  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: upstreamPort,
      method: request.method,
      path: request.url,
      headers: {
        ...request.headers,
        host: `127.0.0.1:${upstreamPort}`,
        accept: "application/javascript",
      },
    },
    (upstreamResponse) => {
      const chunks = [];

      upstreamResponse.on("data", (chunk) => chunks.push(chunk));
      upstreamResponse.on("end", () => {
        const upstreamBody = Buffer.concat(chunks);
        const body =
          upstreamResponse.headers["content-encoding"] === "gzip"
            ? zlib.gunzipSync(upstreamBody)
            : upstreamBody;
        const headers = { ...upstreamResponse.headers };

        delete headers["content-encoding"];
        delete headers["transfer-encoding"];
        headers["content-type"] = "application/javascript";
        headers["content-length"] = String(body.length);
        headers.connection = "close";

        console.log(
          `${request.method} ${request.url} -> ${upstreamResponse.statusCode} ${body.length} bytes ` +
            `upstream-length=${upstreamResponse.headers["content-length"] ?? "none"} ` +
            `encoding=${upstreamResponse.headers["content-encoding"] ?? "none"}`,
        );
        const clientSocket = response.socket;
        response.once("finish", () => console.log(`response finish bytesWritten=${clientSocket?.bytesWritten ?? "none"}`));
        response.once("close", () => console.log(`response close destroyed=${response.destroyed} bytesWritten=${clientSocket?.bytesWritten ?? "none"}`));
        response.writeHead(upstreamResponse.statusCode ?? 502, headers);
        response.end(body);
      });
    },
  );

  upstream.on("error", (error) => {
    response.writeHead(502, { "content-type": "text/plain" });
    response.end(`Metro proxy error: ${error.message}`);
  });

  request.pipe(upstream);
}

http.createServer(forward).listen(listenPort, "0.0.0.0", () => {
  console.log(`Android bundle proxy listening on ${listenPort}; Metro upstream ${upstreamPort}`);
});
