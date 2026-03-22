import "dotenv/config";
import express from "express";
import cors from "cors";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 8787);
const SYNC_INTERVAL_MINUTES = Number(process.env.SYNC_INTERVAL_MINUTES || 10);

const SUPABASE_URL = process.env.SUPABASE_URL;

const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const FALLBACK_AIRBNB_ICAL_URL = process.env.AIRBNB_ICAL_URL || "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("SUPABASE_URL 또는 SUPABASE_ANON_KEY가 설정되지 않았습니다.");
}

function encodeEq(value) {
  return encodeURIComponent(value ?? "");
}

async function curlJson(url, method = "GET", body = null, extraHeaders = []) {
  const args = [
    "-sS",
    "-L",
    "-w",
    "\n__HTTP_STATUS__:%{http_code}",
    url,
    "-H",
    `apikey: ${SUPABASE_ANON_KEY}`,
    "-H",
    `Authorization: Bearer ${SUPABASE_ANON_KEY}`,
    ...extraHeaders.flatMap((h) => ["-H", h]),
  ];

  if (method !== "GET") {
    args.push("-X", method);
  }

  if (body !== null) {
    args.push("-H", "Content-Type: application/json");
    args.push("--data-raw", JSON.stringify(body));
  }

  const { stdout, stderr } = await execFileAsync("/usr/bin/curl", args);

  if (stderr && stderr.trim()) {
    console.log("[curl stderr]", stderr.trim());
  }

  const output = stdout || "";
  const marker = "\n__HTTP_STATUS__:";
  const markerIndex = output.lastIndexOf(marker);

  if (markerIndex === -1) {
    throw new Error("HTTP 상태 코드를 확인할 수 없습니다.");
  }

  const text = output.slice(0, markerIndex).trim();
  const statusCode = Number(output.slice(markerIndex + marker.length).trim());

  if (!text) {
    if (statusCode >= 200 && statusCode < 300) {
      return null;
    }

    throw new Error(`HTTP ${statusCode}: 빈 응답`);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`JSON 파싱 실패: ${text.slice(0, 300)}`);
  }

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`HTTP ${statusCode}: ${text.slice(0, 500)}`);
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    if ("message" in parsed && "code" in parsed) {
      throw new Error(`Supabase 오류 ${parsed.code}: ${parsed.message}`);
    }
  }

  return parsed;
}

async function curlText(url) {
  const { stdout, stderr } = await execFileAsync("/usr/bin/curl", [
    "-sS",
    "-L",
    "-A",
    "Mozilla/5.0 host-manager-ical-proxy",
    "--max-time",
    "30",
    url,
  ]);

  if (stderr && stderr.trim()) {
    console.log("[curl stderr]", stderr.trim());
  }

  return stdout || "";
}

function unfoldIcsLines(icsText) {
  return icsText.replace(/\r?\n[ \t]/g, "");
}

function getIcalValue(body, key) {
  const lines = body.split(/\r?\n/);
  const line = lines.find((l) => l.startsWith(`${key}:`) || l.startsWith(`${key};`));
  if (!line) return "";
  return line.split(":").slice(1).join(":").trim();
}

function parseICalDate(value, fallbackHour = "15:00") {
  if (!value) return "";

  let m = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) {
    const mo = Number(m[2]);
    const d = Number(m[3]);
    return `${mo}/${d} ${fallbackHour}`;
  }

  m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
  if (m) {
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const hh = m[4];
    const mm = m[5];
    return `${mo}/${d} ${hh}:${mm}`;
  }

  return value;
}

function normalizeGuestName(summary, channelKey) {
  if (!summary) return "이름 미확인";
  const s = String(summary).trim();
  if (!s) return "이름 미확인";

  const lower = s.toLowerCase();
  if (
    lower === "reserved" ||
    lower === "airbnb reservation" ||
    lower === "airbnb booking" ||
    lower === "closed - not available" ||
    lower === "not available"
  ) {
    return channelKey === "booking" ? "Booking 예약" : "Airbnb 예약";
  }

  return s;
}

function shouldSkipEvent(summary, description, channelKey) {
  const combined = `${summary} ${description}`.toLowerCase();

  if (channelKey === "booking") {
    return (
      combined.includes("airbnb.co.kr") ||
      combined.includes("airbnb.com")
    );
  }

  return (
    combined.includes("not available") ||
    combined.includes("blocked") ||
    combined.includes("unavailable")
  );
}

