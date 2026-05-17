// Event bus for DevTools panel — creates structured events and forwards them
// to connected panel viewers via the PanelServer.

import { randomUUID } from 'node:crypto';
import type { PanelServer } from './panelServer.js';

export type EventType =
  | 'tool_call'
  | 'tool_result'
  | 'session_change'
  | 'log'
  | 'screenshot'
  | 'error'
  | 'custom';

export interface PanelEvent {
  id: string;
  type: EventType;
  timestamp: string;
  server?: string;
  tool?: string;
  payload?: Record<string, unknown>;
}

export class EventBus {
  private panelServer: PanelServer;

  constructor(panelServer: PanelServer) {
    this.panelServer = panelServer;
  }

  createEvent(
    type: EventType,
    server?: string,
    tool?: string,
    payload?: Record<string, unknown>,
  ): PanelEvent {
    return {
      id: randomUUID(),
      type,
      timestamp: new Date().toISOString(),
      ...(server ? { server } : {}),
      ...(tool ? { tool } : {}),
      ...(payload ? { payload } : {}),
    };
  }

  push(type: EventType, server?: string, tool?: string, payload?: Record<string, unknown>): number {
    const event = this.createEvent(type, server, tool, payload);
    return this.panelServer.broadcast(event);
  }
}
