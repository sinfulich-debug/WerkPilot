export const DEFAULT_WORKSHOP_NAME = 'Ihre Werkstatt';

export function normalizePhoneForWhatsApp(phone: string): string | null {
  const compactPhone = phone.trim().replace(/[^\d+]/g, '');
  const hasLeadingPlus = compactPhone.startsWith('+');
  let number = compactPhone.replace(/\+/g, '');
  const hasInternationalPrefix = number.startsWith('00');

  if (hasInternationalPrefix) {
    number = number.slice(2);
  }
  if (number.length < 8) return null;

  if (number.startsWith('0')) {
    number = `49${number.slice(1)}`;
  } else if (!hasLeadingPlus && !hasInternationalPrefix && !number.startsWith('49')) {
    number = `49${number}`;
  }

  return number;
}

export function getWhatsAppLink(phone: string, message: string): string | null {
  const number = normalizePhoneForWhatsApp(phone);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

export function getMailtoLink(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function renderReminderTemplate(
  template: string,
  values: { customerName: string; vehicleMake: string; plate: string; tuvDueDate: string },
): string {
  const placeholders: Record<string, string> = {
    Kundenname: values.customerName,
    Fahrzeug: values.vehicleMake,
    Kennzeichen: values.plate,
    'TÜV-Datum': values.tuvDueDate,
  };
  return template.replace(/\{(Kundenname|Fahrzeug|Kennzeichen|TÜV-Datum)\}/g, (match, key: string) => placeholders[key] ?? match);
}

export function buildTuvReminderMessage({
  customerName,
  vehicleMake,
  plate,
  tuvDueDate,
  daysUntilDue,
  workshopName = DEFAULT_WORKSHOP_NAME,
}: {
  customerName: string;
  vehicleMake: string;
  plate: string;
  tuvDueDate: string;
  daysUntilDue: number;
  workshopName?: string;
}): string {
  const dueDate = new Intl.DateTimeFormat('de-DE').format(new Date(`${tuvDueDate}T00:00:00`));

  if (daysUntilDue < 0) {
    return `Guten Tag ${customerName}, die Hauptuntersuchung (TÜV) für Ihr Fahrzeug ${vehicleMake} (${plate}) ist seit dem ${dueDate} überfällig. Gerne vereinbaren wir zeitnah einen Termin für Sie. Antworten Sie einfach auf diese Nachricht oder rufen Sie uns an. Viele Grüße, ${workshopName.trim() || DEFAULT_WORKSHOP_NAME}`;
  }

  return `Guten Tag ${customerName}, die Hauptuntersuchung (TÜV) für Ihr Fahrzeug ${vehicleMake} (${plate}) ist am ${dueDate} fällig. Gerne vereinbaren wir rechtzeitig einen Termin für Sie. Antworten Sie einfach auf diese Nachricht oder rufen Sie uns an. Viele Grüße, ${workshopName.trim() || DEFAULT_WORKSHOP_NAME}`;
}
