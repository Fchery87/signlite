import { useMemo, useRef, useState } from 'react';
import type { SessionDocument } from '../db/schema';
import { STRINGS } from '../lib/strings';
import { createSessionDocument, getFileValidationError, type FileValidationError } from '../lib/files';
import type { IntakeCommitOutcome } from '../stores/session';
import { Button } from './ui';

type IntakeItem =
  | { id: string; fileName: string; status: 'loading' }
  | { id: string; fileName: string; status: 'accepted'; pageCount: number }
  | { id: string; fileName: string; status: 'rejected'; reason: string };

/** Outcome the store returns when committing an intake result. */
type CommitOutcome = IntakeCommitOutcome;

/** One toast-and-item copy per validation variant; a new variant without copy is a compile error. */
const REJECTION_REASONS: Record<FileValidationError, (fileName: string) => string> = {
  'pdf-only': (fileName) => `${fileName} — ${STRINGS.errors['pdf-only']}`,
  'too-large': (fileName) => STRINGS.edgeCases.fileTooLarge(fileName),
  'session-limit': (fileName) => `${fileName} — ${STRINGS.errors['session-limit']}`,
  'session-page-limit': (fileName) => `${fileName} — ${STRINGS.errors['session-page-limit']}`,
  'session-byte-limit': (fileName) => `${fileName} — ${STRINGS.errors['session-byte-limit']}`,
  encrypted: (fileName) => `${fileName} — ${STRINGS.errors.encrypted}`,
  corrupt: (fileName) => STRINGS.edgeCases.corruptFile(fileName)
};

const COMMIT_REFUSALS: Record<Exclude<CommitOutcome, 'ok'>, string> = {
  lease: STRINGS.errors['intake-lease-refused'],
  'session-changed': STRINGS.errors['intake-session-changed'],
  budget: STRINGS.errors['intake-budget-refused']
};

type DropZoneProps = {
  currentDocumentCount: number;
  currentPageCount: number;
  currentByteCount?: number;
  sessionId?: string;
  onDocumentsAccepted: (documents: SessionDocument[], expectedSessionId?: string) => CommitOutcome;
  onToast: (message: string) => void;
};

export function DropZone({ currentDocumentCount, currentPageCount, currentByteCount = 0, sessionId, onDocumentsAccepted, onToast }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [intakeItems, setIntakeItems] = useState<IntakeItem[]>([]);
  // Intake runs are queued so overlapping drops commit in order against fresh
  // budgets; the store rechecks ceilings and session identity authoritatively.
  const intakeQueue = useRef<Promise<unknown>>(Promise.resolve());
  const budgetRef = useRef({ currentDocumentCount, currentPageCount, currentByteCount });
  budgetRef.current = { currentDocumentCount, currentPageCount, currentByteCount };

  const overlayClassName = useMemo(
    () => (isDragging ? 'border-accent bg-accent-subtle text-ink' : 'border-line bg-surface text-ink'),
    [isDragging]
  );

  const processFiles = (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;

    // Capture session identity now; a session swap during intake must not
    // commit this result into the new session.
    const preparedForSessionId = sessionId;
    if (inputRef.current) {
      inputRef.current.value = '';
    }

    intakeQueue.current = intakeQueue.current.then(() => runIntake(files, preparedForSessionId));
  };

  const runIntake = async (files: File[], preparedForSessionId: string | undefined) => {
    const items = files.map((file, index) => ({
      id: `${file.name}-${file.lastModified}-${index}`,
      fileName: file.name,
      status: 'loading' as const
    }));
    setIntakeItems(items);
    const updateItem = (index: number, item: IntakeItem) => {
      setIntakeItems((current) => current.map((entry, entryIndex) => entryIndex === index ? item : entry));
    };

    const accepted: SessionDocument[] = [];
    let acceptedPageCount = 0;
    let acceptedByteCount = 0;

    for (const [index, file] of files.entries()) {
      const budget = budgetRef.current;
      const validationError = getFileValidationError(file, {
        documentCount: budget.currentDocumentCount + accepted.length,
        pageCount: budget.currentPageCount + acceptedPageCount,
        byteCount: budget.currentByteCount + acceptedByteCount
      });
      if (validationError !== null) {
        // Exhaustive: every non-null validation result rejects the file before
        // any parse work, with per-file copy from the registry.
        const reason = REJECTION_REASONS[validationError](file.name);
        updateItem(index, { ...items[index], status: 'rejected', reason });
        onToast(reason);
        continue;
      }

      try {
        const document = await createSessionDocument(file, {
          currentPageCount: budgetRef.current.currentPageCount,
          acceptedPageCount
        });
        accepted.push(document);
        acceptedPageCount += document.pageCount;
        acceptedByteCount += document.pdfBytes.byteLength;
        updateItem(index, { ...items[index], status: 'accepted', pageCount: document.pageCount });
      } catch (error) {
        const code = error instanceof Error && error.message in STRINGS.errors ? (error.message as keyof typeof STRINGS.errors) : 'corrupt';
        const reason = code === 'corrupt' ? STRINGS.edgeCases.corruptFile(file.name) : STRINGS.errors[code];
        updateItem(index, { ...items[index], status: 'rejected', reason });
        onToast(code === 'corrupt' ? reason : `${file.name} — ${reason}`);
      }
    }

    if (accepted.length > 0) {
      const outcome = onDocumentsAccepted(accepted, preparedForSessionId);
      if (outcome !== 'ok') {
        onToast(COMMIT_REFUSALS[outcome]);
      }
    }
  };

  return (
    <section
      className="flex min-h-screen items-center justify-center p-6"
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        if (event.currentTarget === event.target) {
          setIsDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        void processFiles(event.dataTransfer.files);
      }}
    >
      <div className={`w-full max-w-2xl border border-dashed p-12 text-center transition ${overlayClassName}`}>
        <div className="mx-auto mb-6 h-24 w-24 bg-sunken" />
        <h1 className="text-display text-ink">{STRINGS.dropZone.title}</h1>
        <p className="mt-3 text-body text-quiet">{STRINGS.dropZone.subtitle}</p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <input
            ref={inputRef}
            hidden
            type="file"
            accept="application/pdf"
            multiple
            onChange={(event) => {
              void processFiles(event.target.files);
            }}
          />
          <Button variant="secondary" onClick={() => inputRef.current?.click()}>
            {STRINGS.dropZone.chooseFiles}
          </Button>
        </div>
        {intakeItems.length > 0 && (
          <div className="surface-card mt-6 p-4 text-left" aria-live="polite">
            <p className="text-body font-medium text-ink">{STRINGS.dropZone.loadingTitle}</p>
            <ul className="mt-2 space-y-1 text-body text-quiet">
              {intakeItems.map((item) => (
                <li key={item.id} className="flex justify-between gap-4">
                  <span className="truncate">{item.fileName}</span>
                  <span className="shrink-0">
                    {item.status === 'loading' ? STRINGS.dropZone.loading : null}
                    {item.status === 'accepted' ? STRINGS.dropZone.loaded(item.pageCount) : null}
                    {item.status === 'rejected' ? item.reason : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
