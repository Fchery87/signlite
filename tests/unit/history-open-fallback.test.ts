import { beforeEach, describe, expect, it, vi } from 'vitest';
const schemaMocks = vi.hoisted(() => ({ openSignliteDb: vi.fn() }));
vi.mock('../../src/db/schema', () => schemaMocks);
import { loadLatestSession, resetHistoryFallbackForTests, saveSession } from '../../src/db/history';
import type { WorkSession } from '../../src/db/schema';
const session = (): WorkSession => ({ id:'open-fallback',createdAt:1,updatedAt:2,templatePlacements:[],documents:[{docId:'doc',fileName:'local.pdf',pdfBytes:new ArrayBuffer(1),pageCount:1,pageSizes:[{w:10,h:10}],placements:[],status:'pending'}] });
describe('history open failure fallback',()=>{beforeEach(()=>{resetHistoryFallbackForTests();schemaMocks.openSignliteDb.mockReset().mockRejectedValue(new Error('unavailable'));});it('retains and reloads the active Work Session in memory when database opening fails',async()=>{expect(await saveSession(session())).toBe('memory');expect(await loadLatestSession()).toEqual(expect.objectContaining({id:'open-fallback'}));});});
