import { describe, expect, it } from 'vitest';
import {
  buildCiiXml,
  buildEInvoiceXml,
  EInvoiceError,
  eInvoiceFileName,
  toEInvoiceDocument,
  xmlAmount,
  xmlDate,
  xmlEscape,
  xmlQuantity,
  type EInvoiceDocument,
} from './e-invoice';
import type { Invoice } from './finance';

/** Checks that every tag is closed in the right order, so a typo in the generator cannot slip through. */
function assertWellFormed(xml: string): void {
  const stack: string[] = [];
  const body = xml.replace(/<\?xml[^>]*\?>/, '');
  for (const match of Array.from(body.matchAll(/<(\/?)([A-Za-z0-9:]+)([^>]*?)(\/?)>/g))) {
    const [, closing, tag, , selfClosing] = match;
    if (selfClosing) continue;
    if (closing) {
      const open = stack.pop();
      if (open !== tag) throw new Error(`</${tag}> closes <${open ?? 'nothing'}>`);
    } else {
      stack.push(tag);
    }
  }
  if (stack.length > 0) throw new Error(`unclosed tags: ${stack.join(', ')}`);
}

const all = (xml: string, tag: string): string[] =>
  Array.from(xml.matchAll(new RegExp(`<${tag}(?: [^>]*)?>([^<]*)</${tag}>`, 'g')), (match) => match[1]);
const one = (xml: string, tag: string): string => {
  const values = all(xml, tag);
  if (values.length !== 1) throw new Error(`expected one <${tag}>, found ${values.length}`);
  return values[0];
};

const seller = {
  companyName: 'Kfz Meier & Söhne', ownerName: 'Hans Meier', street: 'Werkstattstr. 1', zip: '70173', city: 'Stuttgart',
  phone: '0711 123456', email: 'info@meier.example', website: null, taxNumber: '12/345/67890', vatId: 'DE 123 456 789',
  bankName: 'Sparkasse', iban: 'DE89 3704 0044 0532 0130 00', bic: 'COBADEFFXXX',
};
const buyer = { name: 'Anna Müller', vehiclePlate: 'S-WN 1234', email: 'anna@example.org', phone: null, street: 'Kundenweg 2', zip: '70174', city: 'Stuttgart' };

const invoice: Invoice = {
  id: '1', customerId: 'c', vehicleId: null, number: 'RE-2026-0001', customer: 'Anna Müller', plate: 'S-WN 1234',
  lines: [
    { id: 'a', description: 'Ölwechsel', quantity: 1, unit: 'HUR', unitPrice: 89.5 },
    { id: 'b', description: 'Bremsscheiben vorne', quantity: 2.5, unitPrice: 123.45 },
  ],
  taxMode: 'standard19', serviceDate: '2026-11-10', dueAt: '2026-12-01', issuedAt: '2026-11-17T10:00:00.000Z', status: 'issued',
  paidAmount: 0, sellerSnapshot: seller, buyerSnapshot: buyer,
};

describe('formatters', () => {
  it('writes amounts, quantities and dates the way the format wants them', () => {
    expect(xmlAmount(8_950)).toBe('89.50');
    expect(xmlAmount(5)).toBe('0.05');
    expect(xmlAmount(-1_234)).toBe('-12.34');
    expect(xmlQuantity(2_500)).toBe('2.500');
    expect(xmlQuantity(1)).toBe('0.001');
    expect(xmlDate('2026-11-17')).toBe('20261117');
    expect(() => xmlDate('17.11.2026')).toThrow(RangeError);
    expect(() => xmlAmount(1.5)).toThrow(RangeError);
  });

  it('escapes special characters and removes characters that XML forbids', () => {
    expect(xmlEscape('A & B <c> "d" \'e\'')).toBe('A &amp; B &lt;c&gt; &quot;d&quot; &apos;e&apos;');
    expect(xmlEscape('a\u0000b\u0008c\u000Bd')).toBe('abcd');
    expect(xmlEscape('Tab\tNewline\nÖl')).toBe('Tab\tNewline\nÖl');
  });
});

