// Daily quiet-hours ("curfew") policy and administrator lookup.

export type NapCatCurfewSettings = {
  enabled: boolean;
  startTime: string;
  endTime: string;
  startMinutes: number;
  endMinutes: number;
  replyText: string;
  timezone: string;
};

const DEFAULT_START_TIME = "22:00";
const DEFAULT_END_TIME = "08:00";
const DEFAULT_REPLY_TEXT = "😴";

function parseTimeToMinutes(value: unknown, fallback: number): { text: string; minutes: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
  if (match) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return { text: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`, minutes: hours * 60 + minutes };
    }
  }
  const fallbackHours = Math.floor(fallback / 60);
  const fallbackMinutes = fallback % 60;
  return {
    text: `${String(fallbackHours).padStart(2, "0")}:${String(fallbackMinutes).padStart(2, "0")}`,
    minutes: fallback,
  };
}

export function resolveNapCatCurfewSettings(config: any): NapCatCurfewSettings {
  const start = parseTimeToMinutes(config?.curfewStartTime, 22 * 60);
  const end = parseTimeToMinutes(config?.curfewEndTime, 8 * 60);
  const replyText = config?.curfewReplyText === undefined || config?.curfewReplyText === null
    ? DEFAULT_REPLY_TEXT
    : String(config.curfewReplyText).trim();
  return {
    enabled: config?.curfewEnabled === true,
    startTime: start.text,
    endTime: end.text,
    startMinutes: start.minutes,
    endMinutes: end.minutes,
    replyText,
    timezone: String(config?.curfewTimezone || "").trim(),
  };
}

export function isNapCatAdmin(config: any, senderId: string): boolean {
  const admins = Array.isArray(config?.adminUsers)
    ? config.adminUsers.map((id: any) => String(id).trim()).filter(Boolean)
    : [];
  return admins.includes(String(senderId || "").trim());
}

function minuteOfDay(now: Date, timezone: string): number {
  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(now);
      const hour = Number(parts.find((part) => part.type === "hour")?.value);
      const minute = Number(parts.find((part) => part.type === "minute")?.value);
      if (Number.isFinite(hour) && Number.isFinite(minute)) return hour * 60 + minute;
    } catch {
      // Fall through to the host's local timezone for an invalid IANA name.
    }
  }
  return now.getHours() * 60 + now.getMinutes();
}

export function isNapCatCurfewActive(config: any, now: Date = new Date()): boolean {
  const settings = resolveNapCatCurfewSettings(config);
  if (!settings.enabled || settings.startMinutes === settings.endMinutes) return false;
  const current = minuteOfDay(now, settings.timezone);
  if (settings.startMinutes < settings.endMinutes) {
    return current >= settings.startMinutes && current < settings.endMinutes;
  }
  return current >= settings.startMinutes || current < settings.endMinutes;
}
