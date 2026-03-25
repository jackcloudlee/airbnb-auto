/**
 * 이메일 모니터링 - 에어비앤비(네이버) & 부킹닷컴(Gmail) 새 메세지 텔레그램 알림
 */

require('dotenv').config();
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ─── 설정 ───────────────────────────────────────────────
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5분
const SEEN_FILE = path.join(__dirname, '.email-seen.json');

// 에어비앤비 게스트 메세지 제목 키워드 (공지/광고 제외)
const AIRBNB_SUBJECT_KEYWORDS = [
  '메시지', '메세지', 'message',
  '문의', '예약 요청', '예약요청',
  '새 예약', '즉시 예약',
  '님이', '보냈습니다', '보내셨습니다'
];

// 부킹닷컴 게스트 메세지 제목 키워드
const BOOKING_SUBJECT_KEYWORDS = [
  '메시지', '메세지', 'message',
  '문의', '예약', 'reservation',
  'booking', 'guest'
];

const ACCOUNTS = [
  {
    platform: '에어비앤비',
    emoji: '🏠',
    host: 'imap.naver.com',
    port: 993,
    secure: true,
    user: 'heyoops',
    pass: process.env.NAVER_APP_PASSWORD,
    senderKeyword: 'airbnb',
    subjectKeywords: AIRBNB_SUBJECT_KEYWORDS,
    key: 'naver',
    replyMarkup: {
      inline_keyboard: [[
        { text: '📱 에어비앤비 메세지함 열기', url: 'https://www.airbnb.co.kr/hosting/inbox' }
      ]]
    }
  },
  {
    platform: '부킹닷컴',
    emoji: '🏨',
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    user: 'heyoopslee@gmail.com',
    pass: process.env.GMAIL_APP_PASSWORD,
    senderKeyword: 'booking.com',
    subjectKeywords: BOOKING_SUBJECT_KEYWORDS,
    key: 'gmail',
    replyMarkup: {
      inline_keyboard: [[
        { text: '📱 Pulse 앱 열기', url: 'https://dirk-nonspottable-eruptively.ngrok-free.dev/open-pulse' }
      ]]
    }
  }
];
// ────────────────────────────────────────────────────────

// 이메일 본문에서 게스트 메세지 미리보기 추출
function extractMessagePreview(text, platform) {
  if (!text) return null;

  // 불필요한 줄 필터링 (에비/부킹 공통 boilerplate)
  const boilerplate = [
    '개인 보호와 안전을 위해', '항상 에어비앤비를 통해', '에어비앤비를 통해 대화',
    '이 이메일에 직접 회신', '답장 보내기', '원문에서 자동 번역',
    'airbnb', 'booking.com', 'unsubscribe', '수신거부', '개인정보',
    'http', 'www.', '©', 'copyright', '예약자', '호스트',
    'do not reply', 'noreply', '자동 발송', 'automated'
  ];

  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => {
      if (l.length < 2) return false;
      const lower = l.toLowerCase();
      return !boilerplate.some(b => lower.includes(b.toLowerCase()));
    });

  // 의미있는 줄만 최대 3줄, 전체 150자 이내로
  const preview = lines.slice(0, 5).join(' ').replace(/\s+/g, ' ').trim();
  if (!preview) return null;
  return preview.length > 150 ? preview.slice(0, 150) + '...' : preview;
}

function loadSeen() {
  try {
    return JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveSeen(seen) {
  try {
    fs.writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 2));
  } catch (e) {
    console.error('[seen 저장 오류]', e.message);
  }
}

