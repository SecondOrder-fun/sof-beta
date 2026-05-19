import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SSEChannelService } from '../../src/services/sseChannelService.js';

const noopLogger = { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() };

function fakeReply() {
  return { raw: { write: vi.fn(), end: vi.fn() } };
}

describe('SSEChannelService', () => {
  let svc;
  beforeEach(() => {
    svc = new SSEChannelService(noopLogger, ['raffle', 'infofi', 'rollover']);
  });

  it('rejects unknown channel on addConnection', () => {
    expect(() => svc.addConnection('bogus', 'c1', fakeReply())).toThrow(/unknown channel/i);
  });

  it('isolates broadcasts per channel', () => {
    const replyA = fakeReply();
    const replyB = fakeReply();
    svc.addConnection('raffle', 'a', replyA);
    svc.addConnection('infofi', 'b', replyB);
    svc.broadcast('raffle', { type: 'PositionUpdate', seasonId: 1 });
    expect(replyA.raw.write).toHaveBeenCalledTimes(1);
    expect(replyB.raw.write).not.toHaveBeenCalled();
  });

  it('removes connection that throws on write', () => {
    const replyA = fakeReply();
    replyA.raw.write.mockImplementation(() => { throw new Error('peer reset'); });
    svc.addConnection('raffle', 'a', replyA);
    svc.broadcast('raffle', { type: 'x' });
    expect(svc.getConnectionCount('raffle')).toBe(0);
  });

  it('counts connections per channel', () => {
    svc.addConnection('raffle', 'a', fakeReply());
    svc.addConnection('raffle', 'b', fakeReply());
    svc.addConnection('infofi', 'c', fakeReply());
    expect(svc.getConnectionCount('raffle')).toBe(2);
    expect(svc.getConnectionCount('infofi')).toBe(1);
    expect(svc.getConnectionCount('rollover')).toBe(0);
  });

  it('removeConnection is idempotent', () => {
    svc.addConnection('raffle', 'a', fakeReply());
    svc.removeConnection('raffle', 'a');
    svc.removeConnection('raffle', 'a');
    expect(svc.getConnectionCount('raffle')).toBe(0);
  });

  it('closeAllConnections clears every channel', () => {
    svc.addConnection('raffle', 'a', fakeReply());
    svc.addConnection('infofi', 'b', fakeReply());
    svc.closeAllConnections();
    expect(svc.getConnectionCount('raffle')).toBe(0);
    expect(svc.getConnectionCount('infofi')).toBe(0);
  });
});