function extractEvents(icsText, channelKey) {
  const safeText = unfoldIcsLines(icsText);
  const blocks = safeText.split("BEGIN:VEVENT").slice(1);
  const events = [];

  for (const block of blocks) {
    const body = block.split("END:VEVENT")[0] || "";
    const summary = getIcalValue(body, "SUMMARY");
    const description = getIcalValue(body, "DESCRIPTION");
    const dtstart = getIcalValue(body, "DTSTART");
    const dtend = getIcalValue(body, "DTEND");
    const uid = getIcalValue(body, "UID");

    if (!dtstart || !dtend) continue;
    if (shouldSkipEvent(summary, description, channelKey)) continue;

    events.push({
      uid: uid || `${summary}-${dtstart}-${dtend}`,
      guest: normalizeGuestName(summary, channelKey),
      check_in: parseICalDate(dtstart, "15:00"),
      check_out: parseICalDate(dtend, "11:00"),
      raw_start: dtstart,
      raw_end: dtend,
    });
  }

  return events;
}

async function getProperties() {
  console.log("[1] properties 조회 시작");
  const url = `${SUPABASE_URL}/rest/v1/properties?select=*&active=eq.true&order=id.asc`;
  const rows = await curlJson(url, "GET");
  console.log("[1] properties 조회 결과:", Array.isArray(rows) ? rows.length : rows);
  return Array.isArray(rows) ? rows : [];
}

