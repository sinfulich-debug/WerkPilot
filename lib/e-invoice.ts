import { getDateStringInTimeZone, INVOICE_TIME_ZONE } from './date';
import { euroToCents, getTaxRateBps, quantityToMilli, type Invoice } from './finance';
import { checkInvoiceCompliance } from './invoice-compliance';
import { invoiceTotals } from './money';
import { DEFAULT_UNIT } from './units';

/**
 * Electronic invoice as UN/CEFACT Cross Industry Invoice XML, profile EN 16931 ("urn:cen.eu:en16931:2017"),
 * the structured data format of ZUGFeRD 2.x and Factur-X. An issued WerkPilot invoice becomes document
 * type 380 (invoice); a Storno becomes type 381 (credit note) with positive amounts and a reference to the
 * cancelled invoice, because EN 16931 does not allow negative prices.
 *
 * This is the XML alone. Embedding it in a PDF/A-3 file (the hybrid ZUGFeRD PDF) is a separate step.
 */

/** Error with a message that can be shown to the user as it is (German). */
export class EInvoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EInvoiceError';
  }
}

export type EInvoiceParty = {
  name: string;
  street: string;
  zip: string;
  city: string;
  email: string | null;
};

export type EInvoiceSeller = EInvoiceParty & {
  contactName: string | null;
  phone: string | null;
  taxNumber: string | null;
  vatId: string | null;
  iban: string | null;
  bic: string | null;
};

export type EInvoiceLine = {
  description: string;
  /** Always positive; a credit note carries the same quantities as the cancelled invoice. */
  qtyMilli: number;
  /** UN/ECE Recommendation 20 unit code, e.g. C62 (piece) or HUR (hour). */
  unitCode: string;
  unitPriceCents: number;
  taxRateBp: number;
};

export type EInvoiceDocument = {
  number: string;
  typeCode: '380' | '381';
  issueDate: string;
  serviceDate: string;
  dueDate: string | null;
  /** Number of the cancelled invoice (credit notes only). */
  precedingInvoiceNumber: string | null;
  seller: EInvoiceSeller;
  buyer: EInvoiceParty;
  lines: EInvoiceLine[];
};

export const EN16931_GUIDELINE_ID = 'urn:cen.eu:en16931:2017';
export const SMALL_BUSINESS_EXEMPTION_REASON = 'Kein Umsatzsteuerausweis gemäß § 19 UStG';

