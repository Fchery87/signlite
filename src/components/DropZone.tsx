import { useMemo, useRef, useState } from 'react';
import type { SessionDocument } from '../db/schema';
import { STRINGS } from '../lib/strings';
import { createSessionDocument, getFileValidationError } from '../lib/files';
import { Button } from './ui';

type DropZoneProps = {
  currentDocumentCount: number;
  currentPageCount: number;
  onDocumentsAccepted: (documents: SessionDocument[]) => void;
  onToast: (message: string) => void;
};

export function DropZone({ currentDocumentCount, currentPageCount, onDocumentsAccepted, onToast }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [loadingNames, setLoadingNames] = useState<string[]>([]);

  const overlayClassName = useMemo(
    () => (isDragging ? 'border-accent bg-accent-subtle text-ink' : 'border-line bg-surface text-ink'),
    [isDragging]
  );

  const processFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;

    setLoadingNames(files.map((file) => file.name));

    const accepted: SessionDocument[] = [];
    let acceptedPageCount = 0;

    for (const file of files) {
      const validationError = getFileValidationError(file, currentDocumentCount, accepted.length);
      if (validationError === 'pdf-only') {
        onToast(`${file.name} — ${STRINGS.errors['pdf-only']}`);
        continue;
      }
      if (validationError === 'too-large') {
        onToast(STRINGS.edgeCases.fileTooLarge(file.name));
        continue;
      }
      if (validationError === 'session-limit') {
        onToast(`${file.name} — ${STRINGS.errors['session-limit']}`);
        continue;
      }

      try {
        const document = await createSessionDocument(file, {
          currentPageCount,
          acceptedPageCount
        });
        accepted.push(document);
        acceptedPageCount += document.pageCount;
      } catch (error) {
        const code = error instanceof Error && error.message in STRINGS.errors ? (error.message as keyof typeof STRINGS.errors) : 'corrupt';
        if (code === 'corrupt') {
          onToast(STRINGS.edgeCases.corruptFile(file.name));
          continue;
        }
        onToast(`${file.name} — ${STRINGS.errors[code]}`);
      }
    }

    if (accepted.length > 0) {
      onDocumentsAccepted(accepted);
    }

    setLoadingNames([]);
    if (inputRef.current) {
      inputRef.current.value = '';
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
        {loadingNames.length > 0 && (
          <div className="surface-card mt-6 p-4 text-left">
            <p className="text-body font-medium text-ink">{STRINGS.dropZone.loadingTitle}</p>
            <ul className="mt-2 space-y-1 text-body text-quiet">
              {loadingNames.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