describe('invoice as e-invoice XML', () => {
  const xml = buildEInvoiceXml(invoice);

  it('is well-formed and declares the EN 16931 profile', () => {
    expect(() => assertWellFormed(xml)).not.toThrow();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<ram:ID>urn:cen.eu:en16931:2017</ram:ID>');
  });

  it('carries number, type 380, issue date (Berlin day) and service date', () => {
    expect(xml).toContain('<ram:ID>RE-2026-0001</ram:ID>');
    expect(xml).toContain('<ram:TypeCode>380</ram:TypeCode>');
    expect(xml).toContain('<ram:IssueDateTime><udt:DateTimeString format="102">20261117</udt:DateTimeString></ram:IssueDateTime>');
    expect(xml).toContain('<ram:OccurrenceDateTime><udt:DateTimeString format="102">20261110</udt:DateTimeString></ram:OccurrenceDateTime>');
    expect(xml).toContain('<ram:DueDateDateTime><udt:DateTimeString format="102">20261201</udt:DateTimeString></ram:DueDateDateTime>');
  });

  it('judges the issue date by the Berlin calendar day', () => {
    const lateEvening = buildEInvoiceXml({ ...invoice, issuedAt: '2026-11-17T23:30:00.000Z' }); // 18.11. 00:30 Berlin
    expect(lateEvening).toContain('format="102">20261118</udt:DateTimeString></ram:IssueDateTime>');
  });

  it('describes seller and buyer with address, tax registration and contact', () => {
    expect(xml).toContain('<ram:Name>Kfz Meier &amp; Söhne</ram:Name>');
    expect(xml).toContain('<ram:ID schemeID="VA">DE123456789</ram:ID>');
    expect(xml).toContain('<ram:ID schemeID="FC">12/345/67890</ram:ID>');
    expect(xml).toContain('<ram:PersonName>Hans Meier</ram:PersonName>');
    expect(xml).toContain('<ram:CompleteNumber>0711 123456</ram:CompleteNumber>');
    expect(all(xml, 'ram:PostcodeCode')).toEqual(['70173', '70174']);
    expect(all(xml, 'ram:CountryID')).toEqual(['DE', 'DE']);
    expect(xml).toContain('<ram:Name>Anna Müller</ram:Name>');
  });

  it('lists each line with quantity, net price and line total', () => {
    expect(all(xml, 'ram:LineID')).toEqual(['1', '2']);
    expect(all(xml, 'ram:Name')).toEqual(['Ölwechsel', 'Bremsscheiben vorne', 'Kfz Meier &amp; Söhne', 'Anna Müller']);
    expect(all(xml, 'ram:ChargeAmount')).toEqual(['89.50', '123.45']);
    // a line with a unit keeps it, a line without one counts as pieces
    expect(xml).toContain('<ram:BilledQuantity unitCode="HUR">1.000</ram:BilledQuantity>');
    expect(xml).toContain('<ram:BilledQuantity unitCode="C62">2.500</ram:BilledQuantity>');
    // 2.5 x 123.45 = 308.625 -> 308.63 (half away from zero)
    expect(all(xml, 'ram:LineTotalAmount')).toEqual(['89.50', '308.63', '398.13']);
  });

  it('totals add up exactly: lines = tax basis, basis + tax = grand total', () => {
    const net = 8_950 + 30_863;
    const tax = Math.round((net * 19) / 100);
    expect(one(xml, 'ram:TaxBasisTotalAmount')).toBe(xmlAmount(net));
    expect(one(xml, 'ram:TaxTotalAmount')).toBe(xmlAmount(tax));
    expect(one(xml, 'ram:GrandTotalAmount')).toBe(xmlAmount(net + tax));
    expect(one(xml, 'ram:DuePayableAmount')).toBe(xmlAmount(net + tax));
    expect(one(xml, 'ram:CalculatedAmount')).toBe(xmlAmount(tax));
    expect(one(xml, 'ram:BasisAmount')).toBe(xmlAmount(net));
  });

  it('declares standard-rate VAT and the payment details for a bank transfer', () => {
    expect(xml).toContain('<ram:CategoryCode>S</ram:CategoryCode>');
    expect(xml).toContain('<ram:RateApplicablePercent>19.00</ram:RateApplicablePercent>');
    expect(xml).toContain('<ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>');
    expect(xml).toContain('<ram:TypeCode>58</ram:TypeCode>');
    expect(xml).toContain('<ram:IBANID>DE89370400440532013000</ram:IBANID>');
    expect(xml).toContain('<ram:BICID>COBADEFFXXX</ram:BICID>');
    expect(xml).not.toContain('InvoiceReferencedDocument');
  });

  it('keeps the elements in the order the schema demands', () => {
    const inOrder = (haystack: string, markers: string[]) => {
      const positions = markers.map((marker) => haystack.indexOf(marker));
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    };
    // the main blocks of the document
    inOrder(xml, [
      '<rsm:ExchangedDocumentContext>', '<rsm:ExchangedDocument>', '<ram:IncludedSupplyChainTradeLineItem>',
      '<ram:ApplicableHeaderTradeAgreement>', '<ram:ApplicableHeaderTradeDelivery>', '<ram:ApplicableHeaderTradeSettlement>',
    ]);
    // inside the settlement block
    const settlement = xml.slice(xml.indexOf('<ram:ApplicableHeaderTradeSettlement>'));
    inOrder(settlement, [
      '<ram:PaymentReference>', '<ram:InvoiceCurrencyCode>', '<ram:SpecifiedTradeSettlementPaymentMeans>', '<ram:ApplicableTradeTax>',
      '<ram:SpecifiedTradePaymentTerms>', '<ram:SpecifiedTradeSettlementHeaderMonetarySummation>',
    ]);
    // inside the tax block: amount, type, basis, category, rate
    const tax = settlement.slice(settlement.indexOf('<ram:ApplicableTradeTax>'), settlement.indexOf('</ram:ApplicableTradeTax>'));
    inOrder(tax, ['<ram:CalculatedAmount>', '<ram:TypeCode>', '<ram:BasisAmount>', '<ram:CategoryCode>', '<ram:RateApplicablePercent>']);
    // inside a line: id, product, price, quantity, tax and total
    const line = xml.slice(xml.indexOf('<ram:IncludedSupplyChainTradeLineItem>'), xml.indexOf('</ram:IncludedSupplyChainTradeLineItem>'));
    inOrder(line, [
      '<ram:AssociatedDocumentLineDocument>', '<ram:SpecifiedTradeProduct>', '<ram:SpecifiedLineTradeAgreement>',
      '<ram:SpecifiedLineTradeDelivery>', '<ram:SpecifiedLineTradeSettlement>', '<ram:LineTotalAmount>',
    ]);
    // inside a trade party: name, contact, address, e-mail, tax registrations
    const sellerBlock = xml.slice(xml.indexOf('<ram:SellerTradeParty>'), xml.indexOf('</ram:SellerTradeParty>'));
    inOrder(sellerBlock, ['<ram:Name>', '<ram:DefinedTradeContact>', '<ram:PostalTradeAddress>', '<ram:URIUniversalCommunication>', 'schemeID="VA"', 'schemeID="FC"']);
  });

  it('writes the file name from the invoice number', () => {
    expect(eInvoiceFileName('RE-2026-0001')).toBe('e-rechnung_RE-2026-0001.xml');
    expect(eInvoiceFileName('RE/2026 0001')).toBe('e-rechnung_RE_2026_0001.xml');
  });
});

