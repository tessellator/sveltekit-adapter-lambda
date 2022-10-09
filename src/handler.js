import "./shims";
import fs from "fs";
import path from "path";
import sirv from "sirv";
import { fileURLToPath } from "url";
import { getRequest } from "@sveltejs/kit/node";
import * as set_cookie_parser from "set-cookie-parser";
import { Server } from "SERVER";
import { manifest } from "MANIFEST";
import { env } from "ENV";
import { mimes } from "mrmime";

// mrmime does not include x-icon because it is non-standard. Setting it here
// because the default sveltekit site provides a favicon.ico and we want it to
// be served with the correct MIME type. If it is not served with an `image/*`
// MIME type, serverless-express will not serve it correctly.
mimes["ico"] = "image/x-icon";

/* global ENV_PREFIX */

const server = new Server(manifest);
await server.init({ env: process.env });

const origin = env("ORIGIN", undefined);
const xff_depth = parseInt(env("XFF_DEPTH", "1"));
const address_header = env("ADDRESS_HEADER", "").toLowerCase();
const protocol_header = env("PROTOCOL_HEADER", "").toLowerCase();
const host_header = env("HOST_HEADER", "host").toLowerCase();
const body_size_limit = parseInt(env("BODY_SIZE_LIMIT", "524288"));

// Body size limit is 6MB for synchronous invocation payloads
// Ref: https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html
if (body_size_limit > 6 * 1024 * 1024) {
  throw new Error("BODY_SIZE_LIMIT cannot exceed 6MB");
}

const dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {string} path
 * @param {boolean} client
 */
function serve(path, client = false) {
  return (
    fs.existsSync(path) &&
    sirv(path, {
      etag: true,
      gzip: true,
      brotli: true,
      setHeaders:
        client &&
        ((res, pathname) => {
          // only apply to build directory, not e.g. version.json
          if (pathname.startsWith(`/${manifest.appDir}/immutable/`)) {
            res.setHeader("cache-control", "public,max-age=31536000,immutable");
          }
        }),
    })
  );
}

/**
 * @param {ReadableStream} readableStream
 * @returns {Promise<Buffer>} a buffer containing the stream contents
 */
async function readStreamToBuffer(readableStream) {
  let buf = [];
  const reader = readableStream.getReader();

  for (;;) {
    const { done, value } = await reader.read();

    if (done) break;

    buf.push(value);
  }

  return Buffer.concat(buf);
}

/**
 * Custom setResponse implementation for Lambda. Lambda does not provide support
 * for streaming responses, so instead of writing a chunk at a time, collect all
 * the data for the response and return it in one chunk.
 *
 * @param {import('http').ServerResponse} res
 * @param {Response} response
 */
async function setResponse(res, response) {
  const headers = Object.fromEntries(response.headers);

  if (response.headers.has("set-cookie")) {
    const header = /** @type {string} */ (response.headers.get("set-cookie"));
    const split = set_cookie_parser.splitCookiesString(header);

    // @ts-expect-error
    headers["set-cookie"] = split;
  }

  res.writeHead(response.status, headers);

  if (!response.body) {
    res.end();
    return;
  }

  const text = await readStreamToBuffer(response.body);
  res.end(text);
}

/** @type {import('polka').Middleware} */
const ssr = async (req, res) => {
  let request;

  try {
    request = await getRequest({
      base: origin || get_origin(req.headers),
      request: req,
      bodySizeLimit: body_size_limit,
    });
  } catch (err) {
    res.statusCode = err.status || 400;
    res.end("Invalid request body");
    return;
  }

  if (address_header && !(address_header in req.headers)) {
    throw new Error(
      `Address header was specified with ${
        ENV_PREFIX + "ADDRESS_HEADER"
      }=${address_header} but is absent from request`
    );
  }

  setResponse(
    res,
    await server.respond(request, {
      getClientAddress: () => {
        if (address_header) {
          const value =
            /** @type {string} */ (req.headers[address_header]) || "";

          if (address_header === "x-forwarded-for") {
            const addresses = value.split(",");

            if (xff_depth < 1) {
              throw new Error(
                `${ENV_PREFIX + "XFF_DEPTH"} must be a positive integer`
              );
            }

            if (xff_depth > addresses.length) {
              throw new Error(
                `${ENV_PREFIX + "XFF_DEPTH"} is ${xff_depth}, but only found ${
                  addresses.length
                } addresses`
              );
            }
            return addresses[addresses.length - xff_depth].trim();
          }

          return value;
        }

        return (
          req.connection?.remoteAddress ||
          // @ts-expect-error
          req.connection?.socket?.remoteAddress ||
          req.socket?.remoteAddress ||
          // @ts-expect-error
          req.info?.remoteAddress
        );
      },
    })
  );
};

/** @param {import('polka').Middleware[]} handlers */
function sequence(handlers) {
  /** @type {import('polka').Middleware} */
  return (req, res, next) => {
    /** @param {number} i */
    function handle(i) {
      handlers[i](req, res, () => {
        if (i < handlers.length) handle(i + 1);
        else next();
      });
    }

    handle(0);
  };
}

/**
 * @param {import('http').IncomingHttpHeaders} headers
 * @returns
 */
function get_origin(headers) {
  const protocol = (protocol_header && headers[protocol_header]) || "https";
  const host = headers[host_header];
  return `${protocol}://${host}`;
}

export const handler = sequence(
  [
    serve(path.join(dir, "client"), true),
    serve(path.join(dir, "static")),
    serve(path.join(dir, "prerendered")),
    ssr,
  ].filter(Boolean)
);
