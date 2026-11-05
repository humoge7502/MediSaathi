"use client";

/**
 * Reminders card — the control surface for the scheduling law.
 *
 * Two things are shown side by side on purpose: the settings the patient chose
 * and the *alert plan those settings produce for today*. A reminder setting with
 * no visible consequence is a checkbox, and the patient cannot tell a working
 * reminder from a broken one. The plan list is computed by the same pure function
 * that decides what gets delivered, so what is displayed here is the schedule,
 * not a description of it.
 */

import { useId } from "react";
import { backgroundSentence } from "@/lib/reminders-background";
import type { RemindersView } from "@/lib/use-reminders";
import { describeGap } from "@/lib/safety/reminders";
import { AlertLine, StatusLine } from "@/components/ui/status-line";

/** The sentence for a listener after they flipped the switch — what the flip
 *  actually bought them on this device. `null` keeps the region mounted and
 *  silent; the region itself never unmounts. */
function outcomeNote(enabled: boolean, permission: RemindersView["permission"]): string | null {
  if (!enabled) return null;
  switch (permission) {
    case "granted": return "Reminders are on, and this device can announce them.";
    case "denied": return "Reminders are on, but notifications are blocked in this browser's settings — no alert will reach you until that changes.";
    case "unsupported": return "Reminders are on, but this browser has no notification channel. On iPhone, add the app to the Home Screen first.";
    default: return "Reminders are on, waiting for you to allow notifications.";
  }
}

const LEAD_OPTIONS = [0, 5, 10, 20, 30] as const;
const LATE_OPTIONS = [0, 15, 30, 60] as const;

function clock(min: number): string {
  const h = Math.floor(min / 60);
  return `${`${h}`.padStart(2, "0")}:${`${min % 60}`.padStart(2, "0")}`;
}

/** "22:00" from an <input type=time>, or null when the field is empty. */
function parseClock(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return mins >= 0 && mins < 1440 ? mins : null;
}

