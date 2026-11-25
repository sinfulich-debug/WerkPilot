'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { keepsLinkAfterChange, memberLabel, ROLE_LABELS, sortStaff, type MemberChange, type StaffMember } from '../lib/members';
import type { Role } from '../lib/session';

const ENDPOINT = '/einstellungen/mitarbeiter/api';

type Member = StaffMember & { email: string | null };
type LinkInfo = { link: string; email: string };
type ApiResult = { ok?: boolean; error?: string } & Record<string, unknown>;

async function callApi(method: 'GET' | 'POST' | 'PATCH', body?: unknown): Promise<ApiResult> {
  const response = await fetch(ENDPOINT, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as ApiResult | null;
  if (!response.ok || !data?.ok) throw new Error(data?.error ?? 'Die Anfrage ist fehlgeschlagen.');
  return data;
}

export default function StaffManager() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkInfo, setLinkInfo] = useState<LinkInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ displayName: string; email: string; role: Role }>({
    displayName: '',
    email: '',
    role: 'mechanic',
  });

  const load = useCallback(async () => {
    try {
      const data = await callApi('GET');
      setMembers(data.members as Member[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Die Mitarbeiter konnten nicht geladen werden.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Die Anfrage ist fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  function showLink(data: ApiResult) {
    setCopied(false);
    setLinkInfo({ link: String(data.link), email: String(data.email) });
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const data = await callApi('POST', form);
      showLink(data);
      setForm({ displayName: '', email: '', role: 'mechanic' });
      await load();
    });
  }

  const change = (member: Member, body: { memberId: string; action: MemberChange['type'] } & Record<string, unknown>) =>
    run(async () => {
      await callApi('PATCH', body);
      setLinkInfo((current) => (current && !keepsLinkAfterChange(current.email, member, body.action) ? null : current));
      await load();
    });

  const newLink = (memberId: string) =>
    run(async () => {
      showLink(await callApi('PATCH', { memberId, action: 'link' }));
    });

  async function copyLink() {
    if (!linkInfo) return;
    try {
      await navigator.clipboard.writeText(linkInfo.link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </p>
      )}

      {linkInfo && (
        <section className="rounded-3xl bg-emerald-50 p-5 ring-1 ring-emerald-200" aria-label="Einmal-Link">
          <h2 className="text-base font-medium text-emerald-900">Link für {linkInfo.email}</h2>
          <p className="mt-1 text-sm text-emerald-900">
            Schicke diesen Link dem Mitarbeiter (z. B. per WhatsApp oder E-Mail). Er öffnet die Seite, auf der das Passwort
            gewählt wird. Der Link gilt nur einmal und etwa eine Stunde lang. Danach kannst du hier einen neuen Link erzeugen.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              readOnly
              value={linkInfo.link}
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 rounded-xl border border-emerald-300 bg-white px-3 py-2 text-xs text-slate-800"
            />
            <button
              type="button"
              onClick={copyLink}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              {copied ? 'Kopiert' : 'Kopieren'}
            </button>
            <button
              type="button"
              onClick={() => setLinkInfo(null)}
              className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-emerald-900 ring-1 ring-emerald-300 hover:bg-emerald-100"
            >
              Schließen
            </button>
          </div>
        </section>
      )}

      <section className="rounded-3xl bg-white p-5 ring-1 ring-slate-200">
        <h2 className="text-lg font-medium text-slate-900">Mitarbeiter einladen</h2>
        <form onSubmit={invite} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm font-medium text-slate-700">
            Name
            <input
              value={form.displayName}
              onChange={(event) => setForm({ ...form, displayName: event.target.value })}
              maxLength={120}
              required
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            E-Mail
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              required
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Rolle
            <select
              value={form.role}
              onChange={(event) => setForm({ ...form, role: event.target.value as Role })}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900"
            >
              <option value="mechanic">{ROLE_LABELS.mechanic}</option>
              <option value="office">{ROLE_LABELS.office}</option>
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              Einladen
            </button>
          </div>
        </form>
        <p className="mt-3 text-xs text-slate-500">
          Mechaniker und Büro arbeiten mit Terminen, Aufträgen, Lager und Rechnungen. Mechaniker sehen keine Einkaufspreise.
          Das Änderungsprotokoll, die Einstellungen und die Mitarbeiterverwaltung bleiben dem Büro bzw. dem Inhaber vorbehalten.
        </p>
      </section>

      <section className="rounded-3xl bg-white p-5 ring-1 ring-slate-200">
        <h2 className="text-lg font-medium text-slate-900">Team</h2>
        {members === null && !error && <p className="mt-3 text-sm text-slate-500">Wird geladen …</p>}
        <ul className="mt-3 divide-y divide-slate-100">
          {members &&
            sortStaff(members).map((member) => {
              const inactive = member.deactivatedAt !== null;
              return (
                <li key={member.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className={inactive ? 'opacity-60' : ''}>
                    <p className="text-sm font-medium text-slate-900">
                      {memberLabel(member)}
                      {member.isSelf && <span className="ml-2 text-xs font-medium text-slate-500">(du)</span>}
                      {inactive && (
                        <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-700">deaktiviert</span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">{member.email ?? 'keine E-Mail bekannt'}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label={`Rolle von ${memberLabel(member)}`}
                      value={member.role}
                      disabled={busy || member.isSelf || inactive}
                      onChange={(event) => change(member, { memberId: member.id, action: 'role', role: event.target.value })}
                      className="rounded-xl border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 disabled:opacity-60"
                    >
                      {(['owner', 'office', 'mechanic'] as Role[]).map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                    {!inactive && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => newLink(member.id)}
                        className="rounded-xl bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-200 disabled:opacity-60"
                      >
                        Neuer Link
                      </button>
                    )}
                    {inactive ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => change(member, { memberId: member.id, action: 'reactivate' })}
                        className="rounded-xl bg-emerald-100 px-3 py-1.5 text-sm font-medium text-emerald-900 hover:bg-emerald-200 disabled:opacity-60"
                      >
                        Aktivieren
                      </button>
                    ) : (
                      !member.isSelf && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                `${memberLabel(member)} deaktivieren? Der Zugang endet sofort. Die Daten bleiben erhalten.`,
                              )
                            ) {
                              void change(member, { memberId: member.id, action: 'deactivate' });
                            }
                          }}
                          className="rounded-xl bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                        >
                          Deaktivieren
                        </button>
                      )
                    )}
                  </div>
                </li>
              );
            })}
        </ul>
      </section>
    </div>
  );
}
