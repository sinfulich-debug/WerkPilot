import { readFileSync } from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { getDateStringInTimeZone, INVOICE_TIME_ZONE } from './date';
import { buildEInvoiceXml, EInvoiceError, EN16931_GUIDELINE_ID, SMALL_BUSINESS_EXEMPTION_REASON, xmlEscape } from './e-invoice';
import { euroToCents, getTaxRateBps, quantityToMilli, type Invoice } from './finance';
import { formatEuro, invoiceTotals } from './money';
import { unitLabel } from './units';

/**
 * The hybrid ZUGFeRD / Factur-X invoice: a human-readable PDF/A-3 with the EN 16931 XML embedded in it
 * (file name "factur-x.xml", relationship "Alternative"). Receivers that read the data use the XML, people
 * read the PDF. Server only: it reads the font files from disk.
 */

export const FACTURX_FILE_NAME = 'factur-x.xml';

export function invoicePdfFileName(number: string): string {
  return `zugferd_${number.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
}
const FACTURX_NAMESPACE = 'urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#';

const PAGE = { width: 595.28, height: 841.89, margin: 50 };
const CONTENT_WIDTH = PAGE.width - 2 * PAGE.margin;
/** Where the footer starts; content must stay above it. */
const FOOTER_TOP = PAGE.height - 82;
const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#cbd5e1';
const ACCENT = '#be123c';

/** PDF/A requires every font to be embedded, so the standard PDF fonts cannot be used. */
const FONT_FILES = { regular: 'Inter_400Regular.ttf', bold: 'Inter_700Bold.ttf' } as const;
const fontCache = new Map<string, Buffer>();

function loadFont(file: string): Buffer {
  let font = fontCache.get(file);
  if (!font) {
    font = readFileSync(path.join(process.cwd(), 'assets', 'fonts', file));
    fontCache.set(file, font);
  }
  return font;
}

/** The euro formatter uses no-break spaces; ordinary spaces are safe in every font. */
function euro(cents: number): string {
  return formatEuro(cents).replace(/[  ]/g, ' ');
}

function formatDate(date: string | null): string {
  if (!date) return '–';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : getDateStringInTimeZone(new Date(date), INVOICE_TIME_ZONE);
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;
}

const quantityFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 });

/** The quantity of a line as milli-units; a Storno line is negative. */
function signedMilli(quantity: number): number {
  return quantity < 0 ? -quantityToMilli(-quantity) : quantityToMilli(quantity);
}

function addressLines(street: string | null, zip: string | null, city: string | null): string[] {
  return [street, [zip, city].filter(Boolean).join(' ') || null].filter((line): line is string => Boolean(line));
}

/** XMP block that declares the Factur-X properties, as PDF/A demands for every custom XMP property. */
function facturXMetadata(): string {
  const property = (name: string, description: string) => `
              <rdf:li rdf:parseType="Resource">
                <pdfaProperty:name>${name}</pdfaProperty:name>
                <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                <pdfaProperty:category>external</pdfaProperty:category>
                <pdfaProperty:description>${description}</pdfaProperty:description>
              </rdf:li>`;
  return `
        <rdf:Description xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#" rdf:about="">
          <pdfaExtension:schemas>
            <rdf:Bag>
              <rdf:li rdf:parseType="Resource">
                <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
                <pdfaSchema:namespaceURI>${FACTURX_NAMESPACE}</pdfaSchema:namespaceURI>
                <pdfaSchema:prefix>fx</pdfaSchema:prefix>
                <pdfaSchema:property>
                  <rdf:Seq>${property('DocumentFileName', 'name of the embedded XML invoice file')}${property('DocumentType', 'INVOICE')}${property('Version', 'The actual version of the Factur-X XML schema')}${property('ConformanceLevel', 'The conformance level of the embedded Factur-X data')}
                  </rdf:Seq>
                </pdfaSchema:property>
              </rdf:li>
            </rdf:Bag>
          </pdfaExtension:schemas>
        </rdf:Description>
        <rdf:Description xmlns:fx="${FACTURX_NAMESPACE}" rdf:about="">
          <fx:DocumentType>INVOICE</fx:DocumentType>
          <fx:DocumentFileName>${FACTURX_FILE_NAME}</fx:DocumentFileName>
          <fx:Version>1.0</fx:Version>
          <fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>
        </rdf:Description>
        `;
}

type Doc = InstanceType<typeof PDFDocument>;

type DocumentInfo = {
  Title?: string;
  Author?: string;
  Subject?: string;
  Keywords?: string;
  Creator?: string;
  Producer?: string;
  CreationDate?: Date;
};

/**
 * pdfkit copies title, author and the like into the XMP metadata without escaping them. The author is the
 * workshop's name and the subject contains the customer's name, so one "&" or "<" would make the XMP invalid
 * and with it the whole PDF/A. This replaces pdfkit's writer by one that escapes (same structure, same fields).
 */
function writeEscapedMetadata(doc: Doc, info: DocumentInfo): void {
  const escape = (value: string | undefined) => xmlEscape(value ?? '');
  const created = (info.CreationDate ?? new Date()).toISOString().split('.')[0] + 'Z';
  const holder = doc as unknown as { _addInfo: () => void; appendXML: (xml: string, newline?: boolean) => void };

  holder._addInfo = () => {
    holder.appendXML(`
        <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
            <xmp:CreateDate>${created}</xmp:CreateDate>
            <xmp:CreatorTool>${escape(info.Creator)}</xmp:CreatorTool>
        </rdf:Description>
        `);
    holder.appendXML(`
        <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
            <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escape(info.Title)}</rdf:li></rdf:Alt></dc:title>
            <dc:creator><rdf:Seq><rdf:li>${escape(info.Author)}</rdf:li></rdf:Seq></dc:creator>
            <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${escape(info.Subject)}</rdf:li></rdf:Alt></dc:description>
        </rdf:Description>
        `);
    holder.appendXML(`
        <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
            <pdf:Producer>${escape(info.Producer)}</pdf:Producer>
            <pdf:Keywords>${escape(info.Keywords)}</pdf:Keywords>
        </rdf:Description>
        `);
  };
}

/**
 * Builds the hybrid ZUGFeRD PDF of an issued invoice or Storno. Throws EInvoiceError, like the XML export,
 * when mandatory data is missing, so no incomplete e-invoice is produced.
 */
export async function buildInvoicePdf(invoice: Invoice): Promise<Buffer> {
  const xml = buildEInvoiceXml(invoice); // also checks that the invoice may be exported
  if (!invoice.number || !invoice.issuedAt) throw new EInvoiceError('Nur ausgestellte Rechnungen können als E-Rechnung exportiert werden.');

  const issuedAt = new Date(invoice.issuedAt);
  const isStorno = invoice.cancelsInvoiceId !== undefined;
  const taxRateBp = getTaxRateBps(invoice.taxMode);
  const moneyLines = invoice.lines.map((line) => ({
    qtyMilli: signedMilli(line.quantity),
    unitPriceCents: euroToCents(line.unitPrice),
    taxRateBp,
  }));
  const totals = invoiceTotals(moneyLines);

  const info: DocumentInfo & { ModDate: Date } = {
    Title: `${isStorno ? 'Stornorechnung' : 'Rechnung'} ${invoice.number}`,
    Author: invoice.sellerSnapshot.companyName,
    Subject: `${isStorno ? 'Stornorechnung' : 'Rechnung'} ${invoice.number} an ${invoice.buyerSnapshot.name}`,
    Keywords: `Rechnung, ZUGFeRD, Factur-X, ${EN16931_GUIDELINE_ID}`,
    Creator: 'WerkPilot',
    Producer: 'WerkPilot (PDFKit)',
    // the date of issue, so the same invoice always gives the same file
    CreationDate: issuedAt,
    ModDate: issuedAt,
  };
  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE.margin,
    pdfVersion: '1.7',
    subset: 'PDF/A-3b',
    bufferPages: true,
    info,
  });
  writeEscapedMetadata(doc, info);
  doc.registerFont('Regular', loadFont(FONT_FILES.regular));
  doc.registerFont('Bold', loadFont(FONT_FILES.bold));

  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  drawInvoice(doc, invoice, { isStorno, totals, moneyLines });
  drawFooters(doc, invoice);

  // pdfkit supports the relationship (written as /AFRelationship); its type definitions do not list it yet
  const attachment: NonNullable<Parameters<Doc['file']>[1]> & { relationship: 'Alternative' } = {
    name: FACTURX_FILE_NAME,
    type: 'text/xml',
    description: 'Rechnungsdaten im Format Factur-X / ZUGFeRD (EN 16931)',
    relationship: 'Alternative',
    creationDate: issuedAt,
    modifiedDate: issuedAt,
  };
  doc.file(Buffer.from(xml, 'utf8'), attachment);
  doc.appendXML(facturXMetadata());
  doc.end();
  return finished;
}

type DrawContext = {
  isStorno: boolean;
  totals: ReturnType<typeof invoiceTotals>;
  moneyLines: Array<{ qtyMilli: number; unitPriceCents: number; taxRateBp: number }>;
};

function drawInvoice(doc: Doc, invoice: Invoice, { isStorno, totals, moneyLines }: DrawContext): void {
  const seller = invoice.sellerSnapshot;
  const buyer = invoice.buyerSnapshot;
  let y = PAGE.margin;

  const banner = (text: string) => {
    doc.font('Bold').fontSize(10);
    const height = doc.heightOfString(text, { width: CONTENT_WIDTH - 24 }) + 14;
    doc.roundedRect(PAGE.margin, y, CONTENT_WIDTH, height, 6).lineWidth(1).strokeColor(ACCENT).stroke();
    doc.fillColor(ACCENT).text(text, PAGE.margin + 12, y + 7, { width: CONTENT_WIDTH - 24, align: 'center' });
    y += height + 10;
  };
  if (isStorno) banner(`STORNORECHNUNG zu Rechnung ${invoice.cancelsNumber ?? ''}`);
  if (invoice.status === 'cancelled') {
    banner(`STORNIERT${invoice.cancelledByNumber ? ` durch Stornorechnung ${invoice.cancelledByNumber}` : ''}`);
  }
  if (isStorno) {
    doc.font('Regular').fontSize(9).fillColor(INK);
    const note = `Diese Stornorechnung hebt die Rechnung ${invoice.cancelsNumber ?? ''} vollständig auf. Der Betrag wird mit dieser Rechnung verrechnet bzw. erstattet.`;
    doc.text(note, PAGE.margin, y, { width: CONTENT_WIDTH });
    y = doc.y + 10;
  }

  // buyer on the left, seller on the right
  const columnWidth = (CONTENT_WIDTH - 20) / 2;
  const leftX = PAGE.margin;
  const rightX = PAGE.margin + columnWidth + 20;
  doc.font('Regular').fontSize(8).fillColor(MUTED).text('Rechnungsempfänger', leftX, y, { width: columnWidth });
  doc.font('Bold').fontSize(13).fillColor(INK).text(buyer.name, leftX, doc.y + 2, { width: columnWidth });
  doc.font('Regular').fontSize(9.5).fillColor(INK);
  for (const line of addressLines(buyer.street, buyer.zip, buyer.city)) doc.text(line, leftX, doc.y, { width: columnWidth });
  if (buyer.email) doc.text(buyer.email, leftX, doc.y + 4, { width: columnWidth });
  if (buyer.phone) doc.text(buyer.phone, leftX, doc.y, { width: columnWidth });
  const leftEnd = doc.y;

  doc.font('Bold').fontSize(15).fillColor(INK).text(seller.companyName, rightX, y, { width: columnWidth, align: 'right' });
  doc.font('Regular').fontSize(9.5).fillColor(INK);
  if (seller.ownerName) doc.text(seller.ownerName, rightX, doc.y + 2, { width: columnWidth, align: 'right' });
  for (const line of addressLines(seller.street, seller.zip, seller.city)) doc.text(line, rightX, doc.y, { width: columnWidth, align: 'right' });
  for (const line of [seller.phone, seller.email, seller.website].filter((value): value is string => Boolean(value))) {
    doc.text(line, rightX, doc.y + 1, { width: columnWidth, align: 'right' });
  }
  y = Math.max(leftEnd, doc.y) + 14;
  doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + CONTENT_WIDTH, y).lineWidth(1.5).strokeColor(INK).stroke();
  y += 14;

  // number and dates
  const facts: Array<[string, string]> = [
    ['Rechnungsnummer', invoice.number ?? ''],
    ['Rechnungsdatum', formatDate(invoice.issuedAt)],
    ['Leistungsdatum', formatDate(invoice.serviceDate)],
  ];
  if (!isStorno) facts.push(['Fällig am', formatDate(invoice.dueAt)]);
  if (buyer.vehiclePlate) facts.push(['Kennzeichen', buyer.vehiclePlate]);
  const factWidth = CONTENT_WIDTH / 4;
  facts.forEach(([label, value], index) => {
    const x = PAGE.margin + (index % 4) * factWidth;
    const rowY = y + Math.floor(index / 4) * 34;
    doc.font('Regular').fontSize(8).fillColor(MUTED).text(label, x, rowY, { width: factWidth - 6 });
    doc.font('Bold').fontSize(10).fillColor(INK).text(value, x, rowY + 11, { width: factWidth - 6 });
  });
  y += Math.ceil(facts.length / 4) * 34 + 6;

  // table
  const columns = { description: PAGE.margin, quantity: PAGE.margin + 225, price: PAGE.margin + 315, amount: PAGE.margin + 410 };
  const widths = { description: 215, quantity: 80, price: 85, amount: CONTENT_WIDTH - 410 };
  const tableHeader = () => {
    doc.font('Bold').fontSize(8.5).fillColor(INK);
    doc.text('Leistung / Artikel', columns.description, y, { width: widths.description });
    doc.text('Menge', columns.quantity, y, { width: widths.quantity, align: 'right' });
    doc.text('Einzelpreis netto', columns.price, y, { width: widths.price, align: 'right' });
    doc.text('Betrag netto', columns.amount, y, { width: widths.amount, align: 'right' });
    y += 15;
    doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + CONTENT_WIDTH, y).lineWidth(1).strokeColor(INK).stroke();
    y += 6;
  };
  tableHeader();

  invoice.lines.forEach((line, index) => {
    doc.font('Regular').fontSize(9.5);
    const descriptionHeight = doc.heightOfString(line.description, { width: widths.description });
    const rowHeight = Math.max(descriptionHeight, 12) + 10;
    if (y + rowHeight > FOOTER_TOP - 20) {
      doc.addPage();
      y = PAGE.margin;
      tableHeader();
    }
    const net = invoiceTotals([moneyLines[index]]).netCents;
    // the table header (after a page break) switches to bold; every row sets its own font
    doc.font('Regular').fontSize(9.5);
    doc.fillColor(INK).text(line.description, columns.description, y, { width: widths.description });
    doc.fillColor(MUTED).text(`${quantityFormat.format(line.quantity)} ${unitLabel(line.unit)}`, columns.quantity, y, { width: widths.quantity, align: 'right' });
    doc.text(euro(moneyLines[index].unitPriceCents), columns.price, y, { width: widths.price, align: 'right' });
    doc.fillColor(INK).text(euro(net), columns.amount, y, { width: widths.amount, align: 'right' });
    y += rowHeight;
    doc.moveTo(PAGE.margin, y - 4).lineTo(PAGE.margin + CONTENT_WIDTH, y - 4).lineWidth(0.5).strokeColor(LINE).stroke();
  });

  // totals
  const taxLabel = invoice.taxMode === 'standard19' ? '19 %' : invoice.taxMode === 'reduced7' ? '7 %' : null;
  const totalsHeight = taxLabel ? 78 : 96;
  if (y + totalsHeight > FOOTER_TOP - 10) {
    doc.addPage();
    y = PAGE.margin;
  }
  y += 10;
  const totalsX = PAGE.margin + CONTENT_WIDTH - 230;
  const totalRow = (label: string, value: string, bold = false) => {
    doc.font(bold ? 'Bold' : 'Regular').fontSize(bold ? 11 : 9.5).fillColor(INK);
    doc.text(label, totalsX, y, { width: 130 });
    doc.text(value, totalsX + 130, y, { width: 100, align: 'right' });
    y += bold ? 18 : 15;
  };
  totalRow('Nettobetrag', euro(totals.netCents));
  if (taxLabel) {
    totalRow(`Umsatzsteuer ${taxLabel}`, euro(totals.taxCents));
  } else {
    doc.font('Regular').fontSize(8.5).fillColor(MUTED).text(`${SMALL_BUSINESS_EXEMPTION_REASON}.`, totalsX, y, { width: 230 });
    y = doc.y + 6;
  }
  doc.moveTo(totalsX, y).lineTo(totalsX + 230, y).lineWidth(1.5).strokeColor(INK).stroke();
  y += 6;
  totalRow(isStorno ? 'Gutschriftbetrag' : 'Rechnungsbetrag', euro(totals.grossCents), true);
}

/** Footer on every page: tax identification, bank details, page number. */
function drawFooters(doc: Doc, invoice: Invoice): void {
  const seller = invoice.sellerSnapshot;
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    // the footer lives in the bottom margin; without this PDFKit would start a new page for it
    const originalBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    doc.moveTo(PAGE.margin, FOOTER_TOP).lineTo(PAGE.margin + CONTENT_WIDTH, FOOTER_TOP).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.font('Regular').fontSize(8).fillColor(MUTED);
    const left = [seller.taxNumber && `Steuernummer: ${seller.taxNumber}`, seller.vatId && `USt-IdNr.: ${seller.vatId}`].filter(Boolean).join('\n');
    const right = [seller.bankName, seller.iban && `IBAN: ${seller.iban}`, seller.bic && `BIC: ${seller.bic}`].filter(Boolean).join('\n');
    if (left) doc.text(left, PAGE.margin, FOOTER_TOP + 8, { width: 240 });
    if (right) doc.text(right, PAGE.margin + CONTENT_WIDTH - 240, FOOTER_TOP + 8, { width: 240, align: 'right' });
    doc.text(`Seite ${index - range.start + 1} von ${range.count}`, PAGE.margin, PAGE.height - 30, { width: CONTENT_WIDTH, align: 'center' });

    doc.page.margins.bottom = originalBottom;
  }
}
