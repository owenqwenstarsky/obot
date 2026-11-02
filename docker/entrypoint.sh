#!/bin/sh
set -e

echo "[obot] applying database migrations…"
cd /migrate && ./node_modules/.bin/prisma migrate deploy

echo "[obot] starting server on :${PORT:-3000}"
cd /app && exec node server.js
