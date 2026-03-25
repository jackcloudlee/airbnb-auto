/**
 * 이메일 모니터링 - 에어비앤비(네이버) & 부킹닷컴(Gmail) 새 메세지 텔레그램 알림
 */

const { ImapFlow } = require('imapflow');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ─── 설정 ───────────────────────────────────────────────
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5분
const SEEN_FILE = path.join(__dirname, '.email-seen.json');

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
    key: 'naver'
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
    key: 'gmail'
  }
];
// ────────────────────────────────────────────────────────

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

function sendTelegram(message) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    });

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
          const msg = await client.fetchOne(uid, { envelope: true });
          if (msg?.envelope) {
            const from = msg.envelope.from?.[0]?.address || '알 수 없음';
            const subject = msg.envelope.subject || '(제목 없음)';
            newMessages.push({ from, subject });
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
          `📧 발신: ${msg.from}`;

        console.log(`[${account.platform}] 새 메세지: ${msg.subject}`);
        await sendTelegram(text);
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

// ─── 시작 ───────────────────────────────────────────────
console.log('📬 숙소 메세지 모니터링 시작!');
console.log(`⏱️  확인 주기: 5분마다`);
console.log(`📱 텔레그램 채팅 ID: ${TELEGRAM_CHAT_ID}`);

// 시작 알림
sendTelegram('✅ 숙소 메세지 모니터링이 시작되었습니다.\n에어비앤비(네이버) & 부킹닷컴(Gmail) 5분마다 확인합니다.')
  .then(() => checkAll())
  .catch(console.error);

// 5분마다 반복
setInterval(() => {
  checkAll().catch(console.error);
}, CHECK_INTERVAL_MS);
