import path from 'path';
import fs from 'fs';
import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function debugLogPlugin(): Plugin {
    const logFile = path.resolve(__dirname, 'debug-logs.txt');
    return {
        name: 'debug-log-writer',
        configureServer(server) {
            server.middlewares.use('/api/debug-logs', (req, res) => {
                if (req.method === 'POST') {
                    let body = '';
                    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
                    req.on('end', () => {
                        try {
                            const { action, data } = JSON.parse(body);
                            if (action === 'append') {
                                fs.appendFileSync(logFile, data + '\n');
                            } else if (action === 'flush') {
                                fs.writeFileSync(logFile, data);
                            } else if (action === 'clear') {
                                fs.writeFileSync(logFile, '');
                            }
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end('{"ok":true}');
                        } catch (e) {
                            res.writeHead(400);
                            res.end('{"error":"bad json"}');
                        }
                    });
                } else {
                    res.writeHead(405);
                    res.end();
                }
            });
        }
    };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), debugLogPlugin()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
