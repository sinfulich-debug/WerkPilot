'use client';

import { useCallback, useEffect, useState } from 'react';
import { appointmentToForm, type Appointment, type AppointmentForm, type AppointmentMechanic } from '../appointments';

/** What the calendar can change by dragging. `mechanicId: undefined` means "unassigned". */
export type AppointmentMovePatch = {
  date?: string;
  time?: string;
  durationMinutes?: number;
  bay?: string;
  mechanicId?: string | undefined;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAppointment(value: unknown): value is Appointment {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.date === 'string' &&
    typeof value.time === 'string' &&
    typeof value.durationMinutes === 'number' &&
    typeof value.bay === 'string' &&
    (value.mechanicId === undefined || typeof value.mechanicId === 'string') &&
    typeof value.customer === 'string' &&
    typeof value.vehicle === 'string' &&
    typeof value.plate === 'string' &&
    typeof value.reason === 'string' &&
    (value.customerId === undefined || typeof value.customerId === 'string') &&
    (value.vehicleId === undefined || typeof value.vehicleId === 'string') &&
    (value.vehicleYear === undefined || typeof value.vehicleYear === 'number') &&
    (value.hsn === undefined || typeof value.hsn === 'string') &&
    (value.tsn === undefined || typeof value.tsn === 'string') &&
    (value.vin === undefined || typeof value.vin === 'string') &&
    (value.engine === undefined || typeof value.engine === 'string') &&
    (value.tuvIntervalMonths === undefined || typeof value.tuvIntervalMonths === 'number') &&
    (value.tuvDueDate === undefined || typeof value.tuvDueDate === 'string') &&
    (value.status === 'Bestätigt' || value.status === 'Ausstehend' || value.status === 'Abgeschlossen') &&
    (value.tone === 'success' || value.tone === 'warning' || value.tone === 'neutral')
  );
}

function isAppointmentMechanic(value: unknown): value is AppointmentMechanic {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Die Anfrage ist fehlgeschlagen. Bitte versuche es erneut.';
}

async function readApiResponse(response: Response): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error('Der Server hat eine ungültige Antwort gesendet.');
  }

  if (!isRecord(value)) throw new Error('Der Server hat eine ungültige Antwort gesendet.');
  if (!response.ok || value.ok !== true) {
    throw new Error(
      typeof value.error === 'string' ? value.error : 'Die Anfrage ist fehlgeschlagen. Bitte versuche es erneut.',
    );
  }
  return value;
}

export function useAppointments() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [mechanics, setMechanics] = useState<AppointmentMechanic[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reloadData = useCallback(async (signal?: AbortSignal): Promise<Appointment[]> => {
    const response = await fetch('/termine/api', { cache: 'no-store', signal });
    const result = await readApiResponse(response);
    if (!Array.isArray(result.appointments) || !result.appointments.every(isAppointment)) {
      throw new Error('Die Termindaten haben ein ungültiges Format.');
    }
    if (!Array.isArray(result.mechanics) || !result.mechanics.every(isAppointmentMechanic)) {
      throw new Error('Die Mechanikerdaten haben ein ungültiges Format.');
    }

    setAppointments(result.appointments);
    setMechanics(result.mechanics);
    setError(null);
    return result.appointments;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        await reloadData(controller.signal);
      } catch (loadError) {
        if (!controller.signal.aborted) setError(errorMessage(loadError));
      } finally {
        if (!controller.signal.aborted) setIsLoaded(true);
      }
    };

    void load();
    return () => controller.abort();
  }, [reloadData]);

  const mutate = useCallback(async (action: string, body: unknown): Promise<boolean> => {
    setError(null);
    try {
      const response = await fetch(`/termine/api?action=${encodeURIComponent(action)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await readApiResponse(response);
      await reloadData();
      return true;
    } catch (mutationError) {
      setError(errorMessage(mutationError));
      return false;
    }
  }, [reloadData]);

  const addAppointment = useCallback(
    (form: AppointmentForm) => mutate('createAppointment', form),
    [mutate],
  );
  const updateAppointment = useCallback(
    (id: string, form: AppointmentForm) => mutate('updateAppointment', { id, ...form }),
    [mutate],
  );
  const deleteAppointment = useCallback(
    (id: string) => mutate('deleteAppointment', { id }),
    [mutate],
  );

  /**
   * Moves or resizes a card from the calendar. The card changes on screen immediately; if the
   * server refuses (for example 409 for a double-booked bay), it jumps back and the message is returned.
   * Returns null on success.
   */
  const moveAppointment = useCallback(
    async (appointment: Appointment, patch: AppointmentMovePatch): Promise<string | null> => {
      const applyPatch = (item: Appointment): Appointment => ({
        ...item,
        ...(patch.date !== undefined && { date: patch.date }),
        ...(patch.time !== undefined && { time: patch.time }),
        ...(patch.durationMinutes !== undefined && { durationMinutes: patch.durationMinutes }),
        ...(patch.bay !== undefined && { bay: patch.bay }),
        ...('mechanicId' in patch && { mechanicId: patch.mechanicId }),
      });

      setAppointments((current) => current.map((item) => (item.id === appointment.id ? applyPatch(item) : item)));
      try {
        const form = appointmentToForm(applyPatch(appointment));
        const response = await fetch('/termine/api?action=updateAppointment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: appointment.id, ...form }),
        });
        await readApiResponse(response);
        await reloadData();
        return null;
      } catch (moveError) {
        setAppointments((current) => current.map((item) => (item.id === appointment.id ? appointment : item)));
        return errorMessage(moveError);
      }
    },
    [reloadData],
  );

  const reload = useCallback(async () => {
    setIsLoaded(false);
    setError(null);
    try {
      await reloadData();
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setIsLoaded(true);
    }
  }, [reloadData]);

  return {
    appointments,
    mechanics,
    isLoaded,
    error,
    reload,
    addAppointment,
    updateAppointment,
    deleteAppointment,
    moveAppointment,
  };
}
