export type SignliteErrorCode =
  | 'encrypted'
  | 'corrupt'
  | 'too-large'
  | 'quota'
  | 'import-invalid'
  | 'import-too-large'
  | 'import-too-many'
  | 'import-conflict'
  | 'idb-unavailable'
  | 'pdf-only'
  | 'session-limit'
  | 'session-page-limit'
  | 'session-byte-limit'
  | 'intake-lease-refused'
  | 'intake-session-changed'
  | 'intake-budget-refused'
  | 'upload-invalid'
  | 'upload-too-large';

export const STRINGS = {
  appName: 'SignLite',
  workSessionLocked: (owner: string) => `Work Session locked by ${owner}. Editing is temporarily disabled.`,
  footerLoaded: (count: number) => `${count} document${count === 1 ? '' : 's'} loaded.`,
  liveRegionLabel: 'Editor status',
  shortcuts: {
    open: 'Keyboard shortcuts',
    hint: 'Press ? for shortcuts.',
    currentDownload: 'Download current PDF',
    batchDownload: 'Download batch zip',
    removeSelection: 'Remove selected placement',
    nudge: 'Nudge selected placement',
    clearSelection: 'Clear selection',
    closeDialog: 'Close dialog',
    copySelection: 'Copy selected placement',
    pasteOnPage: 'Paste on current page',
    duplicateSelection: 'Duplicate selected placement',
    undo: 'Undo',
    redo: 'Redo'
  },
  dropZone: {
    title: 'Drop a PDF anywhere.',
    subtitle: 'Or choose files.',
    chooseFiles: 'Choose files',
    loadingTitle: 'Loading files…',
    loading: 'Loading…',
    loaded: (pageCount: number) => `Ready, ${pageCount} page${pageCount === 1 ? '' : 's'}.`
  },
  resumePrompt: 'Resume last session?',
  startFresh: 'Start fresh',
  readOnly: 'Another tab is editing this Work Session. This view is read-only.',
  resume: 'Resume',
  buttons: {
    close: 'Close',
    dismiss: 'Dismiss',
    confirm: 'Confirm',
    cancel: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    edit: 'Edit',
    export: 'Export',
    import: 'Import',
    download: 'Download',
    addPdfs: 'Add PDFs',
    downloadAll: 'Download all',
    applyToAll: 'Apply to all',
    signTheRest: (count: number) => count === 1 ? 'Sign the other one like this.' : `Sign the other ${count} like this.`,
    replaceAndApply: 'Replace and apply',
    placeOnEveryPage: 'Place on every page',
    placeDateOnEveryPage: 'Place date on every page',
    placeTextOnEveryPage: 'Place text on every page',
    remove: 'Remove',
    place: 'Place',
    duplicate: 'Duplicate',
    clear: 'Clear',
    copy: 'Copy',
    undo: 'Undo',
    redo: 'Redo'
  },
  tooltips: {
    nothingPlacedYet: 'Nothing placed yet.'
  },
  status: {
    pending: 'Pending',
    placed: 'Placed',
    signing: 'Signing',
    signed: 'Signed',
    needsReview: 'Needs review',
    error: 'Error',
    template: 'Template'
  },
  editor: {
    pagesTitle: 'Pages',
    pagesTotal: (count: number) => `${count} total`,
    pageOf: (pageNumber: number, pageCount: number) => `Page ${Math.min(pageNumber, pageCount)} of ${pageCount}`,
    zoomLabel: 'Zoom',
    pageLabel: (pageNumber: number) => `Page ${pageNumber}`,
    dateAdded: 'Date added to page.',
    textAdded: 'Text box added to page.',
    downloading: 'Downloading…',
    downloadSuccess: (fileName: string) => `Done. Downloaded ${fileName}.`,
    downloadFailed: 'Could not download this PDF.',
    writeFailed: (fileName: string) => `Couldn't write ${fileName}. Try re-saving the PDF from its source.`,
    unsupportedCharacters: (chars: string) =>
      `These characters can't be written into the PDF with the bundled font: ${chars}. Replace them or remove the text, then download again.`,
    pdfLoadFallback: 'Could not load this PDF.',
    pagePreviewUnavailable: 'Preview unavailable',
    removeFromSession: 'Remove from session',
    showPages: 'Show pages',
    hidePages: 'Hide pages',
    showLibrary: 'Show library',
    hideLibrary: 'Hide library',
    elementsTitle: 'Elements',
    elementsEmpty: 'Nothing placed yet.',
    elementPageLabel: (pageNumber: number) => `Page ${pageNumber}`,
    deleteElement: (label: string, pageNumber: number) => `Delete ${label} on page ${pageNumber}`,
    copiedHint: 'Copied. Press Ctrl+V to paste on the page you are viewing.',
    placementFailed: 'Could not place this signature.',
    invalidDropPayload: 'That item cannot be placed here.',
    stampedOnEveryPage: (label: string, count: number) => `${label} placed on ${count} other page${count === 1 ? '' : 's'}.`,
    stampNoOtherPages: 'Already on every page.',
    stampFailed: 'Could not place this on every page.'
  },
  loading: {
    editor: 'Loading editor…',
    page: 'Rendering page…',
    thumbnail: 'Rendering preview…'
  },
  library: {
    title: 'Library',
    subtitle: 'Saved here for next time.',
    storedLocal: 'Stored in this browser, on this machine.',
    backupPlaintext: 'Exports are plain JSON with PNGs.',
    addMenu: 'Add library item',
    draw: 'Draw',
    type: 'Type',
    upload: 'Upload',
    date: 'Date',
    text: 'Text',
    placeOnPage: (pageNumber: number) => `Place on page ${pageNumber}`,
    empty: 'No saved signatures. Draw one to get started.',
    signatures: 'Signatures',
    initials: 'Initials',
    emptyGroup: (label: string) => `No saved ${label.toLowerCase()} yet.`,
    deleteTitle: 'Delete saved item?',
    deleteBody: "Export a backup first if you're not sure.",
    exportSuccess: 'Library exported.',
    importSummary: (added: number, skipped: number) => `Added ${added}. Skipped ${skipped} duplicates.`,
    renamed: 'Library item renamed.',
    deleted: 'Library item deleted.',
    imageSaved: 'Image saved to your library.',
    drawTitle: 'Draw signature',
    typeTitle: 'Type signature',
    fontNotReady: 'Fonts are still loading. Try again in a moment.',
    retryFont: 'Retry font load',
    typeNamePlaceholder: 'Type your name',
    typeInitialsPlaceholder: 'Type your initials',
    typedPreviewAlt: 'Typed signature preview',
    drawSaved: 'Signature saved.',
    initialsSaved: 'Initials saved.',
    saveFailed: 'Could not save this signature.',
    uploadFailed: 'Could not save this image.'
  },
  batch: {
    title: 'Batch',
    subtitle: 'Drag to reorder.',
    applyTitle: 'Apply to all',
    applySubtitle: (fileName: string) => `Copy placements from ${fileName} to the rest of the batch.`,
    downloadTitle: 'Download all',
    readyForDownload: (count: number) => `${count} document${count === 1 ? '' : 's'} ready for zip download.`,
    signingProgress: (done: number, total: number) => `Signing ${done} of ${total}…`,
    nothingToApply: 'Nothing to apply yet.',
    readinessLine: (ready: number, review: number) => `${ready} ready. ${review} needs review.`,
    readinessNamesFile: (fileName: string) => `${fileName} needs review.`,
    appliedSummary: (count: number) => `Applied to ${count} document${count === 1 ? '' : 's'}.`,
    reviewSummary: (count: number) => `${count} document${count === 1 ? ' needs' : 's need'} review.`,
    appliedAndReviewSummary: (applied: number, review: number) => `Applied to ${applied}. ${review} need review.`,
    replaceTitle: 'Replace existing placements?',
    replaceBody: (count: number) => `This will replace Placements or end Signed state on ${count} document${count === 1 ? '' : 's'}.`,
    signedWillEnd: 'Signed state will end and Placements will be replaced.',
    placementsWillReplace: 'Placements will be replaced with a fresh template copy.',
    stalePreview: 'The Work Session changed. Review the targets and try again.',
    signing: 'Signing…',
    batchDone: (count: number) => `Done. ${count} document${count === 1 ? '' : 's'} signed.`,
    batchFailed: 'Could not finish this batch.',
    batchFailedAll: 'Could not sign any of these PDFs.',
    batchCancelled: 'Batch signing cancelled.',
    batchDeliveryFailed: 'Could not deliver the signed documents.',
    batchNoEligible: 'No documents are ready to sign.',
    needsReviewMissingPage: 'Needs review — this document is missing a template page.',
    needsReviewAspect: 'Differs from template — review.',
    needsReviewMissingSignature: 'Needs review — a signature image could not be recovered.',
    needsReviewPageGeometry: 'Needs review — page layout could not be read from this document.',
  },
  announcements: {
    placedOnPage: (label: string, pageNumber: number) => `${label} placed on page ${pageNumber}.`
  },
  imports: {
    noBackupYet: 'No backup yet.',
    exportOffered: (value: string) => `Export offered ${value}. Keep the downloaded file safe.`,
    backupReminderDays: 'Back up your signatures. It has been over 30 days since the last export offer.',
    backupReminderCount: 'Back up your signatures. 10 or more new items were added since the last export offer.'
  },
  localData: {
    clearHistoryButton: 'Clear document history',
    clearAllButton: 'Clear all local data',
    clearHistoryTitle: 'Clear document history?',
    clearHistoryBody:
      'This removes every saved Work Session: the PDFs you loaded and the placements you made. Your signature library and preferences are kept.',
    clearAllTitle: 'Clear all local data?',
    clearAllBody:
      'This removes saved Work Sessions (PDFs and placements), your entire signature library, and your preferences, from this browser. There is no undo.',
    retentionNote: 'SignLite keeps data only in this browser. Unopened Work Sessions older than 7 days are removed on their own. A clear cannot be undone.',
    exportFirst: 'Export signatures first',
    anotherTab: 'Another tab is editing this Work Session, so it cannot be cleared here.',
    busyBatch: 'A batch download is running. Wait for it to finish before clearing data.',
    locksUnavailable: 'This browser cannot verify that other tabs are idle, so clearing is disabled.',
    clearedHistory: 'Document history cleared. Signatures and preferences kept.',
    clearedAll: 'All local data cleared.'
  },
  readiness: {
    preparing: 'Preparing the offline signing runtime…',
    ready: 'Ready to sign offline.',
    failed: 'The signing runtime failed to prepare.',
    retry: 'Retry preparation'
  },
  errors: {
    encrypted: 'This PDF is password-protected. Unlock it and drop it again.',
    corrupt: "Couldn't read this PDF. The file may be damaged.",
    'too-large': 'This file is too large (limit 100 MB).',
    quota: "Couldn't save — browser storage is full.",
    'import-invalid': "This isn't a SignLite library file.",
    'import-too-large': 'This library file is too large (limit 64 MB).',
    'import-too-many': 'This library file has too many signatures (limit 1,000).',
    'import-conflict': "This file has two different signatures with the same ID.",
    'idb-unavailable': "This browser can't save your library. Signing works; saved signatures won't survive this tab.",
    'pdf-only': 'PDF only for now.',
    'session-limit': 'Session limit is 50 documents.',
    'session-page-limit': 'Session limit is 500 pages total.',
    'session-byte-limit': 'Session limit is 500 MB of PDFs total.',
    'intake-lease-refused': 'Not added — signing is in progress.',
    'intake-session-changed': 'That import no longer matches this session.',
    'intake-budget-refused': 'Not added — session limits reached.',
    'upload-invalid': 'PNG or JPEG only, up to 10 MB.',
    'upload-too-large': 'PNG or JPEG only, up to 10 MB.'
  } satisfies Record<SignliteErrorCode, string>,
  edgeCases: {
    corruptFile: (fileName: string) => `Couldn't read ${fileName}. The file may be damaged.`,
    fileTooLarge: (fileName: string) => `${fileName} is too large (limit 100 MB).`
  },
  durability: {
    initializing: '',
    saved: 'Saved.',
    dirty: 'Unsaved changes.',
    saving: 'Saving…',
    'memory-only': 'Memory only.',
    error: 'Autosave problem.',
    conflict: 'Storage conflict.'
  } satisfies Record<'initializing' | 'saved' | 'dirty' | 'saving' | 'memory-only' | 'error' | 'conflict', string>,
  warnings: {
    autosaveOff: "Storage is full. Autosave is off — your changes will not survive a page reload."
  },
  crash: {
    title: 'Something went wrong.',
    body: 'Your saved signatures and the current Work Session are stored in this browser, so reloading should pick up where you left off.',
    reload: 'Reload',
    dismiss: 'Try to continue'
  }
} as const;
