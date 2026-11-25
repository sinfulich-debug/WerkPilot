export class InvoiceNotEditableError extends Error {
  constructor(message = 'Nur Rechnungsentwürfe können geändert werden.') {
    super(message);
    this.name = 'InvoiceNotEditableError';
  }
}

export class InvoiceNotFoundError extends Error {
  constructor(message = 'Die Rechnung wurde nicht gefunden.') {
    super(message);
    this.name = 'InvoiceNotFoundError';
  }
}
