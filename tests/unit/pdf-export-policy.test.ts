import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFString } from 'pdf-lib';
import { applyExportPolicy, PdfExportPolicyError } from '../../src/pdf/exportPolicy';

const key = PDFName.of;

async function documentWithAction(type: string) {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  const action = pdf.context.obj({ S: key(type), JS: PDFString.of('synthetic'), F: PDFString.of('payload') });
  pdf.catalog.set(key('OpenAction'), action);
  return { pdf, action };
}

describe('restricted PDF export policy', () => {
  it.each(['JavaScript', 'Launch'])('removes a catalog %s action and preserves ordinary content', async (type) => {
    const { pdf } = await documentWithAction(type);
    const originalPages = pdf.getPageCount();
    const report = applyExportPolicy(pdf);
    expect(pdf.catalog.has(key('OpenAction'))).toBe(false);
    expect(report.removedJavaScriptActions + report.removedLaunchActions).toBe(1);
    const reloaded = await PDFDocument.load(await pdf.save());
    expect(reloaded.catalog.has(key('OpenAction'))).toBe(false);
    expect(reloaded.getPageCount()).toBe(originalPages);
  });

  it('removes every reference to a shared forbidden action', async () => {
    const { pdf, action } = await documentWithAction('JavaScript');
    const ref = pdf.context.register(action);
    pdf.catalog.set(key('OpenAction'), ref);
    const annotation = pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], A: ref });
    pdf.getPage(0).node.set(key('Annots'), pdf.context.obj([annotation]));
    applyExportPolicy(pdf);
    expect(pdf.catalog.has(key('OpenAction'))).toBe(false);
    expect(annotation.has(key('A'))).toBe(false);
  });

  it('promotes a safe Next link when removing its forbidden predecessor', async () => {
    const { pdf, action } = await documentWithAction('Launch');
    const safe = pdf.context.obj({ S: 'URI', URI: PDFString.of('https://example.com/') });
    action.set(key('Next'), safe);
    applyExportPolicy(pdf);
    expect(pdf.catalog.lookup(key('OpenAction'), PDFDict)).toBe(safe);
    expect(safe.lookup(key('URI'), PDFString).decodeText()).toBe('https://example.com/');
  });

  it('filters direct and indirect Next arrays and additional actions', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    const safe = pdf.context.obj({ S: 'URI', URI: PDFString.of('https://example.com/') });
    const js = pdf.context.obj({ S: 'JavaScript', JS: PDFString.of('synthetic') });
    safe.set(key('Next'), pdf.context.obj([js, pdf.context.register(js)]));
    page.node.set(key('AA'), pdf.context.obj({ O: js, C: safe }));
    applyExportPolicy(pdf);
    const aa = page.node.lookup(key('AA'), PDFDict);
    expect(aa.has(key('O'))).toBe(false);
    expect(aa.lookup(key('C'), PDFDict)).toBe(safe);
    expect(safe.has(key('Next'))).toBe(false);
  });

  it('removes document JavaScript names without removing unrelated metadata', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const names = pdf.context.obj({ JavaScript: { Names: [PDFString.of('auto'), { S: 'JavaScript', JS: PDFString.of('code') }] }, Dests: { Names: [] } });
    pdf.catalog.set(key('Names'), names);
    const metadata = pdf.context.obj({ JavaScript: PDFString.of('descriptive text') });
    pdf.catalog.set(key('CustomMetadata'), metadata);
    applyExportPolicy(pdf);
    expect(names.has(key('JavaScript'))).toBe(false);
    expect(names.has(key('Dests'))).toBe(true);
    expect(metadata.has(key('JavaScript'))).toBe(true);
  });

  it('preserves destination-array OpenAction and handles structural page cycles', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    const destination = pdf.context.obj([page.ref, 'Fit']);
    pdf.catalog.set(key('OpenAction'), destination);
    applyExportPolicy(pdf);
    expect(pdf.catalog.lookup(key('OpenAction'), PDFArray)).toBe(destination);
  });

  it('fails closed on missing action references', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.catalog.set(key('OpenAction'), PDFRef.of(999999));
    expect(() => applyExportPolicy(pdf)).toThrow(PdfExportPolicyError);
  });

  it('fails closed on an action-chain cycle', async () => {
    const { pdf, action } = await documentWithAction('JavaScript');
    action.set(key('Next'), action);
    expect(() => applyExportPolicy(pdf)).toThrow(PdfExportPolicyError);
  });

  it('enforces depth and object budgets', async () => {
    const { pdf } = await documentWithAction('JavaScript');
    expect(() => applyExportPolicy(pdf, { maxObjects: 1 })).toThrow(PdfExportPolicyError);
    expect(() => applyExportPolicy(pdf, { maxDepth: 0 })).toThrow(PdfExportPolicyError);
  });

  it('does not treat a Type3 glyph named A as an action', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    const glyphs = pdf.context.obj({ A: pdf.context.flateStream('0 0 m 10 10 l S') });
    page.node.set(key('Resources'), pdf.context.obj({ Font: { F1: { Type: 'Font', Subtype: 'Type3', CharProcs: glyphs } } }));
    expect(() => applyExportPolicy(pdf)).not.toThrow();
    expect(glyphs.has(key('A'))).toBe(true);
  });

  it('refuses an invalid OpenAction array instead of bypassing action checks', async () => {
    const { pdf, action } = await documentWithAction('JavaScript');
    pdf.catalog.set(key('OpenAction'), pdf.context.obj([action]));
    expect(() => applyExportPolicy(pdf)).toThrow(PdfExportPolicyError);
  });
});
