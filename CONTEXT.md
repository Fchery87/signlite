# SignLite

SignLite is a local-only tool for placing a reusable signature on one or more documents and producing signed copies without uploading private files.

## Language

**Work Session**:
The reload-safe, ordered set of documents currently being signed. It owns everything required to preserve and produce its placements after they are created.
_Avoid_: Workspace, job

**Signature Library**:
The persistent collection of reusable signatures and initials available for future placements. A library item's visible image is immutable; its label and usage metadata may change, and deleting it does not change existing placements.
_Avoid_: Asset store, signature database

**Placement**:
A signature, initials, date, or text positioned on one page within a Work Session. A signature or initials placement is an immutable snapshot of the selected Signature Library item.
_Avoid_: Field, annotation

**Batch Signing**:
One attempt to produce a downloadable ZIP from every currently eligible document in a Work Session. Each attempt is a complete current snapshot; a per-document failure does not prevent successful documents from being delivered.
_Avoid_: Batch job, bulk task

**Signed Document**:
A document included in a completed output artifact offered for download. It remains editable; a content change ends that signed state, while in-progress signing is transient operation state rather than durable Work Session status.
_Avoid_: Processed document, completed document
