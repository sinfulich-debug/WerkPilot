export type AppointmentStatus = 'Bestätigt' | 'Ausstehend' | 'Abgeschlossen';
export type AppointmentTone = 'success' | 'warning' | 'neutral';

export type AppointmentMechanic = {
  id: string;
  name: string;
};

export type Appointment = {
  id: string;
  date: string;
  durationMinutes: number;
  bay: string;
  mechanicId?: string;
  customerId?: string;
  vehicleId?: string;
  time: string;
  customer: string;
  vehicle: string;
  plate: string;
  vehicleYear?: number;
  hsn?: string;
  tsn?: string;
  vin?: string;
  engine?: string;
  tuvIntervalMonths?: number;
  tuvDueDate?: string;
  reason: string;
  status: AppointmentStatus;
  tone: AppointmentTone;
};

export type AppointmentForm = {
  customer: string;
  vehicle: string;
  plate: string;
  durationMinutes: number;
  bay: string;
  mechanicId?: string;
  customerId?: string;
  vehicleId?: string;
  vehicleYear?: number;
  hsn?: string;
  tsn?: string;
  vin?: string;
  engine?: string;
  tuvIntervalMonths?: number;
  tuvDueDate?: string;
  reason: string;
  date: string;
  time: string;
  status: AppointmentStatus;
};

/** The editable fields of an appointment, as the form and the update API expect them. */
export function appointmentToForm(appointment: Appointment): AppointmentForm {
  return {
    customer: appointment.customer,
    vehicle: appointment.vehicle,
    plate: appointment.plate,
    vehicleYear: appointment.vehicleYear,
    hsn: appointment.hsn,
    tsn: appointment.tsn,
    vin: appointment.vin,
    engine: appointment.engine,
    tuvIntervalMonths: appointment.tuvIntervalMonths,
    tuvDueDate: appointment.tuvDueDate,
    customerId: appointment.customerId,
    vehicleId: appointment.vehicleId,
    reason: appointment.reason,
    date: appointment.date,
    time: appointment.time,
    durationMinutes: appointment.durationMinutes,
    bay: appointment.bay,
    mechanicId: appointment.mechanicId,
    status: appointment.status,
  };
}

export function getTodayDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createDefaultFormState(): AppointmentForm {
  return {
    customer: '',
    vehicle: '',
    plate: '',
    durationMinutes: 60,
    bay: 'Direktannahme',
    reason: 'Hauptuntersuchung / TÜV',
    date: getTodayDateString(),
    time: '09:00',
    status: 'Bestätigt',
  };
}

export function mapStatusToTone(status: AppointmentStatus): AppointmentTone {
  if (status === 'Bestätigt') return 'success';
  if (status === 'Ausstehend') return 'warning';
  return 'neutral';
}
