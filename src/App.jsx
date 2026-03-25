import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "./supabaseClient";

const PROPERTY_COLOR_PALETTE = [
  { bg: "#dbeafe", color: "#1d4ed8" },
  { bg: "#ede9fe", color: "#6d28d9" },
  { bg: "#dcfce7", color: "#166534" },
  { bg: "#fde68a", color: "#92400e" },
  { bg: "#fee2e2", color: "#991b1b" },
  { bg: "#cffafe", color: "#155e75" },
];

const BOOKING_META = { name: "Booking", bg: "#111827", color: "#ffffff" };

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const DAY_GAP = 10;
const WEEK_BASE_HEIGHT = 118;
const BAR_HEIGHT = 30;
const BAR_TOP = 40;
const LANE_GAP = 34;

const cardStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 18,
  padding: 18,
  background: "#fff",
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
};

const buttonStyle = {
  border: "1px solid #d1d5db",
  borderRadius: 12,
  padding: "10px 14px",
  background: "#fff",
  cursor: "pointer",
  fontSize: 15,
};

const darkButton = {
  ...buttonStyle,
  background: "#0f172a",
  color: "#fff",
  border: "1px solid #0f172a",
};

const statCardStyle = {
  ...cardStyle,
  padding: "10px 14px",
  minHeight: "auto",
};

const warningChip = {
  display: "inline-block",
  fontSize: 12,
  padding: "6px 8px",
  borderRadius: 999,
  background: "#fee2e2",
  color: "#991b1b",
  fontWeight: 700,
};

const doneChip = {
  display: "inline-block",
  fontSize: 12,
  padding: "6px 8px",
  borderRadius: 999,
  background: "#dcfce7",
  color: "#166534",
  fontWeight: 700,
};

const infoChipBase = {
  display: "inline-block",
  fontSize: 12,
  padding: "6px 8px",
  borderRadius: 999,
  fontWeight: 700,
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8787").replace(
  /\/$/,
  ""
);

const CLEANING_STATUSES = ["대기중", "요청완료", "청소완료"];

function StatusBox({ text, tone = "normal" }) {
  const bg = tone === "success" ? "#f0fdf4" : tone === "error" ? "#fef2f2" : "#f8fafc";
  const border = tone === "success" ? "#bbf7d0" : tone === "error" ? "#fecaca" : "#e2e8f0";
  const color = tone === "success" ? "#166534" : tone === "error" ? "#991b1b" : "#334155";

  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        color,
        borderRadius: 12,
        padding: "12px 14px",
        marginBottom: 16,
        whiteSpace: "pre-wrap",
      }}
    >
      {text}
    </div>
  );
}

function formatGuestName(name) {
  if (!name) return "이름 미확인";
  if (name === "Reserved") return "Airbnb 예약";
  return name;
}

function parseMonthDayHourMinute(value) {
  if (!value || typeof value !== "string") return null;
  const m = value.match(/^(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;

  return {
    month: Number(m[1]),
    day: Number(m[2]),
    hour: m[3] ? Number(m[3]) : 0,
    minute: m[4] ? Number(m[4]) : 0,
  };
}

function makeSortableNumber(value) {
  const parsed = parseMonthDayHourMinute(value);
  if (!parsed) return Number.MAX_SAFE_INTEGER;
  return parsed.month * 1000000 + parsed.day * 10000 + parsed.hour * 100 + parsed.minute;
}

function getTodayInKorea() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date());

  return {
    year: Number(parts.find((p) => p.type === "year")?.value || 0),
    month: Number(parts.find((p) => p.type === "month")?.value || 0),
    day: Number(parts.find((p) => p.type === "day")?.value || 0),
  };
}

function isTodayByText(value) {
  const parsed = parseMonthDayHourMinute(value);
  if (!parsed) return false;
  const today = getTodayInKorea();
  return parsed.month === today.month && parsed.day === today.day;
}

function getDateFromMonthDay(year, month, day) {
  return new Date(year, month - 1, day);
}

