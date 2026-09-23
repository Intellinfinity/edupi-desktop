"use strict";

let crypto;
let fs;

const MAX_EVENTS = 200;
const MAX_UID_BYTES = 4096;
const ALLOWED_RRULE_KEYS = new Set(["FREQ", "COUNT", "UNTIL", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH"]);
const ALLOWED_FREQUENCIES = new Set(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function scalar(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.val === "string") return value.val;
  return "";
}

function propertySeparator(line) {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') quoted = !quoted;
    if (line[index] === ":" && !quoted) return index;
  }
  return -1;
}

function splitParameters(value) {
  const parts = [];
  let quoted = false;
  let start = 0;
  for (let index = 0; index <= value.length; index += 1) {
    if (value[index] === '"') quoted = !quoted;
    if ((value[index] === ";" && !quoted) || index === value.length) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  return parts;
}

function parseProperty(line) {
  const separator = propertySeparator(line);
  if (separator <= 0) fail("invalid_output", "ICS property is malformed.");
  const head = splitParameters(line.slice(0, separator));
  const name = head.shift().toUpperCase();
  if (!/^[A-Z0-9-]+$/u.test(name)) fail("invalid_output", "ICS property name is invalid.");
  const params = {};
  for (const raw of head) {
    const equals = raw.indexOf("=");
    if (equals <= 0) fail("invalid_output", "ICS property parameter is malformed.");
    const key = raw.slice(0, equals).toUpperCase();
    const value = raw.slice(equals + 1).replace(/^"|"$/gu, "");
    if (!/^[A-Z0-9-]+$/u.test(key) || !value || Object.hasOwn(params, key)) fail("invalid_output", "ICS property parameter is invalid.");
    params[key] = value;
  }
  return { name, params, value: line.slice(separator + 1) };
}

function parseSource(source) {
  if (typeof source !== "string" || !source || source.includes("\0")) fail("invalid_output", "ICS source is invalid.");
  const normalized = source.replace(/^\uFEFF/u, "").replace(/\r\n/gu, "\n");
  if (normalized.includes("\r")) fail("invalid_output", "ICS line endings are invalid.");
  const physical = normalized.split("\n");
  const lines = [];
  for (const line of physical) {
    if (line.length > 16_384) fail("too_large", "ICS line is too large.");
    if (/^[ \t]/u.test(line)) {
      if (lines.length === 0) fail("invalid_output", "ICS folding is invalid.");
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  while (lines[0] === "") lines.shift();
  while (lines.at(-1) === "") lines.pop();
  if (lines[0] !== "BEGIN:VCALENDAR" || lines.at(-1) !== "END:VCALENDAR") fail("invalid_output", "ICS calendar envelope is invalid.");

  const events = [];
  let calendarMethod = null;
  let version = null;
  let prodid = null;
  let current = null;
  let nestedDepth = 0;
  let outerDepth = 0;
  for (let index = 1; index < lines.length - 1; index += 1) {
    const line = lines[index];
    if (line === "BEGIN:VEVENT") {
      if (current || outerDepth !== 0) fail("invalid_output", "Nested VEVENT is invalid.");
      current = { properties: new Map(), raw: [] };
      nestedDepth = 0;
      continue;
    }
    if (line.startsWith("BEGIN:")) {
      if (current) nestedDepth += 1;
      else outerDepth += 1;
      continue;
    }
    if (line.startsWith("END:")) {
      if (line === "END:VEVENT") {
        if (!current || nestedDepth !== 0) fail("invalid_output", "VEVENT nesting is invalid.");
        events.push(current);
        if (events.length > MAX_EVENTS) fail("too_large", "ICS contains too many events.");
        current = null;
      } else if (current) {
        if (nestedDepth <= 0) fail("invalid_output", "ICS component nesting is invalid.");
        nestedDepth -= 1;
      } else {
        if (outerDepth <= 0) fail("invalid_output", "ICS component nesting is invalid.");
        outerDepth -= 1;
      }
      continue;
    }
    if (!line || nestedDepth > 0) continue;
    const property = parseProperty(line);
    if (current) {
      current.raw.push(line);
      const values = current.properties.get(property.name) || [];
      values.push(property);
      current.properties.set(property.name, values);
    } else if (outerDepth === 0 && property.name === "METHOD") {
      if (calendarMethod !== null) fail("invalid_output", "ICS METHOD is duplicated.");
      calendarMethod = property.value.toUpperCase();
    } else if (outerDepth === 0 && property.name === "VERSION") {
      if (version !== null) fail("invalid_output", "ICS VERSION is duplicated.");
      version = property.value;
    } else if (outerDepth === 0 && property.name === "PRODID") {
      if (prodid !== null) fail("invalid_output", "ICS PRODID is duplicated.");
      prodid = property.value;
    }
  }
  if (current || outerDepth !== 0 || events.length === 0 || version !== "2.0" || typeof prodid !== "string" || !prodid.trim()) fail("invalid_output", "ICS calendar metadata or events are incomplete.");
  if (calendarMethod !== null && !["PUBLISH", "REQUEST", "ADD", "CANCEL"].includes(calendarMethod)) fail("ambiguous_schedule", "ICS calendar method is unsupported.");
  return { source: normalized, events, calendarMethod };
}

function one(event, name, required = false) {
  const values = event.properties.get(name) || [];
  if (values.length > 1 || required && values.length !== 1) fail("invalid_output", `ICS ${name} is invalid.`);
  return values[0] || null;
}

function plainDate(value, Temporal) {
  if (!/^\d{8}$/u.test(value)) fail("ambiguous_schedule", "ICS date is invalid.");
  try {
    return Temporal.PlainDate.from(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`);
  } catch {
    fail("ambiguous_schedule", "ICS date is invalid.");
  }
}

function localParts(value) {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/u.exec(value);
  if (!match || match[6] !== "00") fail("ambiguous_schedule", "ICS time must use minute precision.");
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]), utc: Boolean(match[7]) };
}

function parseDateTime(property, Temporal) {
  if (!property) fail("ambiguous_schedule", "ICS time is missing.");
  const dateOnly = property.params.VALUE === "DATE" || /^\d{8}$/u.test(property.value);
  if (dateOnly) {
    if (property.params.TZID || property.params.VALUE && property.params.VALUE !== "DATE") fail("ambiguous_schedule", "ICS all-day value is invalid.");
    return { dateOnly: true, date: plainDate(property.value, Temporal) };
  }
  if (property.params.VALUE && property.params.VALUE !== "DATE-TIME") fail("ambiguous_schedule", "ICS date-time value is invalid.");
  const parts = localParts(property.value);
  const zone = parts.utc ? "UTC" : property.params.TZID;
  if (!zone || parts.utc && property.params.TZID || !parts.utc && !zone.includes("/")) fail("ambiguous_schedule", "ICS time zone is missing or unsupported.");
  try {
    const zoned = Temporal.ZonedDateTime.from({ timeZone: zone, year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute }, { disambiguation: "reject" });
    return { dateOnly: false, zoned, zone };
  } catch {
    fail("ambiguous_schedule", "ICS time is ambiguous or uses an unknown zone.");
  }
}

function parseRrule(property, startDate, Temporal) {
  if (!property) return { bound: 1, values: null };
  const values = {};
  for (const part of property.value.split(";")) {
    const [rawKey, rawValue, ...rest] = part.split("=");
    const key = rawKey?.toUpperCase();
    if (!key || !rawValue || rest.length || !ALLOWED_RRULE_KEYS.has(key) || Object.hasOwn(values, key)) fail("ambiguous_schedule", "ICS recurrence rule is unsupported.");
    values[key] = rawValue.toUpperCase();
  }
  if (!ALLOWED_FREQUENCIES.has(values.FREQ)) fail("ambiguous_schedule", "ICS recurrence frequency is unsupported.");
  const interval = values.INTERVAL === undefined ? 1 : Number(values.INTERVAL);
  if (!Number.isSafeInteger(interval) || interval < 1 || interval > 366) fail("ambiguous_schedule", "ICS recurrence interval is invalid.");
  if (values.COUNT !== undefined && values.UNTIL !== undefined) fail("ambiguous_schedule", "ICS recurrence bound is invalid.");
  if (values.COUNT !== undefined) {
    const count = Number(values.COUNT);
    if (!Number.isSafeInteger(count) || count < 1) fail("ambiguous_schedule", "ICS recurrence count is invalid.");
    if (count > MAX_EVENTS) fail("too_large", "ICS recurrence exceeds the event limit.");
    return { bound: count, values };
  }
  if (!values.UNTIL) fail("ambiguous_schedule", "ICS recurrence must be finite.");
  const untilDate = plainDate(values.UNTIL.slice(0, 8), Temporal);
  if (Temporal.PlainDate.compare(untilDate, startDate) < 0) fail("ambiguous_schedule", "ICS recurrence ends before it starts.");
  const days = startDate.until(untilDate, { largestUnit: "days" }).days + 1;
  let bound;
  if (values.FREQ === "DAILY") bound = Math.ceil(days / interval);
  else if (values.FREQ === "WEEKLY") bound = Math.ceil(days / (7 * interval)) * Math.max(1, values.BYDAY?.split(",").length || 1);
  else if (values.FREQ === "MONTHLY") {
    const months = (untilDate.year - startDate.year) * 12 + untilDate.month - startDate.month + 1;
    const perMonth = values.BYMONTHDAY ? values.BYMONTHDAY.split(",").length : values.BYDAY ? values.BYDAY.split(",").length * 5 : 1;
    bound = Math.ceil(months / interval) * perMonth;
  } else {
    const years = untilDate.year - startDate.year + 1;
    const months = values.BYMONTH?.split(",").length || 1;
    const perMonth = values.BYMONTHDAY ? values.BYMONTHDAY.split(",").length : values.BYDAY ? values.BYDAY.split(",").length * 5 : 1;
    bound = Math.ceil(years / interval) * months * perMonth;
  }
  if (!Number.isSafeInteger(bound) || bound > MAX_EVENTS) fail("too_large", "ICS recurrence exceeds the event limit.");
  return { bound, values };
}

function normalizedReference(uid, recurrenceKey = null) {
  const candidate = recurrenceKey ? `${uid}#${recurrenceKey}` : uid;
  if (candidate.length <= 160 && !/[\u0000-\u001f\u007f]/u.test(candidate)) return candidate;
  return `ics:${crypto.createHash("sha256").update(candidate, "utf8").digest("hex")}`;
}

function classify(summary) {
  if (/考试|测验|考查/u.test(summary)) return "exam";
  if (/放假|假期/u.test(summary)) return "holiday";
  if (/节|纪念日/u.test(summary)) return "festival";
  if (/会议|教研|备课组|例会/u.test(summary)) return "meeting";
  if (/活动|运动会|比赛/u.test(summary)) return "activity";
  if (/开学|教学|上课/u.test(summary)) return "teaching";
  return "custom";
}

function formatZoned(zoned) {
  return `${zoned.toPlainDate().toString()}T${String(zoned.hour).padStart(2, "0")}:${String(zoned.minute).padStart(2, "0")}${zoned.offset}`;
}

function occurrenceFromInstance(instance, base, uid, Temporal, recurring = true) {
  const parsedZone = instance.event?.start?.tz || instance.event?.end?.tz || base.start?.tz || base.end?.tz;
  const zone = parsedZone === "Etc/UTC" || parsedZone === "GMT" ? "UTC" : parsedZone;
  if (typeof zone !== "string" || (!zone.includes("/") && zone !== "UTC")) fail("ambiguous_schedule", "ICS recurrence time zone is unavailable.");
  const start = Temporal.Instant.fromEpochMilliseconds(instance.start.getTime()).toZonedDateTimeISO(zone);
  const end = Temporal.Instant.fromEpochMilliseconds(instance.end.getTime()).toZonedDateTimeISO(zone);
  if (start.toPlainDate().toString() !== end.toPlainDate().toString() || Temporal.ZonedDateTime.compare(end, start) <= 0) fail("ambiguous_schedule", "ICS timed event must remain within one day.");
  const recurrenceInstant = instance.isOverride && instance.event?.recurrenceid instanceof Date ? instance.event.recurrenceid : instance.start;
  const reference = normalizedReference(uid, recurring ? recurrenceInstant.toISOString() : null);
  const summary = validateText(scalar(instance.event?.summary) || scalar(base.summary), 240, "SUMMARY");
  const rawLocation = scalar(instance.event?.location) || scalar(base.location) || null;
  const rawNotes = scalar(instance.event?.description) || scalar(base.description) || null;
  const location = rawLocation ? validateText(rawLocation, 240, "LOCATION") : null;
  const notes = rawNotes ? validateText(rawNotes, 1000, "DESCRIPTION") : null;
  const status = String(instance.event?.status || base.status || "CONFIRMED").toUpperCase();
  return {
    event_id: `parsed-${crypto.createHash("sha256").update(reference).digest("hex").slice(0, 32)}`,
    date: start.toPlainDate().toString(),
    end_date: null,
    name: summary,
    type: classify(summary),
    confidence: status === "TENTATIVE" ? "inferred" : "teacher_confirmed",
    notes,
    source_occurrence_ref: reference,
    time_interval: { start: formatZoned(start), end: formatZoned(end), time_zone: zone },
    ...(location ? { location } : {}),
  };
}

function validateText(value, max, field, nullable = false) {
  if (!value && nullable) return null;
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) fail("invalid_output", `ICS ${field} is invalid.`);
  return value.trim().replace(/\s+/gu, " ");
}

async function main() {
  const [, , sourcePath] = process.argv;
  if (!sourcePath) fail("invalid_output", "ICS worker input is missing.");
  const [{ default: cryptoModule }, { default: fsModule }, pathModule, { pathToFileURL }] = await Promise.all([
    import("node:crypto"),
    import("node:fs"),
    import("node:path"),
    import("node:url"),
  ]);
  crypto = cryptoModule;
  fs = fsModule;
  const packageRoot = pathModule.resolve(__dirname, "..", "node_modules");
  const nodeIcalEntry = pathModule.join(packageRoot, "node-ical", "node-ical.cjs");
  const temporalEntry = pathModule.join(packageRoot, "temporal-polyfill", "index.js");
  for (const entry of [nodeIcalEntry, temporalEntry]) {
    const physical = fs.realpathSync(entry);
    if (!physical.startsWith(`${fs.realpathSync(packageRoot)}${pathModule.sep}`)) fail("invalid_output", "ICS runtime dependency escaped its package root.");
  }
  const icalModule = await import(pathToFileURL(nodeIcalEntry).href);
  const temporalModule = await import(pathToFileURL(temporalEntry).href);
  const ical = icalModule.default || icalModule;
  const { Temporal } = temporalModule.default || temporalModule;
  const parsedSource = parseSource(fs.readFileSync(sourcePath, "utf8"));
  const seen = new Set();
  let aggregateBound = 0;
  const metadata = new Map();
  for (const event of parsedSource.events) {
    for (const unsupported of ["DURATION", "RDATE", "EXRULE"]) if (event.properties.has(unsupported)) fail("ambiguous_schedule", `ICS ${unsupported} is unsupported.`);
    const uid = validateText(one(event, "UID", true)?.value, MAX_UID_BYTES, "UID");
    const recurrence = one(event, "RECURRENCE-ID");
    if (recurrence?.params.RANGE) fail("ambiguous_schedule", "ICS recurrence range updates are unsupported.");
    const key = `${uid}\0${recurrence ? JSON.stringify(recurrence) : "master"}`;
    if (seen.has(key)) fail("ambiguous_schedule", "ICS contains duplicate event identities.");
    seen.add(key);
    const start = parseDateTime(one(event, "DTSTART", true), Temporal);
    const recurrenceValue = recurrence ? parseDateTime(recurrence, Temporal) : null;
    if (recurrenceValue && recurrenceValue.dateOnly !== start.dateOnly) fail("ambiguous_schedule", "ICS recurrence identity type does not match DTSTART.");
    const endProperty = one(event, "DTEND");
    const end = endProperty ? parseDateTime(endProperty, Temporal) : null;
    if (start.dateOnly !== (end?.dateOnly ?? start.dateOnly)) fail("ambiguous_schedule", "ICS start and end types do not match.");
    if (!start.dateOnly && !end) fail("ambiguous_schedule", "ICS timed event requires DTEND.");
    if (!start.dateOnly && (start.zone !== end.zone || start.zoned.toPlainDate().toString() !== end.zoned.toPlainDate().toString()
      || Temporal.ZonedDateTime.compare(end.zoned, start.zoned) <= 0)) fail("ambiguous_schedule", "ICS timed event must remain within one day.");
    if (start.dateOnly && end && Temporal.PlainDate.compare(end.date, start.date) <= 0) fail("ambiguous_schedule", "ICS all-day range is invalid.");
    const status = one(event, "STATUS");
    if (status && !["TENTATIVE", "CONFIRMED", "CANCELLED"].includes(status.value.toUpperCase())) fail("ambiguous_schedule", "ICS event status is unsupported.");
    const exdateRefs = [];
    for (const exdate of event.properties.get("EXDATE") || []) {
      for (const value of exdate.value.split(",")) {
        const parsed = parseDateTime({ ...exdate, value }, Temporal);
        if (parsed.dateOnly !== start.dateOnly) fail("ambiguous_schedule", "ICS exception type does not match DTSTART.");
        if (!parsed.dateOnly) exdateRefs.push(normalizedReference(uid, new Date(parsed.zoned.epochMilliseconds).toISOString()));
      }
    }
    const ruleProperty = one(event, "RRULE");
    if (exdateRefs.length > 0 && !ruleProperty) fail("ambiguous_schedule", "ICS EXDATE requires a recurrence rule.");
    if (new Set(exdateRefs).size !== exdateRefs.length) fail("ambiguous_schedule", "ICS contains duplicate recurrence exceptions.");
    if (start.dateOnly && ruleProperty) fail("ambiguous_schedule", "Recurring all-day ICS events are not supported safely.");
    const rule = parseRrule(ruleProperty, start.dateOnly ? start.date : start.zoned.toPlainDate(), Temporal);
    if (!recurrence) aggregateBound += rule.bound;
    if (aggregateBound > MAX_EVENTS) fail("too_large", "ICS contains too many occurrences.");
    if (!recurrence) metadata.set(uid, { uid, start, end, event, recurrence, exdateRefs });
  }

  let response;
  try {
    response = await ical.async.parseICS(parsedSource.source);
  } catch {
    fail("invalid_output", "ICS parser rejected the calendar.");
  }
  const events = [];
  const cancelled = new Set();
  for (const component of Object.values(response)) {
    if (!component || component.type !== "VEVENT") continue;
    const uid = component.uid;
    const meta = metadata.get(uid);
    if (!meta) fail("invalid_output", "ICS parser identity mismatch.");
    for (const ref of meta.exdateRefs) cancelled.add(ref);
    const status = String(component.status || "").toUpperCase();
    const cancelledMaster = parsedSource.calendarMethod === "CANCEL" || status === "CANCELLED";
    if (component.rrule) {
      const options = component.rrule.origOptions || component.rrule.options || {};
      const from = component.start;
      const to = options.until instanceof Date
        ? new Date(options.until.getTime() + 24 * 60 * 60 * 1000)
        : new Date(component.start.getTime() + 370 * 24 * 60 * 60 * 1000 * Math.max(1, Number(options.count || 1)));
      let instances;
      try { instances = ical.expandRecurringEvent(component, { from, to }); }
      catch { fail("ambiguous_schedule", "ICS recurrence expansion failed."); }
      if (instances.length > MAX_EVENTS || events.length + cancelled.size + instances.length > MAX_EVENTS) fail("too_large", "ICS contains too many occurrences.");
      for (const instance of instances) {
        const result = occurrenceFromInstance(instance, component, uid, Temporal);
        const instanceStatus = String(instance.event?.status || component.status || "").toUpperCase();
        if (cancelledMaster || instanceStatus === "CANCELLED") cancelled.add(result.source_occurrence_ref);
        else events.push(result);
      }
      continue;
    }
    if (meta.recurrence) {
      // Overrides are emitted through the recurring master. A standalone override
      // has no finite series context and is therefore not safe to import.
      continue;
    }
    let reference = normalizedReference(uid);
    if (meta.start.dateOnly) {
      const endInclusive = meta.end ? meta.end.date.subtract({ days: 1 }) : meta.start.date;
      const event = {
        event_id: `parsed-${crypto.createHash("sha256").update(reference).digest("hex").slice(0, 32)}`,
        date: meta.start.date.toString(),
        end_date: Temporal.PlainDate.compare(endInclusive, meta.start.date) > 0 ? endInclusive.toString() : null,
        name: validateText(scalar(component.summary), 240, "SUMMARY"),
        type: classify(scalar(component.summary)),
        confidence: status === "TENTATIVE" ? "inferred" : "teacher_confirmed",
        notes: scalar(component.description) ? validateText(scalar(component.description), 1000, "DESCRIPTION") : null,
        source_occurrence_ref: reference,
        ...(scalar(component.location) ? { location: validateText(scalar(component.location), 240, "LOCATION") } : {}),
      };
      if (cancelledMaster) cancelled.add(reference); else events.push(event);
      continue;
    }
    const instance = { start: component.start, end: component.end, event: component, isOverride: false };
    const event = occurrenceFromInstance(instance, component, uid, Temporal, false);
    if (cancelledMaster) cancelled.add(event.source_occurrence_ref); else events.push(event);
  }
  if (events.length + cancelled.size > MAX_EVENTS) fail("too_large", "ICS contains too many occurrences.");
  events.sort((left, right) => left.date.localeCompare(right.date) || left.source_occurrence_ref.localeCompare(right.source_occurrence_ref));
  const calendarMode = parsedSource.calendarMethod === "CANCEL" || events.length === 0 && cancelled.size > 0
    ? "delta_cancel"
    : ["PUBLISH", "REQUEST", "ADD"].includes(parsedSource.calendarMethod) ? "delta_upsert" : "full_snapshot";
  if (calendarMode === "delta_cancel" && events.length > 0) fail("ambiguous_schedule", "ICS cancellation delta cannot contain active events.");
  return { events, slots: [], calendar_mode: calendarMode, ...(cancelled.size ? { cancelled_occurrence_refs: [...cancelled].sort() } : {}) };
}

main().then(
  result => process.stdout.write(JSON.stringify({ ok: true, result })),
  error => process.stdout.write(JSON.stringify({ ok: false, code: ["invalid_output", "ambiguous_schedule", "too_large"].includes(error?.code) ? error.code : "invalid_output" })),
);
