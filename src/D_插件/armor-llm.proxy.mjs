#!/usr/bin/env node
/**
 * Fallback delivery path: a loopback proxy that rewrites the provider request
 * body before forwarding it upstream.
 *
 * Use it only when the `llm/fetch` hook cannot be mounted (it mutates a
 * request-local copy, so nothing else has to change). With the hook available,
 * this file is not needed — it exists because a proxy is the only delivery path
 * that works for transports the hook does not cover (the DeepSeek native
 * adapter's custom `fetchImpl`, or any non-pi-ai route).
 *
 * Wire-up: point the provider's `baseURL` at this listener, e.g.
 *   baseURL: http://127.0.0.1:18410/v1
 * and pass the real endpoint as `--upstream`.
 *
 * Guarantees:
 *   - SSE is streamed chunk-by-chunk (`readable.pipe(res)`), never buffered.
 *   - Non-POST / non-JSON / body-less requests are forwarded byte-for-byte.
 *   - Headers (including authorization) are passed through untouched and never
 *     logged. Only the injected system message's first 200 chars are logged.
 *
 * Usage:
 *   node proxy.mjs --listen 127.0.0.1:18410 --upstream https://host/v1 \
 *                  [--armor ./armor.md] [--log ./proxy.log]
 */

import { createServer, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MARKER, createArmorSource, injectIntoJsonText, describeInjected } from './lib/armor-core.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const out = { listen: '127.0.0.1:0', upstream: '', armor: resolve(HERE, 'armor.md'), log: '' }
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    const value = argv[i + 1]
    if (key === '--listen') { out.listen = value; i += 1 }
    else if (key === '--upstream') { out.upstream = value; i += 1 }
    else if (key === '--armor') { out.armor = resolve(process.cwd(), value); i += 1 }
    else if (key === '--log') { out.log = resolve(process.cwd(), value); i += 1 }
  }
  return out
}

export function startProxy(options) {
  const armour = createArmorSource(options.armor, { marker: MARKER })
  const marker = options.marker ?? MARKER
  const upstream = new URL(options.upstream)
  const isHttps = upstream.protocol === 'https:'
  const doRequest = isHttps ? httpsRequest : httpRequest

  const writeLog = (line) => {
    const text = `${new Date().toISOString()} ${line}\n`
    process.stdout.write(text)
    if (options.log) {
      try {
        mkdirSync(dirname(options.log), { recursive: true })
        appendFileSync(options.log, text)
      } catch { /* logging must never break the proxy */ }
    }
  }

  /** Join the upstream base path with the inbound path without duplicating a shared prefix. */
  const joinPath = (inboundUrl) => {
    const basePath = upstream.pathname.replace(/\/+$/u, '')
    const inboundPath = inboundUrl.replace(/^(\.\/)?/u, '')
    if (basePath === '' || basePath === '/') return inboundPath
    if (inboundPath === basePath) return inboundPath
    if (inboundPath.startsWith(`${basePath}/`)) return inboundPath
    return `${basePath}${inboundPath.startsWith('/') ? '' : '/'}${inboundPath}`
  }

  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('error', () => { try { res.destroy() } catch {} })
    req.on('end', () => {
      let body = Buffer.concat(chunks)
      const contentType = String(req.headers['content-type'] ?? '').toLowerCase()
      const injectable = req.method === 'POST' && contentType.includes('application/json') && body.length > 0

      if (injectable) {
        try {
          const result = injectIntoJsonText(body.toString('utf8'), armour(), marker)
          if (result.changed) {
            body = Buffer.from(result.body, 'utf8')
            writeLog(`INJECT ok (${result.kind}) ${req.method} ${req.url} -> ${describeInjected(result.body, 200)}`)
          } else {
            writeLog(`INJECT skip (${result.reason}) ${req.method} ${req.url}`)
          }
        } catch (error) {
          writeLog(`INJECT error ${error.message}`)
        }
      } else {
        writeLog(`PASS ${req.method} ${req.url} (${body.length}B ct=${contentType || 'none'})`)
      }

      const headers = { ...req.headers }
      delete headers.host
      headers['content-length'] = String(body.length)

      const upstreamReq = doRequest(
        {
          protocol: upstream.protocol,
          hostname: upstream.hostname,
          port: upstream.port || (isHttps ? 443 : 80),
          method: req.method,
          path: joinPath(req.url ?? '/'),
          headers,
        },
        (upstreamRes) => {
          res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
          // Streamed, not buffered: SSE chunks reach the client as they arrive.
          upstreamRes.pipe(res)
          upstreamRes.on('error', () => { try { res.destroy() } catch {} })
          writeLog(`RESP ${upstreamRes.statusCode} ${req.method} ${req.url}`)
        },
      )
      upstreamReq.on('error', (error) => {
        writeLog(`UPSTREAM error ${error.message}`)
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
        try { res.end(JSON.stringify({ error: { message: `armor-llm proxy: ${error.message}`, type: 'proxy_upstream_error' } })) } catch {}
      })
      req.on('aborted', () => { try { upstreamReq.destroy() } catch {} })
      upstreamReq.end(body)
    })
  })

  const [host, port] = options.listen.split(':')
  return new Promise((resolveReady) => {
    server.listen(Number(port ?? 0), host || '127.0.0.1', () => {
      const address = server.address()
      writeLog(`LISTEN http://${address.address}:${address.port} -> ${upstream.href}`)
      resolveReady({ server, address, writeLog })
    })
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2))
  if (!args.upstream) {
    process.stderr.write('armor-llm proxy: --upstream is required\n')
    process.exit(2)
  }
  await startProxy(args)
}