export function RemindersCard({
  view,
  medications,
}: {
  view: RemindersView;
  medications: { id: string; brand: string }[];
}) {
  const { settings, permission, schedule, delivered, next, nextLabel, save, error } = view;
  const uid = useId();
  const quietStartId = `${uid}-quiet-start`;
  const quietEndId = `${uid}-quiet-end`;

  const muted = new Set(settings.mutedMedications);
  const planned = schedule.filter((a) => !delivered.includes(a.key));
  const sentCount = delivered.length;
  // Derived, never local: the quiet window is on exactly when the server holds
  // one, so a toggle cannot show a state the scheduler is not using.
  const quietOn = settings.quiet !== null;

  async function toggleEnabled() {
    const turningOn = !settings.enabled;
    if (turningOn && permission === "default") await view.enable();
    await save({ enabled: turningOn });
  }

  function toggleQuiet() {
    void save({
      quiet: quietOn
        ? null
        // The default window is the one a family actually asks for: night.
        : { startMinutes: 22 * 60, endMinutes: 7 * 60 },
    });
  }

  return (
    <section className="vy-hairline-card p-5" aria-labelledby={`${uid}-title`}>
      <div className="flex items-start justify-between gap-3">
        <p className="vy-eyebrow" id={`${uid}-title`}>Reminders</p>
        <button
          type="button"
          role="switch"
          aria-checked={settings.enabled}
          aria-label="Dose reminders"
          onClick={toggleEnabled}
          className="relative h-6 w-11 shrink-0 rounded-full border transition-colors"
          style={{
            background: settings.enabled ? "var(--vy-pine)" : "var(--secondary)",
            borderColor: settings.enabled ? "var(--vy-pine)" : "var(--border)",
          }}
        >
          <span
            aria-hidden
            className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white transition-all"
            style={{ left: settings.enabled ? "26px" : "3px" }}
          />
        </button>
      </div>

      {/* The number the whole feature exists to produce. */}
      <p className="vy-serif mt-3 text-2xl leading-tight">
        {next ? (
          <>
            {next.brand}{" "}
            <span className="vy-numeral" style={{ color: "var(--vy-pine-ink)" }}>{nextLabel}</span>
          </>
        ) : settings.enabled ? (
          <span className="text-muted-foreground">Nothing left to announce today</span>
        ) : (
          <span className="text-muted-foreground">Reminders are off</span>
        )}
      </p>
      {next && (
        <p className="vy-numeral mt-1 text-xs text-muted-foreground">
          {new Date(next.scheduledAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
          {" · "}
          {settings.leadMinutes > 0 ? `nudge ${settings.leadMinutes} min before` : "no early nudge"}
        </p>
      )}

      {/* Derived, not stored: the switch announces its own flip through
          aria-checked, but the consequence — that no alert can actually reach
          this device — is a separate fact the permission banner below only
          shows visually. A listener who turned reminders on has to hear whether
          they worked. */}
      <div className="mt-2 flex flex-col">
        <StatusLine text={outcomeNote(settings.enabled, permission)} />
        {/* `useReminders.save` keeps the server's error, and the card used to drop
            it: a rejected settings write looked like a control that had not been
            tapped, because the chip still shows the last value the server holds. */}
        <AlertLine text={error} />
      </div>

      {permission !== "granted" && settings.enabled && (
        <div className={`mt-3 rounded-lg p-3 text-xs leading-relaxed ${permission === "denied" ? "vy-banner-moderate" : "vy-banner-neutral"}`}>
          {permission === "unsupported" && (
            <p>This browser has no notification channel, so nothing can be announced. On iPhone, the web app has to be added to the Home Screen first.</p>
          )}
          {permission === "default" && (
            <>
              <p>Nothing has been announced yet — the browser only allows this on your request.</p>
              <button
                type="button"
                onClick={() => { void view.enable(); }}
                className="mt-2 rounded-full px-3 py-1.5 text-xs font-semibold text-white"
                style={{ background: "var(--vy-pine)" }}
              >
                Allow notifications
              </button>
            </>
          )}
          {permission === "denied" && (
            <p>Notifications are blocked for this site in your browser settings. The settings below still describe the schedule; nothing can be delivered until that changes.</p>
          )}
        </div>
      )}

      <div className="mt-4 space-y-4">
        <Choice label="Early nudge" value={settings.leadMinutes} options={LEAD_OPTIONS} onSelect={(v) => { void save({ leadMinutes: v }); }} />
        <Choice label="Late re-nudge" value={settings.lateMinutes} options={LATE_OPTIONS} onSelect={(v) => { void save({ lateMinutes: v }); }} />

        <div>
          <div className="flex items-center justify-between gap-3">
            <p className="vy-eyebrow">Quiet hours</p>
            <button
              type="button"
              role="switch"
              aria-checked={quietOn}
              aria-label="Quiet hours"
              onClick={toggleQuiet}
              className="relative h-6 w-11 shrink-0 rounded-full border transition-colors"
              style={{
                background: quietOn ? "var(--vy-pine)" : "var(--secondary)",
                borderColor: quietOn ? "var(--vy-pine)" : "var(--border)",
              }}
            >
              <span
                aria-hidden
                className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white transition-all"
                style={{ left: quietOn ? "26px" : "3px" }}
              />
            </button>
          </div>
          {quietOn && (
            <div className="mt-2 flex items-end gap-2">
              <div>
                <label htmlFor={quietStartId} className="block text-xs text-muted-foreground">From</label>
                <input
                  id={quietStartId}
                  type="time"
                  defaultValue={settings.quiet ? clock(settings.quiet.startMinutes) : "22:00"}
                  onChange={(e) => {
                    const start = parseClock(e.target.value);
                    if (start === null) return;
                    void save({ quiet: { startMinutes: start, endMinutes: settings.quiet?.endMinutes ?? 7 * 60 } });
                  }}
                  className="vy-numeral rounded-lg border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[color:var(--ring)]"
                />
              </div>
              <div>
                <label htmlFor={quietEndId} className="block text-xs text-muted-foreground">Until</label>
                <input
                  id={quietEndId}
                  type="time"
                  defaultValue={settings.quiet ? clock(settings.quiet.endMinutes) : "07:00"}
                  onChange={(e) => {
                    const end = parseClock(e.target.value);
                    if (end === null) return;
                    void save({ quiet: { startMinutes: settings.quiet?.startMinutes ?? 22 * 60, endMinutes: end } });
                  }}
                  className="vy-numeral rounded-lg border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[color:var(--ring)]"
                />
              </div>
            </div>
          )}
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Quiet hours hold back the <em>early</em> nudge only. A dose that is due, or already late, is never
            silenced — being woken once is a cost you chose by turning reminders on; losing a dose quietly is not.
          </p>
        </div>

        {medications.length > 0 && (
          <div>
            <p className="vy-eyebrow">Silence one medicine</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {medications.map((m) => {
                const isMuted = muted.has(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={isMuted}
                    onClick={() => {
                      const nextMuted = new Set(settings.mutedMedications);
                      if (isMuted) nextMuted.delete(m.id);
                      else nextMuted.add(m.id);
                      void save({ mutedMedications: [...nextMuted] });
                    }}
                    className="rounded-full border px-3 py-1.5 text-xs transition-colors"
                    style={isMuted
                      ? { background: "var(--secondary)", color: "var(--muted-foreground)", borderColor: "var(--border)" }
                      : { background: "transparent", color: "var(--vy-pine-ink)" }}
                  >
                    {m.brand}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <p className="vy-eyebrow">Today&apos;s alert plan ({planned.length})</p>
          {planned.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {settings.enabled
                ? "Every dose is either taken or already announced. Nothing is queued."
                : "Reminders are off, so nothing is planned."}
            </p>
          ) : (
            <ul className="vy-scroll mt-2 max-h-40 space-y-1.5 overflow-y-auto pr-1">
              {planned.map((a) => (
                <li key={a.key} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate">{a.title}</span>
                  <span className="vy-numeral shrink-0 text-muted-foreground">
                    {a.at <= view.now ? describeGap(a.at, view.now) : new Date(a.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="vy-numeral mt-2 text-xs text-muted-foreground">
            {sentCount > 0 ? `${sentCount} announced in this browser today · ` : ""}
            Announcements stay on this device: no message, SMS or push leaves it in this build.
          </p>
          {/* What happens after the patient closes the tab is the question this
              feature exists to answer, and the answer is the browser's, not the
              app's — so the card quotes the one sentence the platform facts can
              produce (`backgroundSentence`), rather than a reassurance. */}
          <p className="vy-eyebrow mt-3">After this tab closes</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {backgroundSentence(view.background)}
          </p>
        </div>
      </div>
    </section>
  );
}

/** A small segmented control: one visible choice out of a fixed set. */
function Choice({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: number;
  options: readonly number[];
  onSelect: (v: number) => void;
}) {
  return (
    <div role="group" aria-label={label}>
      <p className="vy-eyebrow">{label}</p>
      <div className="mt-2 flex flex-wrap gap-1 rounded-lg border p-1" style={{ borderColor: "var(--border)" }}>
        {options.map((v) => {
          const active = v === value;
          return (
            <button
              key={v}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(v)}
              className="vy-numeral rounded px-2.5 py-1 text-xs transition-colors"
              style={active
                ? { background: "var(--vy-pine)", color: "white" }
                : { background: "transparent", color: "var(--muted-foreground)" }}
            >
              {v === 0 ? "off" : `${v}m`}
            </button>
          );
        })}
      </div>
    </div>
  );
}
