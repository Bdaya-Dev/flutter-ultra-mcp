import { request as httpRequest } from 'node:http';
import WebSocket from 'ws';

export interface CdpError {
  ts: number;
  level: 'error' | 'warning';
  message: string;
  source: 'cdp';
}

interface CdpTarget {
  webSocketDebuggerUrl?: string;
  type?: string;
}

export class CdpConsoleCapture {
  private ws: WebSocket | null = null;
  private errors: CdpError[] = [];
  private messageId = 0;
  private static MAX_ERRORS = 500;

  get capturedErrors(): ReadonlyArray<CdpError> {
    return this.errors;
  }

  private discoverWsUrl(port: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        { hostname: '127.0.0.1', port, path: '/json', method: 'GET' },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            body += chunk;
          });
          res.on('end', () => {
            try {
              const targets = JSON.parse(body) as CdpTarget[];
              const page = targets.find((t) => t.type === 'page') ?? targets[0];
              if (!page?.webSocketDebuggerUrl) {
                reject(new Error('no webSocketDebuggerUrl in /json response'));
                return;
              }
              resolve(page.webSocketDebuggerUrl);
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.on('error', reject);
      req.setTimeout(5_000, () => {
        req.destroy(new Error('timeout'));
      });
      req.end();
    });
  }

  async connect(port: number): Promise<void> {
    this.disconnect();
    const wsUrl = await this.discoverWsUrl(port);
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.on('message', (data: WebSocket.Data) => {
      this.handleMessage(String(data));
    });

    ws.on('error', () => {
      this.ws = null;
    });

    ws.on('close', () => {
      this.ws = null;
    });

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => {
        resolve();
      });
      ws.once('error', (err) => {
        reject(err);
      });
    });

    this.send('Runtime.enable');
    this.send('Log.enable');
  }

  disconnect(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* already closed */
      }
      this.ws = null;
    }
  }

  private send(method: string, params?: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const id = ++this.messageId;
    this.ws.send(JSON.stringify({ id, method, params }));
  }

  private handleMessage(data: string): void {
    let msg: { method?: string; params?: Record<string, unknown> };
    try {
      msg = JSON.parse(data) as { method?: string; params?: Record<string, unknown> };
    } catch {
      return;
    }
    if (!msg.method) return;

    if (msg.method === 'Runtime.exceptionThrown') {
      const detail = (
        msg.params as { exceptionDetails?: { text?: string; exception?: { description?: string } } }
      )?.exceptionDetails;
      const text = detail?.exception?.description ?? detail?.text ?? 'Unknown exception';
      this.pushError('error', text);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const p = msg.params as { type?: string; args?: { value?: unknown; description?: string }[] };
      if (p.type === 'error' || p.type === 'warning') {
        const parts = (p.args ?? []).map((a) => a.description ?? String(a.value ?? ''));
        this.pushError(p.type as 'error' | 'warning', parts.join(' '));
      }
    } else if (msg.method === 'Log.entryAdded') {
      const entry = (msg.params as { entry?: { level?: string; text?: string } })?.entry;
      if (entry?.level === 'error' || entry?.level === 'warning') {
        this.pushError(entry.level as 'error' | 'warning', entry.text ?? '');
      }
    }
  }

  private pushError(level: 'error' | 'warning', message: string): void {
    if (!message) return;
    this.errors.push({ ts: Date.now(), level, message, source: 'cdp' });
    if (this.errors.length > CdpConsoleCapture.MAX_ERRORS) {
      this.errors.splice(0, this.errors.length - CdpConsoleCapture.MAX_ERRORS);
    }
  }
}
