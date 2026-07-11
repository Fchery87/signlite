import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
const lifecycle = vi.hoisted(() => ({ candidate: null as import('../../src/db/schema').WorkSession | null, ready: true, mode: 'persistent' as 'persistent'|'memory', warning: null as string|null, resumeSucceeded: vi.fn(), startFresh: vi.fn() }));
vi.mock('../../src/lib/useSessionLifecycle', () => ({ useSessionLifecycle: () => lifecycle }));
vi.mock('../../src/components/DropZone', () => ({ DropZone: ({ currentDocumentCount }: { currentDocumentCount: number }) => <div>DropZone {currentDocumentCount}</div> }));
vi.mock('../../src/components/editor/EditorView', () => ({ EditorView: () => <div>Editor</div> }));
import App from '../../src/App';
import { sessionStoreTestHarness, createInitialSession } from '../../src/stores/session';
import type { WorkSession } from '../../src/db/schema';
function saved(): WorkSession { return { id:'saved',createdAt:1,updatedAt:2,documents:[{docId:'d',fileName:'a.pdf',pdfBytes:new ArrayBuffer(1),pageCount:1,pageSizes:[{w:1,h:1}],placements:[],status:'pending'}],templatePlacements:[] }; }
describe('App lifecycle presentation', () => {
 beforeEach(()=>{ sessionStoreTestHarness.setState({session:createInitialSession(),selectedDocumentId:null,selectedPlacementId:null,view:'dropzone',mutationLease:null,mutationLock:null}); lifecycle.candidate=null;lifecycle.mode='persistent';lifecycle.warning=null;lifecycle.startFresh.mockReset();lifecycle.resumeSucceeded.mockReset(); });
 it('delegates Start Fresh',()=>{lifecycle.candidate=saved();render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Start fresh'}));expect(lifecycle.startFresh).toHaveBeenCalledOnce();});
 it('restores and acknowledges a candidate',async()=>{lifecycle.candidate=saved();render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Resume'}));await waitFor(()=>expect(lifecycle.resumeSucceeded).toHaveBeenCalledOnce());expect(sessionStoreTestHarness.getState().session.id).toBe('saved');});
 it('renders durability and lock warnings',async()=>{lifecycle.mode='memory';lifecycle.warning='Autosave is using memory only. Changes will not survive reload.';render(<App/>);let lease: ReturnType<ReturnType<typeof sessionStoreTestHarness.getState>['acquireMutationLease']> = null;act(()=>{lease=sessionStoreTestHarness.getState().acquireMutationLease('Batch Signing attempt 42');});expect(await screen.findByText(lifecycle.warning)).toBeInTheDocument();expect(screen.getAllByText(/will not survive reload/i)).toHaveLength(1);expect(screen.getByText(/Work Session locked by Batch Signing attempt 42/)).toHaveAttribute('aria-live','polite');if(lease)act(()=>{sessionStoreTestHarness.getState().releaseMutationLease(lease!);});});
});
