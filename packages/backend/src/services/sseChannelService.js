/**
 * Multi-channel SSE service. Each channel maintains its own connection map,
 * so a broadcast on `raffle` doesn't reach subscribers of `infofi`.
 *
 * Constructed with an explicit channel list to fail loud on typos in
 * broadcast(channel, ...) calls — better than silently routing into a
 * channel that no one is listening to.
 */
export class SSEChannelService {
  constructor(logger, channels) {
    this.logger = logger;
    this.channels = new Map();
    for (const name of channels) {
      this.channels.set(name, new Map());
    }
  }

  _channel(name) {
    const ch = this.channels.get(name);
    if (!ch) {
      throw new Error(`Unknown channel: ${name}`);
    }
    return ch;
  }

  addConnection(channel, id, reply) {
    this._channel(channel).set(id, reply);
    this.logger.info(`📡 SSE add ${channel}/${id} (total: ${this.getConnectionCount(channel)})`);
  }

  removeConnection(channel, id) {
    const ch = this._channel(channel);
    if (ch.delete(id)) {
      this.logger.info(`📡 SSE remove ${channel}/${id} (total: ${ch.size})`);
    }
  }

  broadcast(channel, message) {
    const ch = this._channel(channel);
    const payload = `data: ${JSON.stringify({ ...message, timestamp: new Date().toISOString() })}\n\n`;
    const dead = [];
    let sent = 0;
    for (const [id, reply] of ch.entries()) {
      try {
        reply.raw.write(payload);
        sent++;
      } catch (err) {
        this.logger.error(`❌ SSE write failed ${channel}/${id}: ${err.message}`);
        dead.push(id);
      }
    }
    for (const id of dead) ch.delete(id);
    if (sent > 0) {
      this.logger.debug(`📤 ${channel} → ${sent} clients (${dead.length} dropped)`);
    }
    return { sent, failed: dead.length };
  }

  getConnectionCount(channel) {
    return this._channel(channel).size;
  }

  getConnectionIds(channel) {
    return Array.from(this._channel(channel).keys());
  }

  closeAllConnections() {
    for (const [name, ch] of this.channels.entries()) {
      for (const [, reply] of ch.entries()) {
        try { reply.raw.end(); } catch { /* ignore */ }
      }
      ch.clear();
      this.logger.info(`📡 SSE closed channel ${name}`);
    }
  }
}

let _singleton = null;
const CHANNELS = ['raffle', 'infofi', 'rollover'];

export function getSSEChannelService(logger) {
  if (!_singleton) {
    _singleton = new SSEChannelService(logger, CHANNELS);
  }
  return _singleton;
}

export { CHANNELS };
