export type SignliteErrorCode =
  | 'encrypted'
  | 'corrupt'
  | 'too-large'
  | 'quota'
  | 'import-invalid'
  | 'idb-unavailable'
  | 'pdf-only'
  | 'session-limit'
  | 'session-page-limit'
  | 'upload-invalid'
  | 'upload-too-large';

export const STRINGS = {
  appName: 'SignLite',
  appShellReady: 'Foundation shell ready.',
  footerEmpty: 'Client-side by default.',
  footerLoaded: (count: number) => `${count} document${count === 1 ? '' : 's'} loaded.`,
  previewPrimitives: 'Preview primitives',
  uiPrimitivesTitle: 'UI primitives',
  uiPrimitivesBody: 'Buttons, modal focus trap, and auto-dismissing toast are wired.',
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
    loadingTitle: 'Loading files…'
  },
  resumePrompt: 'Resume last session?',
  startFresh: 'Start fresh',
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
    downloadAll: 'Download all',
    applyToAll: 'Apply to all',
    replaceAndApply: 'Replace and apply',
    remove: 'Remove',
    place: 'Place',
    duplicate: 'Duplicate',
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
    pageLabel: (pageNumber: number) => `Page ${pageNumber}`,
    dateAdded: 'Date added to page.',
    textAdded: 'Text box added to page.',
    downloading: 'Downloading…',
    downloadSuccess: (fileName: string) => `Done. Downloaded ${fileName}.`,
    downloadFailed: 'Could not download this PDF.',
    writeFailed: (fileName: string) => `Couldn't write ${fileName}. Try re-saving the PDF from its source.`,
    pdfLoadFallback: 'Could not load this PDF.',
    pagePreviewUnavailable: 'Preview unavailable',
    removeFromSession: 'Remove from session',
    elementsTitle: 'Elements',
    elementsEmpty: 'Nothing placed yet.',
    elementPageLabel: (pageNumber: number) => `Page ${pageNumber}`,
    deleteElement: (label: string, pageNumber: number) => `Delete ${label} on page ${pageNumber}`,
    copiedHint: 'Copied. Press Ctrl+V to paste on the page you are viewing.',
    placementFailed: 'Could not place this signature.'
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
    subtitle: 'Drag to reorder. The first document is the template.',
    applyTitle: 'Apply to all',
    applySubtitle: (fileName: string) => `Copy placements from ${fileName} to the rest of the batch.`,
    templatePlacements: 'Template placements',
    targets: 'Targets',
    overwrite: 'Overwrite',
    downloadTitle: 'Download all',
    readyForDownload: (count: number) => `${count} document${count === 1 ? '' : 's'} ready for zip download.`,
    signingProgress: (done: number, total: number) => `Signing ${done} of ${total}…`,
    nothingToApply: 'Nothing to apply yet.',
    appliedSummary: (count: number) => `Applied to ${count} document${count === 1 ? '' : 's'}.`,
    reviewSummary: (count: number) => `${count} document${count === 1 ? ' needs' : 's need'} review.`,
    appliedAndReviewSummary: (applied: number, review: number) => `Applied to ${applied}. ${review} need review.`,
    replaceTitle: 'Replace existing placements?',
    replaceBody: (count: number) => `This will replace placements on ${count} document${count === 1 ? '' : 's'} with a fresh copy of the template.`,
    signing: 'Signing…',
    batchDone: (count: number) => `Done. ${count} document${count === 1 ? '' : 's'} signed.`,
    batchFailed: 'Could not finish this batch.',
    batchFailedAll: 'Could not sign any of these PDFs.',
    needsReviewMissingPage: 'Needs review — this document is missing a template page.',
    needsReviewAspect: 'Differs from template — review.',
    needsReviewMissingSignature: 'Needs review — a signature image could not be recovered.'
  },
  announcements: {
    placedOnPage: (label: string, pageNumber: number) => `${label} placed on page ${pageNumber}.`
  },
  imports: {
    noBackupYet: 'No backup yet.',
    lastBackedUp: (value: string) => `Last backed up ${value}.`
  },
  errors: {
    encrypted: 'This PDF is password-protected. Unlock it and drop it again.',
    corrupt: "Couldn't read this PDF. The file may be damaged.",
    'too-large': 'This file is too large (limit 100 MB).',
    quota: "Couldn't save — browser storage is full.",
    'import-invalid': "This isn't a SignLite library file.",
    'idb-unavailable': "This browser can't save your library. Signing works; saved signatures won't survive this tab.",
    'pdf-only': 'PDF only for now.',
    'session-limit': 'Session limit is 50 documents.',
    'session-page-limit': 'Session limit is 500 pages total.',
    'upload-invalid': 'PNG or JPEG only, up to 10 MB.',
    'upload-too-large': 'PNG or JPEG only, up to 10 MB.'
  } satisfies Record<SignliteErrorCode, string>,
  edgeCases: {
    corruptFile: (fileName: string) => `Couldn't read ${fileName}. The file may be damaged.`,
    fileTooLarge: (fileName: string) => `${fileName} is too large (limit 100 MB).`
  },
  warnings: {
    autosaveOff: "Autosave is off — this session won't survive a reload."
  }
} as const;
