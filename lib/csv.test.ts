import { describe, expect, it } from 'vitest';
import { csvAmount, csvRaw, csvText, toCsv } from './csv';

describe('csvText', () => {
  it('leaves plain text alone', () => {
    expect(csvText('Anna Müller')).toBe('Anna Müller');
    expect(csvText('')).toBe('');
  });

  it('quotes text with a separator, quote or line break and doubles the quotes', () => {
    expect(csvText('Müller; Anna')).toBe('"Müller; Anna"');
    expect(csvText('Er sagte "ok"')).toBe('"Er sagte ""ok"""');
    expect(csvText('Zeile 1\nZeile 2')).toBe('"Zeile 1\nZeile 2"');
  });

  it('defuses text that spreadsheets would run as a formula', () => {
    expect(csvText('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvText('+49 711 123')).toBe("'+49 711 123");
    expect(csvText('-5')).toBe("'-5");
    expect(csvText('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvText('\t=1+1')).toBe("'\t=1+1");
  });

  it('does not touch a minus or equals sign inside the text', () => {
    expect(csvText('Müller-Lüdenscheidt')).toBe('Müller-Lüdenscheidt');
    expect(csvText('A=B')).toBe('A=B');
  });
});

describe('csvAmount', () => {
  it('writes cents with a decimal comma and no thousands separator', () => {
    expect(csvAmount(0)).toBe('0,00');
    expect(csvAmount(5)).toBe('0,05');
    expect(csvAmount(9_520)).toBe('95,20');
    expect(csvAmount(123_456_789)).toBe('1234567,89');
  });

  it('keeps the sign of negative amounts (Storno) and never writes negative zero', () => {
    expect(csvAmount(-9_520)).toBe('-95,20');
    expect(csvAmount(-5)).toBe('-0,05');
    expect(csvAmount(-0)).toBe('0,00');
  });

  it('rejects fractions of a cent', () => {
    expect(() => csvAmount(1.5)).toThrow(RangeError);
    expect(() => csvAmount(Number.NaN)).toThrow(RangeError);
  });
});

describe('toCsv', () => {
  it('starts with a BOM, uses semicolons and CRLF and ends with a line break', () => {
    const file = toCsv([['Nummer', 'Betrag'], ['RE-2026-0001', csvRaw('95,20')]]);
    expect(file.charCodeAt(0)).toBe(0xfeff);
    expect(file.slice(1)).toBe('Nummer;Betrag\r\nRE-2026-0001;95,20\r\n');
  });

  it('treats strings as text and raw cells as written, and keeps empty cells', () => {
    expect(toCsv([['a;b', csvRaw('-1,00'), '', 'x']]).slice(1)).toBe('"a;b";-1,00;;x\r\n');
  });
});
