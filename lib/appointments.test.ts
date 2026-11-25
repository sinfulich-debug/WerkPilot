import { describe, expect, it } from 'vitest';
import { appointmentToForm, type Appointment } from './appointments';

describe('appointmentToForm', () => {
  it('copies every editable field and leaves out the display-only tone and id', () => {
    const appointment: Appointment = {
      id: 'abc',
      date: '2026-11-17',
      time: '09:00',
      durationMinutes: 45,
      bay: 'Reifen 1',
      mechanicId: 'm1',
      customerId: 'c1',
      vehicleId: 'v1',
      customer: 'Anna',
      vehicle: 'VW Golf',
      plate: 'S-WN 1234',
      vehicleYear: 2018,
      reason: 'HU',
      status: 'Ausstehend',
      tone: 'warning',
    };

    const form = appointmentToForm(appointment);
    expect(form).toMatchObject({
      date: '2026-11-17',
      time: '09:00',
      durationMinutes: 45,
      bay: 'Reifen 1',
      mechanicId: 'm1',
      customerId: 'c1',
      vehicleId: 'v1',
      customer: 'Anna',
      plate: 'S-WN 1234',
      vehicleYear: 2018,
      status: 'Ausstehend',
    });
    expect(form).not.toHaveProperty('id');
    expect(form).not.toHaveProperty('tone');
  });
});
