import { PDFArray, PDFDict, PDFDocument, PDFName, PDFObject, PDFRef, PDFStream } from 'pdf-lib';

export type ExportPolicyReport = { removedJavaScriptActions: number; removedLaunchActions: number };
export class PdfExportPolicyError extends Error {
  constructor(readonly code: 'malformed' | 'overbudget', message: string) {
    super(message);
    this.name = 'PdfExportPolicyError';
  }
}
type PolicyOptions = { maxObjects?: number; maxDepth?: number; maxWork?: number };
const key = PDFName.of;

/** Restricted action removal. Stream contents, attachments and other action kinds are not sanitized. */
export function applyExportPolicy(pdf: PDFDocument, options: PolicyOptions = {}): ExportPolicyReport {
  const limits = { maxObjects: options.maxObjects ?? 100_000, maxDepth: options.maxDepth ?? 128, maxWork: options.maxWork ?? 500_000 };
  const report: ExportPolicyReport = { removedJavaScriptActions: 0, removedLaunchActions: 0 };
  const objects = new Set<PDFObject>();
  const walked = new Map<PDFObject, Set<string>>();
  const actionResults = new Map<PDFObject, PDFObject | null>();
  const activeActions = new Set<PDFObject>();
  let work = 0;
  const malformed = (message: string): never => { throw new PdfExportPolicyError('malformed', `Cannot safely apply PDF export policy: ${message}`); };
  const check = (value: PDFObject, depth: number) => {
    objects.add(value);
    if (++work > limits.maxWork || depth > limits.maxDepth || objects.size > limits.maxObjects) {
      throw new PdfExportPolicyError('overbudget', 'PDF export policy exceeded its processing limit.');
    }
  };
  const resolve = (value: PDFObject, depth: number): PDFObject => {
    check(value, depth);
    if (!(value instanceof PDFRef)) return value;
    const target = pdf.context.lookup(value);
    if (!target) return malformed('missing indirect object.');
    check(target, depth + 1);
    return target;
  };
  const replace = (dict: PDFDict, name: PDFName, value: PDFObject | null) => {
    if (value) dict.set(name, value);
    else dict.delete(name);
  };
  const sanitizeAction = (input: PDFObject, depth: number): PDFObject | null => {
    const value = resolve(input, depth);
    if (activeActions.has(value)) return malformed('cyclic action chain.');
    if (actionResults.has(value)) return actionResults.get(value) ?? null;
    activeActions.add(value);
    let result: PDFObject | null;
    if (value instanceof PDFArray) {
      const surviving: PDFObject[] = [];
      for (const item of value.asArray()) {
        const sanitized = sanitizeAction(item, depth + 1);
        if (sanitized instanceof PDFArray) surviving.push(...sanitized.asArray());
        else if (sanitized) surviving.push(sanitized);
      }
      result = surviving.length > 0 ? pdf.context.obj(surviving) : null;
    } else if (value instanceof PDFDict) {
      const subtype = value.get(key('S'));
      if (!subtype) return malformed('action has no subtype.');
      const resolvedSubtype = resolve(subtype, depth + 1);
      if (!(resolvedSubtype instanceof PDFName)) return malformed('invalid action subtype.');
      const next = value.get(key('Next'));
      const sanitizedNext = next ? sanitizeAction(next, depth + 1) : null;
      replace(value, key('Next'), sanitizedNext);
      const name = resolvedSubtype.decodeText();
      if (name === 'JavaScript' || name === 'Launch') {
        if (name === 'JavaScript') report.removedJavaScriptActions += 1;
        else report.removedLaunchActions += 1;
        // Make every alias inert, including aliases outside an action-bearing entry.
        value.delete(key('S'));
        value.delete(key('JS'));
        value.delete(key('F'));
        value.delete(key('Win'));
        value.delete(key('Next'));
        result = sanitizedNext;
      } else {
        result = value;
      }
    } else {
      return malformed('action is not a dictionary or action array.');
    }
    activeActions.delete(value);
    actionResults.set(value, result);
    return result;
  };
  const singleAction = (input: PDFObject, depth: number): PDFObject | null => {
    const result = sanitizeAction(input, depth);
    if (!(result instanceof PDFArray)) return result;
    const actions = result.asArray();
    const first = actions[0];
    if (!first) return null;
    if (!(first instanceof PDFDict)) return malformed('invalid surviving action.');
    if (actions.length > 1) {
      const existing = first.get(key('Next'));
      const following = existing instanceof PDFArray ? existing.asArray() : existing ? [existing] : [];
      first.set(key('Next'), pdf.context.obj([...following, ...actions.slice(1)]));
    }
    return first;
  };
  const walk = (input: PDFObject, depth: number, role = 'ordinary'): void => {
    const value = resolve(input, depth);
    const roles = walked.get(value) ?? new Set<string>();
    if (roles.has(role)) return;
    roles.add(role);
    walked.set(value, roles);
    if (value instanceof PDFStream) { walk(value.dict, depth + 1); return; }
    if (value instanceof PDFArray) {
      for (const child of value.asArray()) walk(child, depth + 1, role);
      return;
    }
    if (!(value instanceof PDFDict)) return;
    const type = value.lookupMaybe(key('Type'), PDFName)?.decodeText();
    const actionOwner = value === pdf.catalog || type === 'Annot' || type === 'Page' || role === 'annotation' || role === 'field' || role === 'outline';
    for (const [name, child] of value.entries()) {
      const field = name.decodeText();
      if (field === 'A' && actionOwner) {
        replace(value, name, singleAction(child, depth + 1));
      } else if (field === 'OpenAction' && value === pdf.catalog) {
        const target = resolve(child, depth + 1);
        // OpenAction can also be a benign destination array.
        if (target instanceof PDFArray) {
          const page = target.get(0);
          const mode = target.get(1);
          const destinationPage = page ? resolve(page, depth + 2) : null;
          if (!(destinationPage instanceof PDFDict) || destinationPage.lookupMaybe(key('Type'), PDFName)?.decodeText() !== 'Page' || !(mode instanceof PDFName)) {
            return malformed('invalid opening destination.');
          }
        } else replace(value, name, singleAction(child, depth + 1));
      } else if (field === 'AA' && actionOwner) {
        const additional = resolve(child, depth + 1);
        if (!(additional instanceof PDFDict)) return malformed('invalid additional-actions dictionary.');
        for (const [event, action] of additional.entries()) replace(additional, event, singleAction(action, depth + 2));
      } else if (field === 'Names' && value === pdf.catalog) {
        const names = resolve(child, depth + 1);
        if (!(names instanceof PDFDict)) return malformed('invalid document name dictionary.');
        const javaScript = names.get(key('JavaScript'));
        if (javaScript) {
          names.delete(key('JavaScript'));
          report.removedJavaScriptActions += 1;
        }
      }
      const surviving = value.get(name);
      let childRole = 'ordinary';
      if (field === 'Annots') childRole = 'annotation';
      if (field === 'Fields' || (role === 'field' && field === 'Kids')) childRole = 'field';
      if (field === 'Outlines' || (role === 'outline' && ['First', 'Last', 'Next', 'Prev'].includes(field))) childRole = 'outline';
      if (surviving) walk(surviving, depth + 1, childRole);
    }
  };
  walk(pdf.catalog, 0);
  return report;
}
