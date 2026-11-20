import { describe, expect, it } from 'vitest';
import type { MusicInfo } from '../sources';
import { aggregateListeningEvents, createListeningSession, sampleListeningSession, seekListeningSession, parseListeningEvents, upsertListeningEvent, createListeningStatsIndex } from './listening-session';

const song = { id: '1', source: 'wy', name: 'Song', singer: 'Artist', interval: 300 } as MusicInfo;
const sample = (at: number, position: number, playing = true, rate = 1) => ({ at, position, playing, rate });

describe('actual listening sessions', () => {
  it('measures wall time at 1.5x and excludes pause and seek distance', () => {
    let state = createListeningSession('first', song, 1000, sample(0, 0, true, 1.5));
    state = sampleListeningSession(state, sample(10_000, 15, true, 1.5));
    expect(state.event.listenedMs).toBe(10_000);
    state = sampleListeningSession(state, sample(11_000, 16.5, false, 1.5));
    state = sampleListeningSession(state, sample(30_000, 16.5, true, 1.5));
    state = seekListeningSession(state, sample(30_000, 200, true, 1.5));
    state = sampleListeningSession(state, sample(32_000, 203, true, 1.5));
    expect(state.event.listenedMs).toBe(13_000);
  });

  it('does not count stalled playback or unannounced progress jumps', () => {
    let state = createListeningSession('stall', song, 1000, sample(0, 0));
    state = sampleListeningSession(state, sample(5_000, 0));
    state = sampleListeningSession(state, sample(6_000, 200));
    state = sampleListeningSession(state, sample(7_000, 201));
    expect(state.event.listenedMs).toBe(1000);
  });

  it('retains separate same-song sessions and never derives listening from song length', () => {
    const first = { sessionId: 'first', song, startedAt: 1000, listenedMs: 2000 };
    const second = { ...first, sessionId: 'second', startedAt: 2000, listenedMs: 1000 };
    let events = upsertListeningEvent([], first);
    events = upsertListeningEvent(events, { ...first, listenedMs: 5000 });
    events = upsertListeningEvent(events, second);
    events = upsertListeningEvent(events, first);
    const stats = aggregateListeningEvents(events);
    expect(stats.totalMs).toBe(6000);
    expect(stats.totalPlays).toBe(2);
    expect(stats.topTracks[0].plays).toBe(2);
  });

  it('rejects corrupt disk events and does not migrate old history', () => {
    expect(() => parseListeningEvents([{ song, playedAt: 1000 }])).toThrow();
    expect(() => parseListeningEvents([{ sessionId: 'x', song, startedAt: 1, listenedMs: -1 }])).toThrow();
    expect(parseListeningEvents(null)).toEqual([]);
  });

  it('loads many sessions with linear identity lookups and retains the greatest checkpoint', () => {
    let identityReads = 0;
    const entries = Array.from({ length: 2000 }, (_, index) => ({
      get sessionId() { identityReads += 1; return `session-${index}`; },
      song, startedAt: index + 1, listenedMs: index,
    }));
    const parsed = parseListeningEvents([...entries, { sessionId: 'session-1', song, startedAt: 2, listenedMs: 9000 }]);
    expect(parsed).toHaveLength(2000);
    expect(parsed[1].listenedMs).toBe(9000);
    expect(identityReads).toBeLessThan(20_000);
  });
});

describe('incremental listening statistics', () => {
  it('matches full aggregation after checkpoints, new sessions, and corrected identities and dates', () => {
    const index = createListeningStatsIndex();
    let events: Parameters<typeof aggregateListeningEvents>[0] = [];
    const first = { sessionId: 'first', song, startedAt: new Date(2026, 0, 31, 23, 59).getTime(), listenedMs: 0 };
    const updates = [first, { ...first, listenedMs: 1000 },
      { ...first, sessionId: 'second', listenedMs: 1000 },
      { ...first, listenedMs: 3000 },
      { ...first, listenedMs: 2000 },
      { ...first, listenedMs: 4000, startedAt: new Date(2026, 1, 1).getTime(), song: { ...song, id: 'other', singer: 'Other' } },
      { ...first, sessionId: 'third', listenedMs: 2500, song: { ...song, singer: '' } },
    ];
    for (const event of updates) {
      events = upsertListeningEvent(events, event);
      index.record(event);
      expect(index.snapshot()).toEqual(aggregateListeningEvents(events));
    }
  });

  it('preserves published snapshots and returns the same snapshot for replayed checkpoints', () => {
    const first = { sessionId: 'first', song, startedAt: Date.UTC(2026, 1, 1), listenedMs: 1000 };
    const index = createListeningStatsIndex([first]);
    const snapshot = index.snapshot();
    expect(index.record(first)).toBe(false);
    expect(index.snapshot()).toBe(snapshot);
    index.record({ ...first, listenedMs: 2000 });
    expect(snapshot.totalMs).toBe(1000);
    expect(snapshot.topTracks[0].totalMs).toBe(1000);
    expect(index.snapshot().totalMs).toBe(2000);
  });

  it('uses local calendar dates across UTC month and daylight-saving boundaries', () => {
    const events = [
      { sessionId: 'before', song, startedAt: new Date(2026, 2, 8, 0, 30).getTime(), listenedMs: 1000 },
      { sessionId: 'after', song, startedAt: new Date(2026, 2, 8, 23, 30).getTime(), listenedMs: 2000 },
      { sessionId: 'month', song, startedAt: new Date(2026, 1, 1, 0, 30).getTime(), listenedMs: 3000 },
    ];
    expect(createListeningStatsIndex(events).snapshot()).toEqual(aggregateListeningEvents(events));
  });
});