function text(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function lineQuantityMilli(quantity: number): number {
  if (quantity === 0) throw new EInvoiceError('Eine Position mit Menge 0 kann nicht exportiert werden.');
  return quantityToMilli(Math.abs(quantity));
}

/**
 * Prepares an issued invoice (or Storno) for the e-invoice format. Fails with a German message when
 * mandatory data is missing, so no incomplete e-invoice is ever produced.
 */
export function toEInvoiceDocument(invoice: Invoice): EInvoiceDocument {
  if (invoice.status === 'draft' || !invoice.number || !invoice.issuedAt) {
    throw new EInvoiceError('Nur ausgestellte Rechnungen können als E-Rechnung exportiert werden.');
  }
  const gaps = checkInvoiceCompliance(invoice);
  if (gaps.length > 0) {
    throw new EInvoiceError(`Die E-Rechnung kann nicht erstellt werden: ${gaps.map((gap) => gap.message).join(' ')}`);
  }

  const { sellerSnapshot: seller, buyerSnapshot: buyer } = invoice;
  const isCreditNote = invoice.cancelsInvoiceId !== undefined;
  if (isCreditNote && !invoice.cancelsNumber) {
    throw new EInvoiceError('Die Stornorechnung verweist nicht auf die stornierte Rechnung.');
  }

  const taxRateBp = getTaxRateBps(invoice.taxMode);
  return {
    number: invoice.number,
    typeCode: isCreditNote ? '381' : '380',
    issueDate: getDateStringInTimeZone(new Date(invoice.issuedAt), INVOICE_TIME_ZONE),
    serviceDate: invoice.serviceDate,
    dueDate: isCreditNote ? null : invoice.dueAt,
    precedingInvoiceNumber: isCreditNote ? (invoice.cancelsNumber ?? null) : null,
    seller: {
      name: seller.companyName.trim(),
      street: (seller.street ?? '').trim(),
      zip: (seller.zip ?? '').trim(),
      city: (seller.city ?? '').trim(),
      email: text(seller.email),
      contactName: text(seller.ownerName),
      phone: text(seller.phone),
      taxNumber: text(seller.taxNumber),
      vatId: text(seller.vatId),
      iban: text(seller.iban),
      bic: text(seller.bic),
    },
    buyer: {
      name: buyer.name.trim(),
      street: (buyer.street ?? '').trim(),
      zip: (buyer.zip ?? '').trim(),
      city: (buyer.city ?? '').trim(),
      email: text(buyer.email),
    },
    lines: invoice.lines.map((line) => ({
      description: line.description.trim(),
      qtyMilli: lineQuantityMilli(line.quantity),
      unitCode: line.unit ?? DEFAULT_UNIT,
      unitPriceCents: euroToCents(line.unitPrice),
      taxRateBp,
    })),
  };
}

/* ---------- XML ---------- */

/** Characters that are not allowed in XML 1.0 are removed; the five special characters are escaped. */
export function xmlEscape(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 8950 -> "89.50"; negative amounts keep their sign. */
export function xmlAmount(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError('cents must be a safe integer.');
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

/** 2500 -> "2.500". */
export function xmlQuantity(qtyMilli: number): string {
  if (!Number.isSafeInteger(qtyMilli)) throw new RangeError('qtyMilli must be a safe integer.');
  const sign = qtyMilli < 0 ? '-' : '';
  const absolute = Math.abs(qtyMilli);
  return `${sign}${Math.floor(absolute / 1000)}.${String(absolute % 1000).padStart(3, '0')}`;
}

/** 1900 -> "19.00". */
export function xmlPercent(taxRateBp: number): string {
  return xmlAmount(taxRateBp);
}

/** "2026-11-17" -> "20261117" (UN/EDIFACT date format code 102). */
export function xmlDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError('date must be YYYY-MM-DD.');
  return date.replace(/-/g, '');
}

function dateElement(tag: string, date: string, indent: string): string {
  return `${indent}<${tag}><udt:DateTimeString format="102">${xmlDate(date)}</udt:DateTimeString></${tag}>`;
}

function address(party: EInvoiceParty, indent: string): string[] {
  return [
    `${indent}<ram:PostalTradeAddress>`,
    `${indent}  <ram:PostcodeCode>${xmlEscape(party.zip)}</ram:PostcodeCode>`,
    `${indent}  <ram:LineOne>${xmlEscape(party.street)}</ram:LineOne>`,
    `${indent}  <ram:CityName>${xmlEscape(party.city)}</ram:CityName>`,
    `${indent}  <ram:CountryID>DE</ram:CountryID>`,
    `${indent}</ram:PostalTradeAddress>`,
  ];
}

function emailElement(email: string | null, indent: string): string[] {
  return email
    ? [`${indent}<ram:URIUniversalCommunication>`, `${indent}  <ram:URIID schemeID="EM">${xmlEscape(email)}</ram:URIID>`, `${indent}</ram:URIUniversalCommunication>`]
    : [];
}

function compactIdentifier(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

type TaxGroup = { taxRateBp: number; netCents: number; taxCents: number };

/** Builds the XML. The amounts come from the same money code as the invoice and the journal. */
export function buildCiiXml(document: EInvoiceDocument): string {
  if (document.lines.length === 0) throw new EInvoiceError('Eine E-Rechnung benötigt mindestens eine Position.');

  const totals = invoiceTotals(document.lines);
  const groups: TaxGroup[] = totals.groups;
  const isExempt = (taxRateBp: number) => taxRateBp === 0;
  const category = (taxRateBp: number) => (isExempt(taxRateBp) ? 'E' : 'S');
  const { seller, buyer } = document;

  const out: string[] = [];
  const add = (...lines: string[]) => out.push(...lines);

  add(
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"' +
      ' xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"' +
      ' xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">',
    '  <rsm:ExchangedDocumentContext>',
    '    <ram:GuidelineSpecifiedDocumentContextParameter>',
    `      <ram:ID>${EN16931_GUIDELINE_ID}</ram:ID>`,
    '    </ram:GuidelineSpecifiedDocumentContextParameter>',
    '  </rsm:ExchangedDocumentContext>',
    '  <rsm:ExchangedDocument>',
    `    <ram:ID>${xmlEscape(document.number)}</ram:ID>`,
    `    <ram:TypeCode>${document.typeCode}</ram:TypeCode>`,
    dateElement('ram:IssueDateTime', document.issueDate, '    '),
    '  </rsm:ExchangedDocument>',
    '  <rsm:SupplyChainTradeTransaction>',
  );

  document.lines.forEach((line, index) => {
    const lineNet = invoiceTotals([line]).netCents;
    add(
      '    <ram:IncludedSupplyChainTradeLineItem>',
      '      <ram:AssociatedDocumentLineDocument>',
      `        <ram:LineID>${index + 1}</ram:LineID>`,
      '      </ram:AssociatedDocumentLineDocument>',
      '      <ram:SpecifiedTradeProduct>',
      `        <ram:Name>${xmlEscape(line.description)}</ram:Name>`,
      '      </ram:SpecifiedTradeProduct>',
      '      <ram:SpecifiedLineTradeAgreement>',
      '        <ram:NetPriceProductTradePrice>',
      `          <ram:ChargeAmount>${xmlAmount(line.unitPriceCents)}</ram:ChargeAmount>`,
      '        </ram:NetPriceProductTradePrice>',
      '      </ram:SpecifiedLineTradeAgreement>',
      '      <ram:SpecifiedLineTradeDelivery>',
      `        <ram:BilledQuantity unitCode="${xmlEscape(line.unitCode)}">${xmlQuantity(line.qtyMilli)}</ram:BilledQuantity>`,
      '      </ram:SpecifiedLineTradeDelivery>',
      '      <ram:SpecifiedLineTradeSettlement>',
      '        <ram:ApplicableTradeTax>',
      '          <ram:TypeCode>VAT</ram:TypeCode>',
      `          <ram:CategoryCode>${category(line.taxRateBp)}</ram:CategoryCode>`,
      `          <ram:RateApplicablePercent>${xmlPercent(line.taxRateBp)}</ram:RateApplicablePercent>`,
      '        </ram:ApplicableTradeTax>',
      '        <ram:SpecifiedTradeSettlementLineMonetarySummation>',
      `          <ram:LineTotalAmount>${xmlAmount(lineNet)}</ram:LineTotalAmount>`,
      '        </ram:SpecifiedTradeSettlementLineMonetarySummation>',
      '      </ram:SpecifiedLineTradeSettlement>',
      '    </ram:IncludedSupplyChainTradeLineItem>',
    );
  });

  add('    <ram:ApplicableHeaderTradeAgreement>', '      <ram:SellerTradeParty>');
  // EN 16931 rule BR-CO-26: the buyer must be able to identify the seller by an identifier (BT-29), a legal
  // registration number (BT-30) or a VAT ID (BT-31). A tax number alone (BT-32) does not count, so a workshop
  // without a VAT ID (every small business under § 19 UStG) also sends its tax number as seller identifier.
  if (!seller.vatId && seller.taxNumber) add(`        <ram:ID>${xmlEscape(seller.taxNumber)}</ram:ID>`);
  add(`        <ram:Name>${xmlEscape(seller.name)}</ram:Name>`);
  if (seller.contactName || seller.phone || seller.email) {
    add('        <ram:DefinedTradeContact>');
    add(`          <ram:PersonName>${xmlEscape(seller.contactName ?? seller.name)}</ram:PersonName>`);
    if (seller.phone) {
      add('          <ram:TelephoneUniversalCommunication>', `            <ram:CompleteNumber>${xmlEscape(seller.phone)}</ram:CompleteNumber>`, '          </ram:TelephoneUniversalCommunication>');
    }
    if (seller.email) {
      add('          <ram:EmailURIUniversalCommunication>', `            <ram:URIID>${xmlEscape(seller.email)}</ram:URIID>`, '          </ram:EmailURIUniversalCommunication>');
    }
    add('        </ram:DefinedTradeContact>');
  }
  add(...address(seller, '        '), ...emailElement(seller.email, '        '));
  if (seller.vatId) {
    add('        <ram:SpecifiedTaxRegistration>', `          <ram:ID schemeID="VA">${xmlEscape(compactIdentifier(seller.vatId))}</ram:ID>`, '        </ram:SpecifiedTaxRegistration>');
  }
  if (seller.taxNumber) {
    add('        <ram:SpecifiedTaxRegistration>', `          <ram:ID schemeID="FC">${xmlEscape(seller.taxNumber)}</ram:ID>`, '        </ram:SpecifiedTaxRegistration>');
  }
  add('      </ram:SellerTradeParty>', '      <ram:BuyerTradeParty>', `        <ram:Name>${xmlEscape(buyer.name)}</ram:Name>`);
  add(...address(buyer, '        '), ...emailElement(buyer.email, '        '));
  add('      </ram:BuyerTradeParty>', '    </ram:ApplicableHeaderTradeAgreement>');

  add('    <ram:ApplicableHeaderTradeDelivery>', '      <ram:ActualDeliverySupplyChainEvent>');
  add(dateElement('ram:OccurrenceDateTime', document.serviceDate, '        '));
  add('      </ram:ActualDeliverySupplyChainEvent>', '    </ram:ApplicableHeaderTradeDelivery>');

  add('    <ram:ApplicableHeaderTradeSettlement>', `      <ram:PaymentReference>${xmlEscape(document.number)}</ram:PaymentReference>`, '      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>');
  if (seller.iban && document.typeCode === '380') {
    add('      <ram:SpecifiedTradeSettlementPaymentMeans>', '        <ram:TypeCode>58</ram:TypeCode>', '        <ram:PayeePartyCreditorFinancialAccount>');
    add(`          <ram:IBANID>${xmlEscape(compactIdentifier(seller.iban))}</ram:IBANID>`, '        </ram:PayeePartyCreditorFinancialAccount>');
    if (seller.bic) {
      add('        <ram:PayeeSpecifiedCreditorFinancialInstitution>', `          <ram:BICID>${xmlEscape(compactIdentifier(seller.bic))}</ram:BICID>`, '        </ram:PayeeSpecifiedCreditorFinancialInstitution>');
    }
    add('      </ram:SpecifiedTradeSettlementPaymentMeans>');
  }
  for (const group of groups) {
    add('      <ram:ApplicableTradeTax>', `        <ram:CalculatedAmount>${xmlAmount(group.taxCents)}</ram:CalculatedAmount>`, '        <ram:TypeCode>VAT</ram:TypeCode>');
    if (isExempt(group.taxRateBp)) {
      add(`        <ram:ExemptionReason>${xmlEscape(SMALL_BUSINESS_EXEMPTION_REASON)}</ram:ExemptionReason>`);
    }
    add(
      `        <ram:BasisAmount>${xmlAmount(group.netCents)}</ram:BasisAmount>`,
      `        <ram:CategoryCode>${category(group.taxRateBp)}</ram:CategoryCode>`,
      `        <ram:RateApplicablePercent>${xmlPercent(group.taxRateBp)}</ram:RateApplicablePercent>`,
      '      </ram:ApplicableTradeTax>',
    );
  }
  if (document.dueDate) {
    add('      <ram:SpecifiedTradePaymentTerms>', dateElement('ram:DueDateDateTime', document.dueDate, '        '), '      </ram:SpecifiedTradePaymentTerms>');
  }
  add(
    '      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>',
    `        <ram:LineTotalAmount>${xmlAmount(totals.netCents)}</ram:LineTotalAmount>`,
    `        <ram:TaxBasisTotalAmount>${xmlAmount(totals.netCents)}</ram:TaxBasisTotalAmount>`,
    `        <ram:TaxTotalAmount currencyID="EUR">${xmlAmount(totals.taxCents)}</ram:TaxTotalAmount>`,
    `        <ram:GrandTotalAmount>${xmlAmount(totals.grossCents)}</ram:GrandTotalAmount>`,
    `        <ram:DuePayableAmount>${xmlAmount(totals.grossCents)}</ram:DuePayableAmount>`,
    '      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>',
  );
  if (document.typeCode === '381') {
    if (!document.precedingInvoiceNumber) throw new EInvoiceError('Eine Gutschrift benötigt die Nummer der Ursprungsrechnung.');
    add('      <ram:InvoiceReferencedDocument>', `        <ram:IssuerAssignedID>${xmlEscape(document.precedingInvoiceNumber)}</ram:IssuerAssignedID>`, '      </ram:InvoiceReferencedDocument>');
  }
  add('    </ram:ApplicableHeaderTradeSettlement>', '  </rsm:SupplyChainTradeTransaction>', '</rsm:CrossIndustryInvoice>');

  return out.join('\n') + '\n';
}

/** An issued WerkPilot invoice as e-invoice XML. */
export function buildEInvoiceXml(invoice: Invoice): string {
  return buildCiiXml(toEInvoiceDocument(invoice));
}

export function eInvoiceFileName(number: string): string {
  return `e-rechnung_${number.replace(/[^A-Za-z0-9._-]/g, '_')}.xml`;
}