describe('Storno as credit note', () => {
  const storno: Invoice = {
    ...invoice,
    number: 'RE-2026-0002',
    cancelsInvoiceId: 'orig',
    cancelsNumber: 'RE-2026-0001',
    dueAt: null,
    lines: invoice.lines.map((line) => ({ ...line, description: `Storno: ${line.description}`, quantity: -line.quantity })),
  };
  const xml = buildEInvoiceXml(storno);
  const original = buildEInvoiceXml(invoice);

  it('is type 381 with positive amounts, because EN 16931 has no negative prices', () => {
    expect(() => assertWellFormed(xml)).not.toThrow();
    expect(xml).toContain('<ram:TypeCode>381</ram:TypeCode>');
    expect(all(xml, 'ram:BilledQuantity')).toEqual(['1.000', '2.500']);
    expect(xml).not.toMatch(/>-\d/);
  });

  it('refers to the cancelled invoice and has the same totals as the original', () => {
    expect(xml).toContain('<ram:InvoiceReferencedDocument>');
    expect(xml).toContain('<ram:IssuerAssignedID>RE-2026-0001</ram:IssuerAssignedID>');
    expect(one(xml, 'ram:GrandTotalAmount')).toBe(one(original, 'ram:GrandTotalAmount'));
    expect(one(xml, 'ram:TaxTotalAmount')).toBe(one(original, 'ram:TaxTotalAmount'));
  });

  it('has no payment terms and no payment instruction (nothing to pay)', () => {
    expect(xml).not.toContain('SpecifiedTradePaymentTerms');
    expect(xml).not.toContain('SpecifiedTradeSettlementPaymentMeans');
  });

  it('refuses a Storno without the number of the cancelled invoice', () => {
    expect(() => buildEInvoiceXml({ ...storno, cancelsNumber: undefined })).toThrow(EInvoiceError);
  });
});

describe('small business (§ 19 UStG)', () => {
  const xml = buildEInvoiceXml({ ...invoice, taxMode: 'smallBusiness' });

  it('uses the exempt category with the legal note and no tax', () => {
    expect(() => assertWellFormed(xml)).not.toThrow();
    expect(xml).toContain('<ram:CategoryCode>E</ram:CategoryCode>');
    expect(xml).toContain('<ram:ExemptionReason>Kein Umsatzsteuerausweis gemäß § 19 UStG</ram:ExemptionReason>');
    expect(xml).toContain('<ram:RateApplicablePercent>0.00</ram:RateApplicablePercent>');
    expect(one(xml, 'ram:TaxTotalAmount')).toBe('0.00');
    expect(one(xml, 'ram:GrandTotalAmount')).toBe(one(xml, 'ram:TaxBasisTotalAmount'));
  });
});