async function getExistingReservationByUid(propertyId, source, externalUid) {
  if (!externalUid) return null;

  const url =
    `${SUPABASE_URL}/rest/v1/reservations?select=id,external_uid` +
    `&property_id=eq.${encodeEq(propertyId)}` +
    `&source=eq.${encodeEq(source)}` +
    `&external_uid=eq.${encodeEq(externalUid)}` +
    `&limit=1`;

  const rows = await curlJson(url, "GET");
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function getExistingReservationFallback(propertyId, source, checkIn, checkOut, guest) {
  const url =
    `${SUPABASE_URL}/rest/v1/reservations?select=id,guest,check_in,check_out` +
    `&property_id=eq.${encodeEq(propertyId)}` +
    `&source=eq.${encodeEq(source)}` +
    `&check_in=eq.${encodeEq(checkIn)}` +
    `&check_out=eq.${encodeEq(checkOut)}` +
    `&guest=eq.${encodeEq(guest)}` +
    `&limit=1`;

  const rows = await curlJson(url, "GET");
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function getExistingCleaning(propertyId, checkout, guest) {
  const url =
    `${SUPABASE_URL}/rest/v1/cleanings?select=id` +
    `&property_id=eq.${encodeEq(propertyId)}` +
    `&checkout=eq.${encodeEq(checkout)}` +
    `&guest=eq.${encodeEq(guest)}` +
    `&limit=1`;

  const rows = await curlJson(url, "GET");
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function insertReservation(row) {
  const url = `${SUPABASE_URL}/rest/v1/reservations`;
  const inserted = await curlJson(
    url,
    "POST",
    row,
    ["Prefer: return=representation"]
  );

  if (!Array.isArray(inserted) || inserted.length === 0) {
    throw new Error(`reservations insert 결과가 비정상입니다: ${JSON.stringify(inserted)}`);
  }

  return inserted;
}

async function insertCleaning(row) {
  const url = `${SUPABASE_URL}/rest/v1/cleanings`;
  const inserted = await curlJson(
    url,
    "POST",
    row,
    ["Prefer: return=representation"]
  );

  if (!Array.isArray(inserted) || inserted.length === 0) {
    throw new Error(`cleanings insert 결과가 비정상입니다: ${JSON.stringify(inserted)}`);
  }

  return inserted;
}

async function ensureReservation(property, channelName, sourceKey, event) {
  const existsByUid = await getExistingReservationByUid(property.id, sourceKey, event.uid);
  if (existsByUid) {
    return { inserted: false, reason: "duplicate_uid" };
  }

  const existsFallback = await getExistingReservationFallback(
    property.id,
    sourceKey,
    event.check_in,
    event.check_out,
    event.guest
  );
  if (existsFallback) {
    return { inserted: false, reason: "duplicate_fallback" };
  }

  const pin = String(Math.floor(1000 + Math.random() * 9000));

  await insertReservation({
    guest: event.guest,
    property_id: property.id,
    property: property.name,
    channel: channelName,
    check_in: event.check_in,
    check_out: event.check_out,
    pin,
    booking_msg_sent: false,
    same_day_msg_sent: false,
    doorlock_ready: false,
    source: sourceKey,
    external_uid: event.uid,
  });

  return { inserted: true, reason: "new" };
}

async function ensureCleaning(property, event) {
  const exists = await getExistingCleaning(property.id, event.check_out, event.guest);
  if (exists) {
    return { inserted: false };
  }

  await insertCleaning({
    property_id: property.id,
    property: property.name,
    guest: event.guest,
    checkout: event.check_out,
    status: "미요청",
    cleaner: "미배정",
    cleaner_custom: "",
    note: property.default_cleaning_note || "체크아웃 후 바로 연락 필요",
  });

  return { inserted: true };
}

async function syncOneIcal(property, channelKey, icalUrl) {
  if (!icalUrl) {
    console.log(`[2] ${property.name}: ${channelKey}_ical_url 없음, 건너뜀`);
    return { property: property.name, channel: channelKey, parsed: 0, inserted: 0, skipped: 0 };
  }

  const channelName = channelKey === "airbnb" ? "Airbnb" : "Booking";
  const sourceKey = `${channelKey}_ical`;

  console.log(`[2] ${property.name}: ${channelName} iCal 다운로드 시작`);
  const icsText = await curlText(icalUrl);

  if (!icsText || !icsText.includes("BEGIN:VCALENDAR")) {
    throw new Error(`${property.name}: ${channelName} iCal 다운로드 결과가 비정상입니다.`);
  }

  const events = extractEvents(icsText, channelKey);
  console.log(`[2] ${property.name}: ${channelName} 파싱 ${events.length}건`);

  if (channelKey === "booking" && events.length === 0) {
    console.log(
      `[2] ${property.name}: Booking 원문 미리보기`,
      icsText
        .slice(0, 500)
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n")
    );
  }

  let inserted = 0;
  let skipped = 0;

  for (const event of events) {
    let reservationResult;

    try {
      reservationResult = await ensureReservation(property, channelName, sourceKey, event);
    } catch (error) {
      console.error(
        `[2] ${property.name}: 예약 저장 실패`,
        JSON.stringify({
          guest: event.guest,
          check_in: event.check_in,
          check_out: event.check_out,
          source: sourceKey,
          uid: event.uid,
          error: String(error?.message || error),
        })
      );
      throw error;
    }

    if (reservationResult.inserted) {
      inserted += 1;
      await ensureCleaning(property, event);
    } else {
      skipped += 1;
    }
  }

  return {
    property: property.name,
    channel: channelName,
    parsed: events.length,
    inserted,
    skipped,
  };
}

async function syncAllProperties() {
  let properties = await getProperties();

  if (properties.length === 0 && FALLBACK_AIRBNB_ICAL_URL) {
    console.log("[fallback] properties가 비어 fallback AIRBNB_ICAL_URL 사용");
    properties = [
      {
        id: "p1",
        name: "외도민 숙소",
        default_cleaning_note: "체크아웃 후 바로 연락 필요",
        airbnb_ical_url: FALLBACK_AIRBNB_ICAL_URL,
        booking_ical_url: "",
      },
    ];
  }

  const results = [];

  for (const property of properties) {
    results.push(await syncOneIcal(property, "airbnb", property.airbnb_ical_url || ""));
    if (property.booking_ical_url) {
      results.push(await syncOneIcal(property, "booking", property.booking_ical_url));
    }
  }

  return results;
}

let lastSyncAt = null;
let lastSyncResults = [];
let lastSyncError = null;
let syncing = false;

async function runSync() {
  if (syncing) return [];
  syncing = true;

  try {
    console.log("=== SYNC START ===");
    const results = await syncAllProperties();
    lastSyncAt = new Date().toISOString();
    lastSyncResults = results;
    lastSyncError = null;
    console.log("=== SYNC DONE ===", JSON.stringify(results, null, 2));
    return results;
  } catch (error) {
    lastSyncError = String(error?.message || error);
    console.error("=== SYNC ERROR ===", lastSyncError);
    throw error;
  } finally {
    syncing = false;
  }
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    syncing,
    lastSyncAt,
    lastSyncError,
    lastSyncResults,
  });
});

app.post("/sync-now", async (_req, res) => {
  try {
    const results = await runSync();
    res.json({ ok: true, results, lastSyncAt, lastSyncError });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: String(error?.message || error),
      lastSyncAt,
      lastSyncError,
    });
  }
});

app.listen(PORT, async () => {
  console.log(`server running: ${PORT}`);
  try {
    await runSync();
  } catch (error) {
    console.error("initial sync failed:", String(error?.message || error));
  }
  setInterval(() => {
    runSync().catch(() => {});
  }, SYNC_INTERVAL_MINUTES * 60 * 1000);
});
