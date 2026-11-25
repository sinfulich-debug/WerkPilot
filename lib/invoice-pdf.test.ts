import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildEInvoiceXml, EInvoiceError } from './e-invoice';
import type { Invoice } from './finance';
import { buildInvoicePdf, FACTURX_FILE_NAME, invoicePdfFileName } from './invoice-pdf';

const seller = {
  companyName: 'Kfz Meier & Söhne <GmbH>', ownerName: 'Hans Meier', street: 'Werkstattstr. 1', zip: '70173', city: 'Stuttgart',
  phone: '0711 123456', email: 'info@meier.example', website: null, taxNumber: '12/345/67890', vatId: 'DE123456789',
  bankName: 'Sparkasse', iban: 'DE89 3704 0044 0532 0130 00', bic: 'COBADEFFXXX',
};
const buyer = { name: 'Anna "Annie" Müller & Co', vehiclePlate: 'S-WN 1234', email: null, phone: null, street: 'Kundenweg 2', zip: '70174', city: 'Stuttgart' };
const invoice: Invoice = {
  id: '1', customerId: 'c', vehicleId: null, number: 'RE-2026-0001', customer: 'Anna', plate: 'S-WN 1234',
  lines: [
    { id: 'a', description: 'Arbeitszeit', quantity: 1.5, unit: 'HUR', unitPrice: 95 },
    { id: 'b', description: 'Ölwechsel „Premium“ – 5 l', quantity: 1, unit: 'LS', unitPrice: 89.5 },
  ],
  taxMode: 'standard19', serviceDate: '2026-11-10', dueAt: '2026-12-01', issuedAt: '2026-11-17T10:00:00.000Z', status: 'issued', paidAmount: 0,
  sellerSnapshot: seller, buyerSnapshot: buyer,
};

/** Every flate-compressed stream of the PDF, inflated, as text. */
function inflatedStreams(pdf: Buffer): string[] {
  const text = pdf.toString('latin1');
  const result: string[] = [];
  for (const match of Array.from(text.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g))) {
    try {
      result.push(inflateSync(Buffer.from(match[1], 'latin1')).toString('utf8'));
    } catch {
      // not a compressed stream (image, ICC profile, XMP): ignore
    }
  }
  return result;
}

/** The uncompressed XMP packet. */
function xmpPacket(pdf: Buffer): string {
  const text = pdf.toString('utf8');
  const start = text.indexOf('<?xpacket begin');
  const end = text.indexOf('<?xpacket end="w"?>');
  if (start < 0 || end < 0) throw new Error('no XMP packet found');
  return text.slice(start, end + '<?xpacket end="w"?>'.length);
}