function startOfWeek(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfWeek(date) {
  const d = startOfWeek(date);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

function getMonthStructure(year, monthZeroBased) {
  const firstDay = new Date(year, monthZeroBased, 1);
  const start = startOfWeek(firstDay);
  const lastDay = new Date(year, monthZeroBased + 1, 0);
  const end = endOfWeek(lastDay);

  const weeks = [];
  let cursor = new Date(start);

  while (cursor <= end) {
    const weekStart = new Date(cursor);
    const days = [];

    for (let i = 0; i < 7; i += 1) {
      const dayDate = new Date(cursor);
      days.push({
        date: dayDate,
        inMonth: dayDate.getMonth() === monthZeroBased,
        day: dayDate.getDate(),
        key: `${dayDate.getMonth() + 1}/${dayDate.getDate()}`,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    weeks.push({
      start: weekStart,
      end: new Date(
        cursor.getFullYear(),
        cursor.getMonth(),
        cursor.getDate() - 1,
        23,
        59,
        59,
        999
      ),
      days,
    });
  }

  return weeks;
}

function daysDiffInclusive(start, end) {
  return Math.round((end - start) / 86400000) + 1;
}

function calcNights(checkIn, checkOut) {
  const inP = parseMonthDayHourMinute(checkIn);
  const outP = parseMonthDayHourMinute(checkOut);
  if (!inP || !outP) return null;
  const baseYear = new Date().getFullYear();
  const inDate = new Date(baseYear, inP.month - 1, inP.day);
  let outDate = new Date(baseYear, outP.month - 1, outP.day);
  if (outDate < inDate) outDate = new Date(baseYear + 1, outP.month - 1, outP.day);
  const nights = Math.round((outDate - inDate) / 86400000);
  return nights > 0 ? nights : null;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  );
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && aEnd >= bStart;
}

function getReservationBarColor(channel, propertyId, propertyMetaById) {
  if (channel === "Booking") return BOOKING_META;
  return propertyMetaById[propertyId] || { name: "숙소", bg: "#e5e7eb", color: "#374151" };
}

function getBarLabel(bar, propertyMetaById) {
  const propertyName = propertyMetaById[bar.propertyId]?.name || bar.property || "숙소";
  return `${propertyName} · ${bar.guest}`;
}

function dotStyle(bg) {
  return {
    width: 10,
    height: 10,
    borderRadius: 999,
    background: bg,
    display: "inline-block",
    marginRight: 8,
    verticalAlign: "middle",
  };
}

// ── Cleaner Modal ────────────────────────────────────────────────────────────
function CleanerModal({ cleaner, onClose, onSaved }) {
  const isEdit = Boolean(cleaner?.id);
  const [form, setForm] = useState({
    name: cleaner?.name || "",
    phone: cleaner?.phone || "",
    address: cleaner?.address || "",
    id_number: cleaner?.id_number || "",
    bank: cleaner?.bank || "",
    account_number: cleaner?.account_number || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showIdNumber, setShowIdNumber] = useState(false);
  const [showAccount, setShowAccount] = useState(false);

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError("이름을 입력해 주세요.");
      return;
    }
    setSaving(true);
    setError("");

    if (isEdit) {
      const { error: err } = await supabase
        .from("cleaners")
        .update({ ...form })
        .eq("id", cleaner.id);
      if (err) {
        setError(err.message);
        setSaving(false);
        return;
      }
    } else {
      const { error: err } = await supabase
        .from("cleaners")
        .insert([{ ...form, active: true }]);
      if (err) {
        setError(err.message);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    onSaved();
  }

  async function handleDelete() {
    if (!window.confirm(`${cleaner.name} 담당자를 비활성화하시겠습니까?`)) return;
    setSaving(true);
    const { error: err } = await supabase
      .from("cleaners")
      .update({ active: false })
      .eq("id", cleaner.id);
    if (err) {
      setError(err.message);
      setSaving(false);
      return;
    }
    setSaving(false);
    onSaved();
  }

  const fieldStyle = {
    width: "100%",
    border: "1px solid #d1d5db",
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 15,
    background: "#fff",
    boxSizing: "border-box",
  };

  const labelStyle = {
    display: "block",
    fontWeight: 600,
    marginBottom: 6,
    color: "#374151",
    fontSize: 14,
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          ...cardStyle,
          width: "100%",
          maxWidth: 480,
          maxHeight: "90vh",
          overflowY: "auto",
          padding: 28,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 800 }}>
            {isEdit ? "담당자 수정" : "담당자 추가"}
          </div>
          <button onClick={onClose} style={{ ...buttonStyle, padding: "6px 12px", fontSize: 14 }}>
            닫기
          </button>
        </div>

        {error ? <StatusBox text={error} tone="error" /> : null}

        <div style={{ display: "grid", gap: 16 }}>
          <div>
            <label style={labelStyle}>이름 *</label>
            <input
              style={fieldStyle}
              value={form.name}
              onChange={(e) => handleChange("name", e.target.value)}
              placeholder="홍길동"
            />
          </div>

          <div>
            <label style={labelStyle}>전화번호</label>
            <input
              style={fieldStyle}
              value={form.phone}
              onChange={(e) => handleChange("phone", e.target.value)}
              placeholder="010-0000-0000"
            />
          </div>

          <div>
            <label style={labelStyle}>주소</label>
            <input
              style={fieldStyle}
              value={form.address}
              onChange={(e) => handleChange("address", e.target.value)}
              placeholder="서울시 강남구..."
            />
          </div>

          <div>
            <label style={labelStyle}>주민번호</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                style={{ ...fieldStyle, flex: 1 }}
                value={form.id_number}
                onChange={(e) => handleChange("id_number", e.target.value)}
                type={showIdNumber ? "text" : "password"}
                placeholder="000000-0000000"
              />
              <button
                style={{ ...buttonStyle, padding: "10px 14px", fontSize: 13, whiteSpace: "nowrap" }}
                onClick={() => setShowIdNumber((v) => !v)}
              >
                {showIdNumber ? "숨기기" : "보기"}
              </button>
            </div>
          </div>

          <div>
            <label style={labelStyle}>은행</label>
            <input
              style={fieldStyle}
              value={form.bank}
              onChange={(e) => handleChange("bank", e.target.value)}
              placeholder="국민은행"
            />
          </div>

          <div>
            <label style={labelStyle}>계좌번호</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                style={{ ...fieldStyle, flex: 1 }}
                value={form.account_number}
                onChange={(e) => handleChange("account_number", e.target.value)}
                type={showAccount ? "text" : "password"}
                placeholder="000-00-000000"
              />
              <button
                style={{ ...buttonStyle, padding: "10px 14px", fontSize: 13, whiteSpace: "nowrap" }}
                onClick={() => setShowAccount((v) => !v)}
              >
                {showAccount ? "숨기기" : "보기"}
              </button>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 24, justifyContent: "flex-end" }}>
          {isEdit ? (
            <button
              onClick={handleDelete}
              disabled={saving}
              style={{
                ...buttonStyle,
                background: "#fee2e2",
                color: "#991b1b",
                border: "1px solid #fecaca",
                opacity: saving ? 0.6 : 1,
              }}
            >
              비활성화
            </button>
          ) : null}
          <button
            onClick={onClose}
            style={{ ...buttonStyle, opacity: saving ? 0.6 : 1 }}
            disabled={saving}
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ ...darkButton, opacity: saving ? 0.6 : 1 }}
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ReservationDetailModal ───────────────────────────────────────────────────
function ReservationDetailModal({ reservation, onClose, onSaved }) {
  const [memo, setMemo] = useState(reservation?.memo || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!reservation) return null;

  async function handleSave() {
    setSaving(true);
    setError("");
    const { error: err } = await supabase
      .from("reservations")
      .update({ memo })
      .eq("id", reservation.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved({ ...reservation, memo });
  }

  const rowStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f1f5f9" };
  const labelStyle = { display: "block", fontWeight: 600, marginBottom: 6, color: "#374151", fontSize: 14 };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ ...cardStyle, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", padding: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 800 }}>예약 상세</div>
          <button onClick={onClose} style={{ ...buttonStyle, padding: "6px 12px", fontSize: 14 }}>닫기</button>
        </div>

        {error ? <StatusBox text={error} tone="error" /> : null}

        {/* 기본 정보 */}
        <div style={{ background: "#f8fafc", borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={rowStyle}><span style={{ color: "#64748b", fontSize: 14 }}>게스트</span><span style={{ fontWeight: 700 }}>{formatGuestName(reservation.guest)}</span></div>
          <div style={rowStyle}><span style={{ color: "#64748b", fontSize: 14 }}>숙소</span><span style={{ fontWeight: 700 }}>{reservation.property}</span></div>
          <div style={rowStyle}><span style={{ color: "#64748b", fontSize: 14 }}>플랫폼</span><span style={{ fontWeight: 700 }}>{reservation.channel || "-"}</span></div>
          <div style={rowStyle}><span style={{ color: "#64748b", fontSize: 14 }}>체크인</span><span style={{ fontWeight: 700 }}>{reservation.check_in || "-"}</span></div>
          <div style={rowStyle}><span style={{ color: "#64748b", fontSize: 14 }}>체크아웃</span><span style={{ fontWeight: 700 }}>{reservation.check_out || "-"}</span></div>
          {calcNights(reservation.check_in, reservation.check_out) ? (
            <div style={rowStyle}><span style={{ color: "#64748b", fontSize: 14 }}>숙박</span><span style={{ fontWeight: 700 }}>{calcNights(reservation.check_in, reservation.check_out)}박</span></div>
          ) : null}
          {reservation.guests_count ? (
            <div style={rowStyle}><span style={{ color: "#64748b", fontSize: 14 }}>인원</span><span style={{ fontWeight: 700 }}>{reservation.guests_count}명</span></div>
          ) : null}
          {reservation.pin ? (
            <div style={{ ...rowStyle, borderBottom: "none" }}>
              <span style={{ color: "#64748b", fontSize: 14 }}>도어락 PIN</span>
              <span style={{ fontWeight: 800, fontFamily: "monospace", fontSize: 18, letterSpacing: 2 }}>{reservation.pin}</span>
            </div>
          ) : null}
        </div>

        {/* 메모 / 특이사항 */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ ...labelStyle, fontSize: 15 }}>메모 / 특이사항</label>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={4}
            style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 10, padding: "10px 12px", fontSize: 14, resize: "vertical", boxSizing: "border-box", fontFamily: "inherit" }}
            placeholder="특이사항, 요청사항 등 메모를 입력하세요..."
          />
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ ...buttonStyle, opacity: saving ? 0.6 : 1 }} disabled={saving}>취소</button>
          <button onClick={handleSave} disabled={saving} style={{ ...darkButton, opacity: saving ? 0.6 : 1 }}>{saving ? "저장 중..." : "저장"}</button>
        </div>
      </div>
    </div>
  );
}

