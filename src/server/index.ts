import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { WebSocketHandler } from './wsHandler.js';

const PORT = parseInt(process.env.PORT || '8080', 10);
const STATIC_DIR = path.resolve(process.cwd(), 'dist/client');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  let urlPath = req.url || '/';

  // Remove query strings
  const queryIdx = urlPath.indexOf('?');
  if (queryIdx !== -1) urlPath = urlPath.substring(0, queryIdx);

  // Default to index.html
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(STATIC_DIR, urlPath);

  // Prevent directory traversal
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback: serve index.html for all non-file routes
      const indexPath = path.join(STATIC_DIR, 'index.html');
      fs.readFile(indexPath, (err2, indexData) => {
        if (err2) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(indexData);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// Health check endpoint
function handleHealthCheck(res: http.ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
}

// Create HTTP server
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    handleHealthCheck(res);
    return;
  }
  serveStatic(req, res);
});

// Create WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });
const wsHandler = new WebSocketHandler();

wss.on('connection', (ws: WebSocket) => {
  console.log('Client connected');
  wsHandler.handleConnection(ws);
});

// Start server
server.listen(PORT, () => {
  console.log(`Neon Riders server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
  console.log(`Rooms: ${wsHandler.getRoomCount()} | Players: ${wsHandler.getPlayerCount()}`);
});
