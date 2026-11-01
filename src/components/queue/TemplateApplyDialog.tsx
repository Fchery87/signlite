import { STRINGS } from '../../lib/strings';
import { useSessionStore } from '../../stores/session';
import { Button, Modal } from '../ui';

type TemplateApplyDialogProps = {
  sourceDocId: string | null;
  sourceFileName: string;
  onClose: () => void;
  onToast: (message: string) => void;
};

export function TemplateApplyDialog({ sourceDocId, sourceFileName, onClose, onToast }: TemplateApplyDialogProps) {
  const previewApplyTemplatePlacements = useSessionStore((state) => state.previewApplyTemplatePlacements);
  const applyTemplatePlacements = useSessionStore((state) => state.applyTemplatePlacements);
  const mutationLocked = useSessionStore((state) => state.mutationLock !== null);
  const preview = sourceDocId ? previewApplyTemplatePlacements(sourceDocId) : null;
  const overwriteCount = preview?.targets.filter((target) => target.overwritesPlacements || target.endsSignedState).length ?? 0;

  const apply = () => {
    if (!sourceDocId || !preview) return;
    const result = applyTemplatePlacements(sourceDocId, preview);
    if (!result.ok) {
      onToast(result.error === 'stale-preview' ? STRINGS.batch.stalePreview : STRINGS.editor.placementFailed);
      return;
    }
    if (result.appliedDocIds.length > 0 && result.needsReviewDocIds.length > 0) {
      onToast(STRINGS.batch.appliedAndReviewSummary(result.appliedDocIds.length, result.needsReviewDocIds.length));
    } else if (result.appliedDocIds.length > 0) {
      onToast(STRINGS.batch.appliedSummary(result.appliedDocIds.length));
    } else {
      onToast(STRINGS.batch.reviewSummary(result.needsReviewDocIds.length));
    }
    onClose();
  };

  return (
    <Modal open={sourceDocId !== null} title={STRINGS.queue.templateTitle(sourceFileName)} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-body leading-6 text-quiet">
          {preview ? STRINGS.queue.templateBody(preview.targets.length) : STRINGS.queue.templateNothing}
        </p>
        {overwriteCount > 0 ? <p className="text-caption text-warning">{STRINGS.batch.replaceBody(overwriteCount)}</p> : null}
        {preview && preview.targets.length > 0 ? (
          <ul className="max-h-48 space-y-2 overflow-auto border-y border-line py-2">
            {preview.targets.map((target) => (
              <li key={target.docId} className="flex items-start justify-between gap-3 text-caption">
                <span className="min-w-0 truncate font-medium text-ink">{target.fileName}</span>
                <span className="shrink-0 text-right text-quiet">
                  {target.needsReviewReason
                    ?? (target.endsSignedState ? STRINGS.batch.signedWillEnd : target.overwritesPlacements ? STRINGS.batch.placementsWillReplace : STRINGS.queue.readyToSign)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{STRINGS.buttons.cancel}</Button>
          <Button disabled={!preview || mutationLocked} onClick={apply}>
            {STRINGS.queue.templateConfirm(preview?.targets.length ?? 0)}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
