import type { Invoice } from './finance';

/**
 * Checks an invoice against the mandatory details of § 14 Abs. 4 UStG that WerkPilot can know about.
 * It finds missing data; it does not replace the Steuerberater's approval of the template.
 */
export type ComplianceGap = {
  /** Stable identifier, useful for tests. */
  code: string;
  /** German text for the workshop. */
  message: string;
};

type CheckedInvoice = Pick<
  Invoice,
  'status' | 'number' | 'issuedAt' | 'serviceDate' | 'lines' | 'sellerSnapshot' | 'buyerSnapshot' | 'cancelsInvoiceId' | 'cancelsNumber'
>;

function filled(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasAddress(address: { street: string | null; zip: string | null; city: string | null }): boolean {
  return filled(address.street) && filled(address.zip) && filled(address.city);
}

export function checkInvoiceCompliance(invoice: CheckedInvoice): ComplianceGap[] {
  const gaps: ComplianceGap[] = [];
  const add = (code: string, message: string) => gaps.push({ code, message });

  const { sellerSnapshot: seller, buyerSnapshot: buyer } = invoice;
  if (!filled(seller.companyName)) add('seller-name', 'Name des Rechnungsstellers fehlt.');
  if (!hasAddress(seller)) add('seller-address', 'Anschrift des Rechnungsstellers ist unvollständig (Straße, PLZ, Ort).');
  if (!filled(seller.taxNumber) && !filled(seller.vatId)) {
    add('seller-tax-id', 'Steuernummer oder USt-IdNr. des Rechnungsstellers fehlt.');
  }

  if (!filled(buyer.name)) add('buyer-name', 'Name des Leistungsempfängers fehlt.');
  if (!hasAddress(buyer)) add('buyer-address', 'Anschrift des Leistungsempfängers ist unvollständig (Straße, PLZ, Ort).');

  // A draft has neither number nor date yet; both are assigned when it is issued.
  if (invoice.status !== 'draft') {
    if (!filled(invoice.number)) add('number', 'Fortlaufende Rechnungsnummer fehlt.');
    if (!filled(invoice.issuedAt)) add('issue-date', 'Ausstellungsdatum fehlt.');
  }
  if (!filled(invoice.serviceDate)) add('service-date', 'Zeitpunkt der Leistung (Leistungsdatum) fehlt.');

  if (invoice.lines.length === 0) {
    add('lines', 'Die Rechnung enthält keine Position.');
  }
  invoice.lines.forEach((line, index) => {
    if (!filled(line.description)) add(`line-${index + 1}-description`, `Art der Leistung fehlt bei Position ${index + 1}.`);
    if (line.quantity === 0) add(`line-${index + 1}-quantity`, `Menge ist 0 bei Position ${index + 1}.`);
  });

  if (invoice.cancelsInvoiceId && !filled(invoice.cancelsNumber)) {
    add('storno-reference', 'Die Stornorechnung verweist nicht auf die Nummer der stornierten Rechnung.');
  }

  return gaps;
}