function assertWellFormed(xml: string): void {
  const stack: string[] = [];
  const body = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  for (const match of Array.from(body.matchAll(/<(\/?)([A-Za-z0-9:_-]+)((?:\s+[A-Za-z0-9:_-]+="[^"]*")*)\s*(\/?)>/g))) {
    const [, closing, tag, , selfClosing] = match;
    if (selfClosing) continue;
    if (closing) {
      if (stack.pop() !== tag) throw new Error(`mismatched </${tag}>`);
    } else {
      stack.push(tag);
    }
  }
  if (stack.length > 0) throw new Error(`unclosed: ${stack.join(', ')}`);
  // any "&" must start an entity, any "<" must start a tag: otherwise the data was not escaped
  if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(body)) throw new Error('unescaped ampersand');
}

describe('hybrid ZUGFeRD PDF', () => {
  it('is a PDF 1.7 file with the structure PDF/A-3 needs', async () => {
    const pdf = await buildInvoicePdf(invoice);
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.7')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/OutputIntents');
    expect(text).toContain('/GTS_PDFA1');
    expect(text).toContain('/Type /Metadata');
    expect(text).toContain('/AF [');
  });

  it('declares PDF/A-3b and the Factur-X properties in the XMP metadata', async () => {
    const xmp = xmpPacket(await buildInvoicePdf(invoice));
    expect(xmp).toContain('<pdfaid:part>3</pdfaid:part>');
    expect(xmp).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    expect(xmp).toContain('<fx:DocumentType>INVOICE</fx:DocumentType>');
    expect(xmp).toContain(`<fx:DocumentFileName>${FACTURX_FILE_NAME}</fx:DocumentFileName>`);
    expect(xmp).toContain('<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>');
    expect(xmp).toContain('urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#');
    // PDF/A demands the extension schema for these custom properties
    expect(xmp).toContain('<pdfaSchema:prefix>fx</pdfaSchema:prefix>');
  });

  it('keeps the XMP valid when names contain &, < or quotes (pdfkit alone would not)', async () => {
    const xmp = xmpPacket(await buildInvoicePdf(invoice));
    expect(() => assertWellFormed(xmp)).not.toThrow();
    expect(xmp).toContain('Kfz Meier &amp; Söhne &lt;GmbH&gt;');
    expect(xmp).toContain('Anna &quot;Annie&quot; Müller &amp; Co');
    expect(xmp).not.toContain('Söhne <GmbH>');
  });

  it('embeds the e-invoice XML as the alternative representation, byte for byte', async () => {
    const pdf = await buildInvoicePdf(invoice);
    const text = pdf.toString('latin1');
    expect(text).toContain('/AFRelationship /Alternative');
    expect(text).toContain(`/F (${FACTURX_FILE_NAME})`);
    expect(text).toContain('/Subtype /text#2Fxml');
    const embedded = inflatedStreams(pdf).find((stream) => stream.startsWith('<?xml'));
    expect(embedded).toBe(buildEInvoiceXml(invoice));
    expect(embedded).toContain('<ram:ID>urn:cen.eu:en16931:2017</ram:ID>');
  });

  it('embeds the fonts (PDF/A forbids relying on the reader having them)', async () => {
    const text = (await buildInvoicePdf(invoice)).toString('latin1');
    expect(text).toContain('/FontFile2');
    expect(text).not.toMatch(/\/BaseFont \/(Helvetica|Times|Courier|Symbol|ZapfDingbats)/);
  });

  it('adds pages when the invoice has many lines, with the totals on the last one', async () => {
    const lines = Array.from({ length: 60 }, (_, index) => ({
      id: String(index), description: `Position ${index + 1} mit einer längeren Beschreibung zum Umbruch`, quantity: 1, unit: 'C62' as const, unitPrice: 10,
    }));
    const text = (await buildInvoicePdf({ ...invoice, lines })).toString('latin1');
    const pages = text.match(/\/Type \/Page\b(?!s)/g) ?? [];
    expect(pages.length).toBeGreaterThanOrEqual(3);
  });

  it('builds a Storno as a credit note PDF', async () => {
    const storno: Invoice = {
      ...invoice, number: 'RE-2026-0002', cancelsInvoiceId: 'orig', cancelsNumber: 'RE-2026-0001', dueAt: null,
      lines: invoice.lines.map((line) => ({ ...line, quantity: -line.quantity })),
    };
    const pdf = await buildInvoicePdf(storno);
    const embedded = inflatedStreams(pdf).find((stream) => stream.startsWith('<?xml')) ?? '';
    expect(embedded).toContain('<ram:TypeCode>381</ram:TypeCode>');
    expect(embedded).toContain('<ram:IssuerAssignedID>RE-2026-0001</ram:IssuerAssignedID>');
  });

  it('refuses drafts and incomplete invoices like the XML export does', async () => {
    await expect(buildInvoicePdf({ ...invoice, status: 'draft', number: null, issuedAt: null })).rejects.toBeInstanceOf(EInvoiceError);
    await expect(buildInvoicePdf({ ...invoice, sellerSnapshot: { ...seller, taxNumber: null, vatId: null } })).rejects.toThrow('Steuernummer');
  });

  it('names the file after the invoice number', () => {
    expect(invoicePdfFileName('RE-2026-0001')).toBe('zugferd_RE-2026-0001.pdf');
    expect(invoicePdfFileName('RE/2026 1')).toBe('zugferd_RE_2026_1.pdf');
  });
});