describe('seller identification (EN 16931 rule BR-CO-26, found by the official validator)', () => {
  const sellerBlock = (xml: string) => xml.slice(xml.indexOf('<ram:SellerTradeParty>'), xml.indexOf('</ram:SellerTradeParty>'));

  it('sends the tax number as seller identifier when there is no VAT ID', () => {
    const xml = buildEInvoiceXml({ ...invoice, sellerSnapshot: { ...seller, vatId: null } });
    const block = sellerBlock(xml);
    expect(block).toContain('<ram:ID>12/345/67890</ram:ID>');
    expect(block.indexOf('<ram:ID>12/345/67890</ram:ID>')).toBeLessThan(block.indexOf('<ram:Name>'));
    expect(block).toContain('<ram:ID schemeID="FC">12/345/67890</ram:ID>');
    expect(block).not.toContain('schemeID="VA"');
  });

  it('does not repeat the tax number as identifier when a VAT ID identifies the seller', () => {
    const block = sellerBlock(buildEInvoiceXml(invoice));
    expect(block).not.toContain('<ram:ID>12/345/67890</ram:ID>');
    expect(block).toContain('schemeID="VA"');
  });
});

describe('units on the lines', () => {
  it('writes the unit code of every line, also on a credit note', () => {
    const units = ['HUR', 'LS', 'LTR', 'SET'] as const;
    const lines = units.map((unit, index) => ({ id: String(index), description: `Pos ${index}`, quantity: 1, unit, unitPrice: 10 }));
    const xml = buildEInvoiceXml({ ...invoice, lines });
    expect(Array.from(xml.matchAll(/<ram:BilledQuantity unitCode="([A-Z0-9]+)"/g), (match) => match[1])).toEqual([...units]);
    const credit = buildEInvoiceXml({ ...invoice, number: 'RE-2026-0002', cancelsInvoiceId: 'x', cancelsNumber: 'RE-2026-0001', dueAt: null, lines: lines.map((line) => ({ ...line, quantity: -1 })) });
    expect(Array.from(credit.matchAll(/<ram:BilledQuantity unitCode="([A-Z0-9]+)"/g), (match) => match[1])).toEqual([...units]);
  });
});

describe('several tax rates in one document', () => {
  const document: EInvoiceDocument = {
    ...toEInvoiceDocument(invoice),
    lines: [
      { description: 'Arbeit', qtyMilli: 1_000, unitCode: 'HUR', unitPriceCents: 10_000, taxRateBp: 1_900 },
      { description: 'Buch', qtyMilli: 3_000, unitCode: 'C62', unitPriceCents: 3_333, taxRateBp: 700 },
    ],
  };
  const xml = buildCiiXml(document);

  it('writes one tax block per rate and totals them up', () => {
    expect(all(xml, 'ram:RateApplicablePercent').filter((value) => value !== '')).toEqual(['19.00', '7.00', '7.00', '19.00']);
    expect(xml.match(/<ram:CalculatedAmount>/g)).toHaveLength(2);
    expect(one(xml, 'ram:TaxBasisTotalAmount')).toBe('199.99');
    expect(one(xml, 'ram:TaxTotalAmount')).toBe('26.00'); // 19 % of 100.00 = 19.00 plus 7 % of 99.99 = 7.00 (6.9993 rounded)
  });
});

describe('refusals', () => {
  it('only exports issued invoices', () => {
    expect(() => buildEInvoiceXml({ ...invoice, status: 'draft', number: null, issuedAt: null })).toThrow('Nur ausgestellte Rechnungen');
  });

  it('names what is missing instead of producing an incomplete document', () => {
    const incomplete = { ...invoice, sellerSnapshot: { ...seller, taxNumber: null, vatId: null }, buyerSnapshot: { ...buyer, street: null } };
    expect(() => buildEInvoiceXml(incomplete)).toThrow(/Steuernummer oder USt-IdNr.*Anschrift des Leistungsempfängers/);
  });

  it('refuses an empty document', () => {
    expect(() => buildCiiXml({ ...toEInvoiceDocument(invoice), lines: [] })).toThrow(EInvoiceError);
  });

  it('survives hostile text in names and descriptions', () => {
    const hostile = buildEInvoiceXml({
      ...invoice,
      buyerSnapshot: { ...buyer, name: '</ram:Name><evil/>' },
      lines: [{ id: 'x', description: 'a & b <script>"\'', quantity: 1, unitPrice: 1 }],
    });
    expect(() => assertWellFormed(hostile)).not.toThrow();
    expect(hostile).not.toContain('<evil/>');
    expect(hostile).not.toContain('<script>');
  });
});