function sendTelegram(message, replyMarkup) {
  return new Promise((resolve, reject) => {
    const payload = {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    const body = JSON.stringify(payload);

    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function checkAccount(account, seen) {
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: { user: account.user, pass: account.pass },
    logger: false,
    tls: { rejectUnauthorized: false }
  });

  const newMessages = [];

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      // 안 읽은 메일 중 해당 발신자 검색
      const uids = await client.search({
        from: account.senderKeyword,
        seen: false
      });

      for (const uid of uids) {
        const seenKey = `${account.key}_${uid}`;
        if (seen[seenKey]) continue;

        seen[seenKey] = Date.now();

        try {
          const msg = await client.fetchOne(uid, { envelope: true, source: true });
          if (msg?.envelope) {
            const from = msg.envelope.from?.[0]?.address || '알 수 없음';
            const subject = msg.envelope.subject || '(제목 없음)';

            // 게스트 메세지 관련 키워드 필터링
            const subjectLower = subject.toLowerCase();
            const isGuestMessage = account.subjectKeywords.some(kw =>
              subjectLower.includes(kw.toLowerCase())
            );

            if (isGuestMessage) {
              // 본문에서 메세지 미리보기 추출
              let preview = null;
              if (msg.source) {
                try {
                  const parsed = await simpleParser(msg.source);
                  preview = extractMessagePreview(parsed.text, account.platform);
                } catch (e) {
                  // 파싱 실패해도 알림은 발송
                }
              }
              newMessages.push({ from, subject, preview });
            } else {
              console.log(`[${account.platform}] 공지/광고 제외: ${subject}`);
            }
          }
        } catch (fetchErr) {
          console.error(`[${account.platform}] 메세지 읽기 오류:`, fetchErr.message);
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    console.error(`[${account.platform} IMAP 오류]`, err.message);
  }

  return newMessages;
}

async function checkAll() {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(`\n[${now}] 이메일 확인 중...`);

  const seen = loadSeen();
  let anyNew = false;

  for (const account of ACCOUNTS) {
    try {
      const messages = await checkAccount(account, seen);

      for (const msg of messages) {
        anyNew = true;
        const text =
          `${account.emoji} <b>${account.platform} 새 메세지 도착!</b>\n` +
          `📌 제목: ${msg.subject}\n` +
          (msg.preview ? `💬 내용: ${msg.preview}\n` : '');

        console.log(`[${account.platform}] 새 메세지: ${msg.subject}`);
        await sendTelegram(text, account.replyMarkup);
      }

      if (messages.length === 0) {
        console.log(`[${account.platform}] 새 메세지 없음`);
      }
    } catch (err) {
      console.error(`[${account.platform} 오류]`, err.message);
    }
  }

  if (anyNew) saveSeen(seen);
}

// ─── Supabase 설정 ──────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

function supabaseFetch(apiPath) {
  return new Promise((resolve, reject) => {
    const fullUrl = new URL(SUPABASE_URL + apiPath);
    const options = {
      hostname: fullUrl.hostname,
      path: fullUrl.pathname + fullUrl.search,
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve([]); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// 현재 KST 시간이 목표 시간대인지 확인 (5분 이내)
function isTimeWindow(targetHour, targetMinute) {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const current = kst.getHours() * 60 + kst.getMinutes();
  const target = targetHour * 60 + targetMinute;
  return current >= target && current < target + 5;
}

function kstToday() {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  return { month: kst.getMonth() + 1, day: kst.getDate() };
}

// ─── 청소 알림: 퇴실 2일 전 / 1일 전 ────────────────────
async function checkCleaningAlerts() {
  try {
    const kstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const seen = loadSeen();

    const checks = [
      { daysAhead: 2, label: '2일 전', urgency: '' },
      { daysAhead: 1, label: '내일 퇴실', urgency: '⚠️ ' }
    ];

    for (const check of checks) {
      const target = new Date(kstNow);
      target.setDate(target.getDate() + check.daysAhead);
      const month = target.getMonth() + 1;
      const day = target.getDate();

      const reservations = await supabaseFetch(
        `/rest/v1/reservations?check_out=like.${encodeURIComponent(`${month}/${day} ` + '%')}&select=check_out,source,property,guest`
      );

      if (!Array.isArray(reservations) || reservations.length === 0) {
        console.log(`[청소알림] ${month}월${day}일(${check.label}) 퇴실 없음`);
        continue;
      }

      for (const res of reservations) {
        const alertKey = `cleaning_D${check.daysAhead}_${month}_${day}_${res.property}`;
        if (seen[alertKey]) continue;

        seen[alertKey] = Date.now();
        saveSeen(seen);

        const platform = res.source === 'airbnb_ical' ? '에어비앤비' : '부킹닷컴';
        const emoji = res.source === 'airbnb_ical' ? '🏠' : '🏨';
        const text =
          `🧹 ${check.urgency}<b>청소예약 필요! (${check.label})</b>\n` +
          `${emoji} [${platform}][${res.property}]\n` +
          `📅 ${month}월${day}일 퇴실 예정\n\n` +
          `청소 매니저에게 연락해 주세요!`;

        await sendTelegram(text);
        console.log(`[청소알림] ${res.property} ${month}월${day}일 (${check.label})`);
      }
    }
  } catch (err) {
    console.error('[청소알림 오류]', err.message);
  }
}

// ─── 퇴실 당일 9:10 알림 ────────────────────────────────
async function checkCheckoutTodayAlert() {
  if (!isTimeWindow(9, 10)) return;

  const { month, day } = kstToday();
  const seen = loadSeen();
  const alertKey = `checkout_today_${month}_${day}`;
  if (seen[alertKey]) return;

  try {
    const reservations = await supabaseFetch(
      `/rest/v1/reservations?check_out=like.${encodeURIComponent(`${month}/${day} ` + '%')}&select=check_in,check_out,source,property,guest`
    );

    if (!Array.isArray(reservations) || reservations.length === 0) return;

    for (const res of reservations) {
      const platform = res.source === 'airbnb_ical' ? '에어비앤비' : '부킹닷컴';
      const emoji = res.source === 'airbnb_ical' ? '🏠' : '🏨';
      const checkIn = res.check_in ? res.check_in.split(' ')[0] : '?';

      const text =
        `🚪 <b>오늘 퇴실 손님 있어요!</b>\n` +
        `${emoji} [${platform}][${res.property}]\n` +
        `📅 ${checkIn} 입실 → 오늘 ${month}월${day}일 퇴실\n\n` +
        `퇴실 확인 & 청소 준비해 주세요!`;

      await sendTelegram(text);
      console.log(`[퇴실당일] ${res.property} ${month}월${day}일`);
    }

    seen[alertKey] = Date.now();
    saveSeen(seen);
  } catch (err) {
    console.error('[퇴실당일 오류]', err.message);
  }
}

// ─── 새 예약 감지 알림 ──────────────────────────────────
async function checkNewReservations() {
  const seen = loadSeen();
  // 처음 실행시 현재 시각 기준으로 초기화 (기존 예약 무시)
  if (!seen['new_res_last_check']) {
    seen['new_res_last_check'] = new Date().toISOString();
    saveSeen(seen);
    return;
  }

  const lastCheck = seen['new_res_last_check'];
  seen['new_res_last_check'] = new Date().toISOString();
  saveSeen(seen);

  try {
    const reservations = await supabaseFetch(
      `/rest/v1/reservations?created_at=gt.${encodeURIComponent(lastCheck)}&select=check_in,check_out,source,property,guest,created_at&order=created_at.asc`
    );

    if (!Array.isArray(reservations) || reservations.length === 0) return;

    // 오늘 이후 미래 예약만 알림 (지난 예약 제외)
    const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const todayMonth = kst.getMonth() + 1;
    const todayDay = kst.getDate();

    for (const res of reservations) {
      const [datePart] = (res.check_out || '').split(' ');
      const [m, d] = datePart.split('/').map(Number);
      const isFuture = m > todayMonth || (m === todayMonth && d >= todayDay);
      if (!isFuture) continue;

      const platform = res.source === 'airbnb_ical' ? '에어비앤비' : '부킹닷컴';
      const emoji = res.source === 'airbnb_ical' ? '🏠' : '🏨';
      const checkIn = res.check_in ? res.check_in.split(' ')[0] : '?';
      const checkOut = res.check_out ? res.check_out.split(' ')[0] : '?';

      const text =
        `🆕 <b>새 예약 들어왔어요!</b>\n` +
        `${emoji} [${platform}][${res.property}]\n` +
        `📅 ${checkIn} 입실 → ${checkOut} 퇴실\n\n` +
        `🧹 청소 매니저 스케줄 확인 필요!`;

      await sendTelegram(text);
      console.log(`[새예약] ${res.property} ${checkIn} ~ ${checkOut}`);
    }
  } catch (err) {
    console.error('[새예약 감지 오류]', err.message);
  }
}

// ─── 매월 15일 10:00 청소 스케줄 확인 알림 ──────────────
async function checkMonthlyScheduleAlert() {
  const kst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  if (kst.getDate() !== 15) return;
  if (!isTimeWindow(10, 0)) return;

  const year = kst.getFullYear();
  const month = kst.getMonth() + 1;
  const seen = loadSeen();
  const alertKey = `monthly_schedule_${year}_${month}`;
  if (seen[alertKey]) return;

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextMonthYear = month === 12 ? year + 1 : year;

  const text =
    `📅 <b>다음달 청소 스케줄 확인 시기!</b>\n\n` +
    `이번 달: ${month}월 / 다음 달: ${nextMonthYear}년 ${nextMonth}월\n\n` +
    `다음달 예약 현황 확인 후\n` +
    `청소 매니저들에게 스케줄 가능 여부를\n` +
    `미리 문의해 주세요! 🧹`;

  await sendTelegram(text);
  console.log(`[월간스케줄] ${year}년 ${month}월 15일 알림 발송`);

  seen[alertKey] = Date.now();
  saveSeen(seen);
}

// ─── 입실 당일 10:50 알림 ───────────────────────────────
async function checkCheckinTodayAlert() {
  if (!isTimeWindow(10, 50)) return;

  const { month, day } = kstToday();
  const seen = loadSeen();
  const alertKey = `checkin_today_${month}_${day}`;
  if (seen[alertKey]) return;

  try {
    const reservations = await supabaseFetch(
      `/rest/v1/reservations?check_in=like.${encodeURIComponent(`${month}/${day} ` + '%')}&select=check_in,check_out,source,property,guest`
    );

    if (!Array.isArray(reservations) || reservations.length === 0) return;

    for (const res of reservations) {
      const platform = res.source === 'airbnb_ical' ? '에어비앤비' : '부킹닷컴';
      const emoji = res.source === 'airbnb_ical' ? '🏠' : '🏨';
      const checkOut = res.check_out ? res.check_out.split(' ')[0] : '?';

      const text =
        `🔑 <b>오늘 입실 손님 있어요!</b>\n` +
        `${emoji} [${platform}][${res.property}]\n` +
        `📅 오늘 ${month}월${day}일 입실 → ${checkOut} 퇴실\n\n` +
        `⚠️ 도어락 비번 설정 & 손님 안내 필요!`;

      await sendTelegram(text);
      console.log(`[입실당일] ${res.property} ${month}월${day}일`);
    }

    seen[alertKey] = Date.now();
    saveSeen(seen);
  } catch (err) {
    console.error('[입실당일 오류]', err.message);
  }
}

// ─── 시작 ───────────────────────────────────────────────
console.log('📬 숙소 알림 모니터링 시작!');
console.log(`⏱️  이메일: 5분마다 | 예약알림: 5분마다`);

// 이메일 체크 (5분마다)
checkAll().catch(console.error);
setInterval(() => checkAll().catch(console.error), CHECK_INTERVAL_MS);

// 예약 알림 (5분마다 - 각 함수가 시간/seen으로 중복 방지)
async function checkAllAlerts() {
  await checkNewReservations().catch(console.error);
  await checkCleaningAlerts().catch(console.error);
  await checkCheckoutTodayAlert().catch(console.error);
  await checkCheckinTodayAlert().catch(console.error);
  await checkMonthlyScheduleAlert().catch(console.error);
}
checkAllAlerts();
setInterval(() => checkAllAlerts(), 5 * 60 * 1000);