// ── CleaningCard ─────────────────────────────────────────────────────────────
function CleaningCard({ c, cleaners, onUpdate, nextCheckin }) {
  const [noteValue, setNoteValue] = useState(c.note || "");
  const [savingNote, setSavingNote] = useState(false);
  const [savingField, setSavingField] = useState(""); // which field is saving

  async function handleCleanerChange(e) {
    const value = e.target.value;
    onUpdate(c.id, { cleaner: value });
    const { error } = await supabase
      .from("cleanings")
      .update({ cleaner: value })
      .eq("id", c.id);
    if (error) console.error("cleaner update error", error.message);
  }

  async function handleStatusChange(status) {
    setSavingField("status");
    onUpdate(c.id, { status });
    const { error } = await supabase
      .from("cleanings")
      .update({ status })
      .eq("id", c.id);
    setSavingField("");
    if (error) console.error("status update error", error.message);
  }

  async function handleNoteSave() {
    setSavingNote(true);
    onUpdate(c.id, { note: noteValue });
    const { error } = await supabase
      .from("cleanings")
      .update({ note: noteValue })
      .eq("id", c.id);
    setSavingNote(false);
    if (error) console.error("note update error", error.message);
  }

  const statusColors = {
    "대기중": { bg: "#f1f5f9", color: "#475569" },
    "요청완료": { bg: "#fef3c7", color: "#92400e" },
    "청소완료": { bg: "#dcfce7", color: "#166534" },
  };

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 14,
        background: "#fafafa",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div style={{ fontWeight: 700 }}>{formatGuestName(c.guest)} · {c.property}</div>
        {c.status === "청소완료"
          ? <span style={{ ...doneChip, fontSize: 11 }}>청소완료</span>
          : c.status === "요청완료"
          ? <span style={{ fontSize: 11, padding: "4px 8px", borderRadius: 999, background: "#fef3c7", color: "#92400e", fontWeight: 700, display: "inline-block" }}>요청완료</span>
          : null}
      </div>
      <div style={{ display: "flex", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ color: "#475569", fontSize: 13 }}>🚪 체크아웃 {c.checkout || "-"}</span>
        {nextCheckin ? (
          <span style={{ color: "#1d4ed8", fontSize: 13, fontWeight: 600 }}>✅ 다음 체크인 {nextCheckin}</span>
        ) : null}
      </div>

      {/* Cleaner dropdown */}
      <div style={{ marginBottom: 10 }}>
        <label style={{ fontSize: 13, color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>
          담당자
        </label>
        <select
          value={c.cleaner || ""}
          onChange={handleCleanerChange}
          style={{
            width: "100%",
            border: "1px solid #d1d5db",
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 14,
            background: "#fff",
            cursor: "pointer",
          }}
        >
          <option value="">미배정</option>
          {cleaners.map((cl) => (
            <option key={cl.id} value={cl.name}>
              {cl.name} {cl.phone ? `(${cl.phone})` : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Status buttons */}
      <div style={{ marginBottom: 10 }}>
        <label style={{ fontSize: 13, color: "#64748b", fontWeight: 600, display: "block", marginBottom: 6 }}>
          상태
        </label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {CLEANING_STATUSES.map((s) => {
            const colors = statusColors[s] || { bg: "#e5e7eb", color: "#374151" };
            const isActive = c.status === s;
            return (
              <button
                key={s}
                onClick={() => handleStatusChange(s)}
                disabled={savingField === "status"}
                style={{
                  border: isActive ? `2px solid ${colors.color}` : "1px solid #d1d5db",
                  borderRadius: 8,
                  padding: "6px 12px",
                  fontSize: 13,
                  fontWeight: isActive ? 700 : 400,
                  background: isActive ? colors.bg : "#fff",
                  color: isActive ? colors.color : "#475569",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      {/* Note textarea */}
      <div>
        <label style={{ fontSize: 13, color: "#64748b", fontWeight: 600, display: "block", marginBottom: 4 }}>
          메모
        </label>
        <textarea
          value={noteValue}
          onChange={(e) => setNoteValue(e.target.value)}
          rows={2}
          style={{
            width: "100%",
            border: "1px solid #d1d5db",
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 14,
            resize: "vertical",
            boxSizing: "border-box",
            fontFamily: "inherit",
          }}
          placeholder="메모 입력..."
        />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
          <button
            onClick={handleNoteSave}
            disabled={savingNote}
            style={{ ...darkButton, padding: "6px 14px", fontSize: 13, opacity: savingNote ? 0.6 : 1 }}
          >
            {savingNote ? "저장 중..." : "메모 저장"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        {!c.cleaner || c.cleaner === "미배정" ? (
          <span style={warningChip}>청소 미배정</span>
        ) : (
          <span style={doneChip}>담당자 배정완료</span>
        )}
      </div>
    </div>
  );
}

// ── LoginScreen ───────────────────────────────────────────────────────────────
function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPw, setShowPw] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (err) setError(`[오류] ${err.message} (code: ${err.status})`);
  }

  const fieldStyle = {
    width: "100%",
    border: "1px solid #d1d5db",
    borderRadius: 10,
    padding: "11px 14px",
    fontSize: 15,
    boxSizing: "border-box",
    outline: "none",
  };

  const labelStyle = {
    display: "block",
    fontWeight: 600,
    marginBottom: 6,
    color: "#374151",
    fontSize: 14,
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f3f4f6",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        padding: 16,
      }}
    >
      <div style={{ ...cardStyle, width: "100%", maxWidth: 420, padding: 36 }}>
<div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🏠</div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "#1e293b", margin: "0 0 6px" }}>숙소 운영보드</h1>
          <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>로그인하여 계속하세요</p>
        </div>

        {error ? <StatusBox text={error} tone="error" /> : null}

        <form onSubmit={handleLogin} style={{ display: "grid", gap: 16 }}>
          <div>
            <label style={labelStyle}>이메일</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={fieldStyle}
              placeholder="이메일 주소 입력"
              autoComplete="email"
            />
          </div>
          <div>
            <label style={labelStyle}>비밀번호</label>
            <div style={{ position: "relative" }}>
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{ ...fieldStyle, paddingRight: 48 }}
                placeholder="비밀번호 입력"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                style={{
                  position: "absolute", right: 12, top: "50%",
                  transform: "translateY(-50%)",
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 18, color: "#6b7280", padding: 0,
                }}
              >
                {showPw ? "🙈" : "👁️"}
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            style={{
              ...darkButton,
              width: "100%",
              padding: "13px",
              fontSize: 16,
              borderRadius: 12,
              marginTop: 4,
              opacity: loading ? 0.6 : 1,
              cursor: loading ? "default" : "pointer",
            }}
          >
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── InstallBanner ─────────────────────────────────────────────────────────────
function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const isInstalled = window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (isInstalled || dismissed) return null;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  function handleInstall() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(() => setDeferredPrompt(null));
    }
  }

  function handleDismiss() {
    setDismissed(true);
  }

  return (
    <div style={{
      background: "#0f172a", color: "#fff",
      borderRadius: 12, padding: "12px 16px",
      marginBottom: 16, display: "flex",
      alignItems: "center", justifyContent: "space-between", gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 24 }}>📲</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>홈 화면에 앱 추가</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
            {isIOS
              ? "Safari 하단 공유(↑) → 홈 화면에 추가"
              : "설치하면 앱처럼 바로 실행할 수 있어요"}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        {!isIOS && deferredPrompt && (
          <button onClick={handleInstall} style={{
            background: "#3b82f6", color: "#fff", border: "none",
            borderRadius: 8, padding: "8px 14px", fontSize: 13,
            fontWeight: 600, cursor: "pointer",
          }}>설치</button>
        )}
        <button onClick={handleDismiss} style={{
          background: "transparent", color: "#94a3b8", border: "1px solid #334155",
          borderRadius: 8, padding: "8px 12px", fontSize: 13, cursor: "pointer",
        }}>닫기</button>
      </div>
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const isMobile = useIsMobile();
  const [session, setSession] = useState(undefined); // undefined = 초기화 전, null = 미로그인
  const [selectedProperty, setSelectedProperty] = useState("all");
  const [properties, setProperties] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [cleanings, setCleanings] = useState([]);
  const [cleaners, setCleaners] = useState([]);
  const [loading, setLoading] = useState(true);

  const [lastSyncAt, setLastSyncAt] = useState(null);

  // Cleaner modal state
  const [cleanerModalOpen, setCleanerModalOpen] = useState(false);
  const [editingCleaner, setEditingCleaner] = useState(null);

  // Reservation detail modal state
  const [reservationDetailOpen, setReservationDetailOpen] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState(null);

  // Cleaning filter state
  const [cleaningStatusFilter, setCleaningStatusFilter] = useState("전체");

  const koreaNow = useMemo(() => getTodayInKorea(), []);
  const [calendarYear, setCalendarYear] = useState(koreaNow.year);
  const [calendarMonth, setCalendarMonth] = useState(koreaNow.month - 1);
  const [selectedDateKey, setSelectedDateKey] = useState(`${koreaNow.month}/${koreaNow.day}`);

  // 세션 초기화 및 auth 상태 구독
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // 로그인 상태일 때만 데이터 로드
  useEffect(() => {
    if (session) loadAll();
  }, [session]);

  async function loadCleaners() {
    const { data, error } = await supabase
      .from("cleaners")
      .select("*")
      .eq("active", true)
      .order("name", { ascending: true });
    if (!error) setCleaners(data || []);
  }

  async function loadAll() {
    setLoading(true);

    const [
      { data: propertiesData, error: propertiesError },
      { data: reservationsData, error: reservationsError },
      { data: cleaningsData, error: cleaningsError },
      { data: cleanersData, error: cleanersError },
    ] = await Promise.all([
      supabase.from("properties").select("id,name,active").eq("active", true).order("id", { ascending: true }),
      supabase.from("reservations").select("*").order("id", { ascending: false }),
      supabase.from("cleanings").select("*").order("id", { ascending: false }),
      supabase.from("cleaners").select("*").eq("active", true).order("name", { ascending: true }),
    ]);

    if (!propertiesError) setProperties(propertiesData || []);
    if (!reservationsError) setReservations(reservationsData || []);
    if (!cleaningsError) setCleanings(cleaningsData || []);
    if (!cleanersError) setCleaners(cleanersData || []);

    // 마지막 동기화 시간 가져오기
    try {
      const res = await fetch(`${API_BASE_URL}/health`);
      const data = await res.json();
      if (data.lastSyncAt) setLastSyncAt(new Date(data.lastSyncAt));
    } catch (_) {}

    setLoading(false);
  }

  // Optimistic update for cleaning fields
  const handleCleaningUpdate = useCallback((id, patch) => {
    setCleanings((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
  }, []);

  const propertyMetaById = useMemo(() => {
    const meta = {};

    properties.forEach((property, index) => {
      meta[property.id] = {
        name: property.name,
        ...PROPERTY_COLOR_PALETTE[index % PROPERTY_COLOR_PALETTE.length],
      };
    });

    return meta;
  }, [properties]);

  const propertyOptions = useMemo(() => {
    return [
      { id: "all", name: "전체 숙소" },
      ...properties.map((property) => ({ id: property.id, name: property.name })),
    ];
  }, [properties]);

  useEffect(() => {
    if (selectedProperty === "all") return;
    if (properties.some((property) => property.id === selectedProperty)) return;
    setSelectedProperty("all");
  }, [properties, selectedProperty]);


  const filteredReservations = useMemo(() => {
    const rows =
      selectedProperty === "all"
        ? reservations
        : reservations.filter((r) => r.property_id === selectedProperty);

    return [...rows].sort((a, b) => makeSortableNumber(a.check_in) - makeSortableNumber(b.check_in));
  }, [reservations, selectedProperty]);

  const filteredCleanings = useMemo(() => {
    let rows =
      selectedProperty === "all"
        ? cleanings
        : cleanings.filter((c) => c.property_id === selectedProperty);

    if (cleaningStatusFilter !== "전체") {
      rows = rows.filter((c) => c.status === cleaningStatusFilter);
    }

    return [...rows].sort((a, b) => makeSortableNumber(a.checkout) - makeSortableNumber(b.checkout));
  }, [cleanings, selectedProperty, cleaningStatusFilter]);

  const stats = useMemo(() => {
    return {
      todayCheckins: filteredReservations.filter((r) => isTodayByText(r.check_in)).length,
      todayCheckouts: filteredCleanings.filter((c) => isTodayByText(c.checkout)).length,
      unassignedCleanings: filteredCleanings.filter((c) => !c.cleaner || c.cleaner === "미배정").length,
    };
  }, [filteredReservations, filteredCleanings]);

  const todayPriorityItems = useMemo(() => {
    const reservationItems = filteredReservations
      .filter((r) => isTodayByText(r.check_in))
      .slice(0, 4)
      .map((r) => ({
        key: `r-${r.id}`,
        guest: formatGuestName(r.guest),
        property: r.property,
        when: r.check_in,
        badge: "오늘 체크인",
      }));

    const cleaningItems = filteredCleanings
      .filter((c) => isTodayByText(c.checkout) || !c.cleaner || c.cleaner === "미배정")
      .slice(0, 4)
      .map((c) => ({
        key: `c-${c.id}`,
        guest: formatGuestName(c.guest),
        property: c.property,
        when: c.checkout,
        badge: !c.cleaner || c.cleaner === "미배정" ? "청소 미배정" : "오늘 체크아웃",
      }));

    return [...reservationItems, ...cleaningItems].slice(0, 6);
  }, [filteredReservations, filteredCleanings]);

  const monthWeeks = useMemo(
    () => getMonthStructure(calendarYear, calendarMonth),
    [calendarYear, calendarMonth]
  );

  const today = getTodayInKorea();

  const calendarLegendItems = useMemo(() => {
    return [...properties.map((property) => propertyMetaById[property.id]).filter(Boolean), BOOKING_META];
  }, [properties, propertyMetaById]);

  const reservationsForCalendar = useMemo(() => {
    return filteredReservations
      .map((r) => {
        const checkInParsed = parseMonthDayHourMinute(r.check_in);
        const checkOutParsed = parseMonthDayHourMinute(r.check_out);
        if (!checkInParsed || !checkOutParsed) return null;

        return {
          ...r,
          guestLabel: formatGuestName(r.guest),
          startDate: getDateFromMonthDay(calendarYear, checkInParsed.month, checkInParsed.day),
          endDate: getDateFromMonthDay(calendarYear, checkOutParsed.month, checkOutParsed.day),
        };
      })
      .filter(Boolean);
  }, [filteredReservations, calendarYear]);

  const cleaningsByDateKey = useMemo(() => {
    const map = new Map();

    filteredCleanings.forEach((c) => {
      const parsed = parseMonthDayHourMinute(c.checkout);
      if (!parsed) return;
      if (parsed.month !== calendarMonth + 1) return;
      const key = `${parsed.month}/${parsed.day}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c);
    });

    return map;
  }, [filteredCleanings, calendarMonth]);

  // 청소 카드별 다음 체크인 시간 매핑 (같은 숙소, 체크아웃 날짜 = 체크인 날짜인 예약)
  const cleaningNextCheckinMap = useMemo(() => {
    const map = new Map();
    filteredCleanings.forEach((c) => {
      const outP = parseMonthDayHourMinute(c.checkout);
      if (!outP) return;
      const nextRes = filteredReservations.find((r) => {
        if (r.property_id !== c.property_id) return false;
        const inP = parseMonthDayHourMinute(r.check_in);
        if (!inP) return false;
        return inP.month === outP.month && inP.day === outP.day;
      });
      if (nextRes) map.set(c.id, nextRes.check_in);
    });
    return map;
  }, [filteredCleanings, filteredReservations]);

  const weekRows = useMemo(() => {
    return monthWeeks.map((week, weekIndex) => {
      const overlapping = reservationsForCalendar.filter((r) =>
        overlaps(r.startDate, r.endDate, week.start, week.end)
      );

      const sorted = [...overlapping].sort((a, b) => a.startDate - b.startDate || a.endDate - b.endDate);
      const laneEndDates = [];
      const bars = [];

      sorted.forEach((r) => {
        const visibleStart = r.startDate < week.start ? week.start : r.startDate;
        const visibleEnd = r.endDate > week.end ? week.end : r.endDate;
        const startCol = visibleStart.getDay() + 1;
        const spanDays = daysDiffInclusive(visibleStart, visibleEnd);

        let lane = 0;
        while (lane < laneEndDates.length && visibleStart <= laneEndDates[lane]) {
          lane += 1;
        }
        laneEndDates[lane] = visibleEnd;

        bars.push({
          key: `${weekIndex}-${r.id}`,
          id: r.id,
          lane,
          startCol,
          spanDays,
          guest: r.guestLabel,
          property: r.property,
          channel: r.channel,
          propertyId: r.property_id,
        });
      });

      return {
        ...week,
        bars,
        lanes: laneEndDates.length || 1,
      };
    });
  }, [monthWeeks, reservationsForCalendar]);

  const selectedDateItems = useMemo(() => {
    const items = [];

    filteredReservations.forEach((r) => {
      const inParsed = parseMonthDayHourMinute(r.check_in);
      const outParsed = parseMonthDayHourMinute(r.check_out);

      const fmtDate = (p) => p ? `${p.month}월${p.day}일` : "?";
      const dateRange = `${fmtDate(inParsed)}-${fmtDate(outParsed)}`;

      if (inParsed && `${inParsed.month}/${inParsed.day}` === selectedDateKey) {
        items.push({
          key: `in-${r.id}`,
          type: "checkin",
          label: "입실",
          guest: formatGuestName(r.guest),
          property: r.property,
          channel: r.channel,
          propertyId: r.property_id,
          dateRange,
        });
      }

      if (outParsed && `${outParsed.month}/${outParsed.day}` === selectedDateKey) {
        items.push({
          key: `out-${r.id}`,
          type: "checkout",
          label: "퇴실",
          guest: formatGuestName(r.guest),
          property: r.property,
          channel: r.channel,
          propertyId: r.property_id,
          dateRange,
        });
      }
    });

    (cleaningsByDateKey.get(selectedDateKey) || []).forEach((c) => {
      items.push({
        key: `clean-${c.id}`,
        type: "cleaning",
        label: "청소",
        guest: formatGuestName(c.guest),
        property: c.property,
        propertyId: c.property_id,
      });
    });

    return items;
  }, [filteredReservations, cleaningsByDateKey, selectedDateKey]);

  const monthTitle = useMemo(() => `${calendarYear}년 ${calendarMonth + 1}월`, [calendarYear, calendarMonth]);

  function goPrevMonth() {
    if (calendarMonth === 0) {
      setCalendarMonth(11);
      setCalendarYear((y) => y - 1);
    } else {
      setCalendarMonth((m) => m - 1);
    }
  }

  function goNextMonth() {
    if (calendarMonth === 11) {
      setCalendarMonth(0);
      setCalendarYear((y) => y + 1);
    } else {
      setCalendarMonth((m) => m + 1);
    }
  }

  function openAddCleaner() {
    setEditingCleaner(null);
    setCleanerModalOpen(true);
  }

  function openEditCleaner(cleaner) {
    setEditingCleaner(cleaner);
    setCleanerModalOpen(true);
  }

  function closeCleanerModal() {
    setCleanerModalOpen(false);
    setEditingCleaner(null);
  }

  async function handleCleanerSaved() {
    closeCleanerModal();
    await loadCleaners();
  }

  function openReservationDetail(reservationId) {
    const r = reservations.find((res) => res.id === reservationId);
    if (!r) return;
    setSelectedReservation(r);
    setReservationDetailOpen(true);
  }

  function closeReservationDetail() {
    setReservationDetailOpen(false);
    setSelectedReservation(null);
  }

  function handleReservationSaved(updated) {
    setReservations((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    closeReservationDetail();
  }

  // 세션 초기화 중 (깜빡임 방지)
  if (session === undefined) {
    return (
      <div style={{ minHeight: "100vh", background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#64748b", fontSize: 16 }}>로딩 중...</div>
      </div>
    );
  }

  // 로그인 전
  if (session === null) return <LoginScreen />;

  // 로그인 후
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f3f4f6",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: "#111827",
      }}
    >
      {cleanerModalOpen ? (
        <CleanerModal
          cleaner={editingCleaner}
          onClose={closeCleanerModal}
          onSaved={handleCleanerSaved}
        />
      ) : null}

      {reservationDetailOpen && selectedReservation ? (
        <ReservationDetailModal
          reservation={selectedReservation}
          onClose={closeReservationDetail}
          onSaved={handleReservationSaved}
        />
      ) : null}

      <div style={{ maxWidth: 1320, margin: "0 auto", padding: isMobile ? "16px 12px 60px" : "24px 16px 60px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h1 style={{ fontSize: isMobile ? 24 : 36, fontWeight: 800, color: "#1e293b", margin: 0 }}>🏠 숙소 운영보드</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {!isMobile && (
              <span style={{ color: "#64748b", fontSize: 13 }}>{session.user.email}</span>
            )}
            <button
              onClick={() => supabase.auth.signOut()}
              style={{ ...buttonStyle, fontSize: 13, padding: "8px 14px", color: "#991b1b", borderColor: "#fecaca" }}
            >
              로그아웃
            </button>
          </div>
        </div>

        {lastSyncAt && (
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>
            🔄 마지막 동기화: {lastSyncAt.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </div>
        )}

        <InstallBanner />

        {/* Stats - 상단 요약 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 16 }}>
          <div style={statCardStyle}>
            <div style={{ color: "#64748b", fontSize: 11, marginBottom: 4 }}>오늘 체크인</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{stats.todayCheckins}</div>
          </div>
          <div style={statCardStyle}>
            <div style={{ color: "#64748b", fontSize: 11, marginBottom: 4 }}>오늘 체크아웃</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{stats.todayCheckouts}</div>
          </div>
          <div style={statCardStyle}>
            <div style={{ color: "#64748b", fontSize: 11, marginBottom: 4 }}>청소 미배정</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{stats.unassignedCleanings}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {propertyOptions.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedProperty(p.id)}
              style={{
                ...buttonStyle,
                background: selectedProperty === p.id ? "#0f172a" : "#fff",
                color: selectedProperty === p.id ? "#fff" : "#111827",
                border: selectedProperty === p.id ? "1px solid #0f172a" : "1px solid #d1d5db",
              }}
            >
              {p.name}
            </button>
          ))}
        </div>

        {/* Calendar Card */}
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 28, fontWeight: 700 }}>예약</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={goPrevMonth} style={buttonStyle}>{'< 이전'}</button>
              <div style={{ fontSize: 20, fontWeight: 800, minWidth: 140, textAlign: "center" }}>{monthTitle}</div>
              <button onClick={goNextMonth} style={buttonStyle}>{'다음 >'}</button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            {calendarLegendItems.map((item) => (
              <span
                key={item.name}
                style={{ ...infoChipBase, background: item.bg, color: item.color }}
              >
                {item.name}
              </span>
            ))}
            <span style={warningChip}>청소</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "2.2fr 0.9fr", gap: 16 }}>
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: DAY_GAP, marginBottom: 10 }}>
                {WEEKDAY_LABELS.map((weekday) => (
                  <div
                    key={weekday}
                    style={{
                      textAlign: "center",
                      fontWeight: 800,
                      color: "#64748b",
                      padding: "6px 0",
                    }}
                  >
                    {weekday}
                  </div>
                ))}
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                {weekRows.map((week, weekIndex) => {
                  const dayCellWidthPercent = (100 - DAY_GAP * 6) / 7;
                  return (
                    <div
                      key={`week-${weekIndex}`}
                      style={{
                        position: "relative",
                        minHeight: WEEK_BASE_HEIGHT + week.lanes * LANE_GAP,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(7, 1fr)",
                          gap: DAY_GAP,
                          minHeight: WEEK_BASE_HEIGHT + week.lanes * LANE_GAP,
                        }}
                      >
                        {week.days.map((day) => {
                          const isToday =
                            day.inMonth &&
                            today.year === calendarYear &&
                            today.month === calendarMonth + 1 &&
                            today.day === day.day;

                          const dayCleanings = cleaningsByDateKey.get(day.key) || [];

                          return (
                            <button
                              key={day.key}
                              onClick={() => day.inMonth && setSelectedDateKey(day.key)}
                              style={{
                                minHeight: WEEK_BASE_HEIGHT + week.lanes * LANE_GAP,
                                border: selectedDateKey === day.key ? "2px solid #0f172a" : "1px solid #e5e7eb",
                                borderRadius: 14,
                                background: day.inMonth ? (isToday ? "#f8fafc" : "#fff") : "#f8fafc",
                                opacity: day.inMonth ? 1 : 0.55,
                                padding: 10,
                                textAlign: "left",
                                cursor: day.inMonth ? "pointer" : "default",
                                position: "relative",
                              }}
                            >
                              <div style={{ position: "absolute", top: 10, right: 10, display: "flex", alignItems: "center", gap: 6 }}>
                                {isToday ? <span style={doneChip}>오늘</span> : null}
                                <div style={{ fontWeight: 800, fontSize: 14, color: "#111827" }}>{day.day}</div>
                              </div>

                              <div style={{ position: "absolute", bottom: 8, left: 8, right: 8, display: "grid", gap: 4 }}>
                                {dayCleanings.slice(0, 2).map((c) => (
                                  <div
                                    key={`c-${c.id}`}
                                    style={{
                                      borderRadius: 999,
                                      background: "#fee2e2",
                                      color: "#991b1b",
                                      fontSize: 11,
                                      fontWeight: 700,
                                      padding: "4px 6px",
                                      whiteSpace: "nowrap",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                    }}
                                  >
                                    청소 · {formatGuestName(c.guest)}
                                  </div>
                                ))}
                                {dayCleanings.length > 2 ? (
                                  <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>
                                    +{dayCleanings.length - 2}건
                                  </div>
                                ) : null}
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {week.bars.map((bar) => {
                        const colors = getReservationBarColor(bar.channel, bar.propertyId, propertyMetaById);
                        const left = `calc(${((bar.startCol - 1) * 100 / 7).toFixed(4)}% + ${((bar.startCol - 1) * DAY_GAP / 7).toFixed(4)}px)`;
                        const width = `calc(${(bar.spanDays * 100 / 7).toFixed(4)}% - ${((7 - bar.spanDays) * DAY_GAP / 7).toFixed(4)}px)`;

                        return (
                          <div
                            key={bar.key}
                            onClick={() => openReservationDetail(bar.id)}
                            style={{
                              position: "absolute",
                              left,
                              width,
                              top: BAR_TOP + bar.lane * LANE_GAP,
                              height: BAR_HEIGHT,
                              borderRadius: 999,
                              background: colors.bg,
                              color: colors.color,
                              fontSize: 12,
                              fontWeight: 700,
                              display: "flex",
                              alignItems: "center",
                              padding: "0 12px",
                              boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
                              overflow: "hidden",
                              whiteSpace: "nowrap",
                              textOverflow: "ellipsis",
                              zIndex: 2,
                              cursor: "pointer",
                              boxSizing: "border-box",
                            }}
                            title={`${bar.property} · ${bar.guest} · ${bar.channel} (클릭하여 상세 보기)`}
                          >
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                              {getBarLabel(bar, propertyMetaById)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 16, background: "#fafafa" }}>
              <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>선택한 날짜</div>
              <div style={{ color: "#64748b", marginBottom: 12 }}>{selectedDateKey}</div>

              {selectedDateItems.length === 0 ? (
                <div style={{ color: "#64748b" }}>선택한 날짜에 일정이 없습니다.</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {selectedDateItems.map((item) => {
                    const colors = item.type === "cleaning"
                      ? { bg: "#fee2e2", color: "#991b1b" }
                      : item.channel === "Booking"
                      ? BOOKING_META
                      : propertyMetaById[item.propertyId] || { bg: "#e5e7eb", color: "#374151" };

                    return (
                      <div
                        key={item.key}
                        style={{
                          border: "1px solid #e5e7eb",
                          borderRadius: 12,
                          background: "#fff",
                          padding: 12,
                        }}
                      >
                        <div style={{ marginBottom: 8 }}>
                          <span
                            style={{
                              display: "inline-block",
                              fontSize: 12,
                              padding: "6px 8px",
                              borderRadius: 999,
                              background: colors.bg,
                              color: colors.color,
                              fontWeight: 700,
                            }}
                          >
                            {item.type === "cleaning" ? "청소" : item.label}
                          </span>
                        </div>
                        <div style={{ fontWeight: 700 }}>
                          <span style={dotStyle(colors.bg)} />
                          {item.channel || item.guest} · {item.property}
                          {item.dateRange ? <span style={{ fontWeight: 400, color: "#64748b", fontSize: 13 }}> · {item.dateRange}</span> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>


        {/* Today priority */}
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 14 }}>오늘 가장 먼저 볼 것</div>

          {loading ? (
            <div>불러오는 중...</div>
          ) : todayPriorityItems.length === 0 ? (
            <div style={{ color: "#64748b" }}>오늘 우선 처리할 항목이 없습니다.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {todayPriorityItems.map((item) => (
                <div
                  key={item.key}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: 12,
                    background: "#fafafa",
                  }}
                >
                  <div style={{ marginBottom: 8 }}>
                    <span style={warningChip}>{item.badge}</span>
                  </div>
                  <div style={{ fontWeight: 700 }}>{item.guest} · {item.property}</div>
                  <div style={{ color: "#64748b", marginTop: 4 }}>{item.when || "-"}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Reservations + Cleanings */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>예약</div>
              <span style={doneChip}>총 {filteredReservations.length}건</span>
            </div>

            {loading ? (
              <div>불러오는 중...</div>
            ) : filteredReservations.length === 0 ? (
              <div style={{ color: "#64748b" }}>예약이 없습니다.</div>
            ) : (
              <div style={{ display: "grid", gap: 10, maxHeight: 720, overflowY: "auto", paddingRight: 4 }}>
                {filteredReservations.map((r) => {
                  const propColors = r.channel === "Booking"
                    ? BOOKING_META
                    : propertyMetaById[r.property_id] || { bg: "#e5e7eb", color: "#374151" };
                  return (
                    <div
                      key={r.id}
                      onClick={() => openReservationDetail(r.id)}
                      style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: 12,
                        padding: 12,
                        background: "#fafafa",
                        cursor: "pointer",
                        transition: "box-shadow 0.15s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.10)")}
                      onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                        <div style={{ fontWeight: 700 }}>{formatGuestName(r.guest)} · {r.property}</div>
                        <span style={{ ...infoChipBase, background: propColors.bg, color: propColors.color, fontSize: 11 }}>{r.channel || "-"}</span>
                      </div>
                      <div style={{ color: "#475569", fontSize: 13 }}>체크인: {r.check_in || "-"}</div>
                      <div style={{ color: "#475569", fontSize: 13, marginTop: 2 }}>체크아웃: {r.check_out || "-"}</div>
                      {calcNights(r.check_in, r.check_out) ? (
                        <div style={{ marginTop: 6 }}>
                          <span style={{ ...infoChipBase, background: "#f0f9ff", color: "#0369a1", fontSize: 11 }}>
                            {calcNights(r.check_in, r.check_out)}박
                          </span>
                        </div>
                      ) : null}
                      {r.memo ? (
                        <div style={{ color: "#64748b", fontSize: 12, marginTop: 6, fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.memo}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>청소</div>
              <span style={doneChip}>총 {filteredCleanings.length}건</span>
            </div>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
              {["전체", "대기중", "요청완료", "청소완료"].map((s) => {
                const isActive = cleaningStatusFilter === s;
                const colorMap = { "대기중": { bg: "#f1f5f9", color: "#475569" }, "요청완료": { bg: "#fef3c7", color: "#92400e" }, "청소완료": { bg: "#dcfce7", color: "#166534" }, "전체": { bg: "#e5e7eb", color: "#374151" } };
                const c = colorMap[s];
                return (
                  <button
                    key={s}
                    onClick={() => setCleaningStatusFilter(s)}
                    style={{
                      border: isActive ? `2px solid ${c.color}` : "1px solid #d1d5db",
                      borderRadius: 8,
                      padding: "6px 12px",
                      fontSize: 13,
                      fontWeight: isActive ? 700 : 400,
                      background: isActive ? c.bg : "#fff",
                      color: isActive ? c.color : "#475569",
                      cursor: "pointer",
                    }}
                  >
                    {s}
                  </button>
                );
              })}
            </div>

            {loading ? (
              <div>불러오는 중...</div>
            ) : filteredCleanings.length === 0 ? (
              <div style={{ color: "#64748b" }}>청소 항목이 없습니다.</div>
            ) : (
              <div style={{ display: "grid", gap: 10, maxHeight: 720, overflowY: "auto", paddingRight: 4 }}>
                {filteredCleanings.map((c) => (
                  <CleaningCard
                    key={c.id}
                    c={c}
                    cleaners={cleaners}
                    onUpdate={handleCleaningUpdate}
                    nextCheckin={cleaningNextCheckinMap.get(c.id) || null}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Cleaner Management Section */}
        <div style={{ ...cardStyle, marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 28, fontWeight: 700 }}>담당자 관리</div>
            <button onClick={openAddCleaner} style={darkButton}>
              + 담당자 추가
            </button>
          </div>
          {loading ? (
            <div style={{ color: "#64748b" }}>불러오는 중...</div>
          ) : cleaners.length === 0 ? (
            <div style={{ color: "#64748b" }}>등록된 담당자가 없습니다.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
              {cleaners.map((cl) => (
                <button
                  key={cl.id}
                  onClick={() => openEditCleaner(cl)}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: "14px 16px",
                    background: "#fafafa",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "box-shadow 0.15s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.10)")}
                  onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}
                >
                  <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6, color: "#111827" }}>
                    {cl.name}
                  </div>
                  <div style={{ color: "#64748b", fontSize: 14 }}>
                    {cl.phone || "전화번호 미등록"}
                  </div>
                  {cl.bank ? (
                    <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>
                      {cl.bank}
                    </div>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
