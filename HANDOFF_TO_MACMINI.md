# 숙소 운영보드 - 맥미니 세팅 및 배포 가이드
> 이 문서를 맥미니의 Claude에게 먼저 읽히고 작업을 시작하세요.
> 프로젝트 파일은 iCloud를 통해 이미 공유되어 있습니다.

---

## 상황 요약

- 맥북에서 개발 완료된 숙소 운영 웹앱을 맥미니에서 구동 + 배포하는 작업
- 프로젝트 파일: iCloud 폴더에 있으므로 파일 이동 불필요
- 맥미니는 24시간 켜져 있어 백엔드 서버 역할을 담당

---

## 프로젝트 구조

```
airbnb_auto/
├── src/
│   ├── App.jsx          # React 프론트엔드 (메인 앱)
│   ├── supabaseClient.js
│   └── main.jsx
├── server.js            # Node.js 백엔드 (Express, port 8787)
├── .env                 # 환경변수
└── package.json
```

### 로컬 실행 명령어
```bash
npm run dev:all       # 프론트 + 백엔드 동시 실행
npm run server        # 백엔드만 (port 8787)
npm run dev:client    # 프론트만 (port 5173)
```

---

## STEP 1 — 맥미니 환경 확인

터미널에서 아래 명령어로 확인:

```bash
node --version    # v18 이상이어야 함
npm --version     # 확인
```

### Node.js가 없거나 버전이 낮으면
```bash
# Homebrew가 있는 경우
brew install node

# Homebrew도 없는 경우
brew 먼저 설치: https://brew.sh
```

### 의존성 설치
```bash
cd [프로젝트 경로]
npm install
```

### 로컬 실행 테스트
```bash
npm run dev:all
# 브라우저에서 http://localhost:5173 접속해서 정상 작동 확인
```

---

## STEP 2 — pm2 설치 (백엔드 상시 실행)

pm2는 서버를 백그라운드에서 실행하고, 맥미니 재부팅 시 자동으로 다시 시작해 줍니다.

```bash
# pm2 전역 설치
npm install -g pm2

# 프로젝트 폴더로 이동
cd [프로젝트 경로]

# 백엔드 서버 시작
pm2 start server.js --name airbnb-server

# 맥미니 부팅 시 자동 실행 등록
pm2 startup
# ⚠️ 위 명령어 실행 후 출력되는 sudo 명령어를 복사해서 실행해야 함

# 현재 프로세스 목록 저장
pm2 save

# 상태 확인
pm2 status
pm2 logs airbnb-server
```

---

## STEP 3 — Cloudflare Tunnel 설치

맥미니의 8787 포트를 외부 HTTPS URL로 노출합니다.
Cloudflare 계정이 없으면 cloudflare.com에서 무료 가입 필요.

```bash
# cloudflared 설치
brew install cloudflared

# Cloudflare 계정 로그인 (브라우저 열림)
cloudflared tunnel login

# 터널 생성 (이름은 자유롭게)
cloudflared tunnel create airbnb-tunnel
# ⚠️ 생성 후 터널 ID가 출력됨 — 메모해 둘 것

# 설정 파일 생성
mkdir -p ~/.cloudflared
```

아래 내용으로 `~/.cloudflared/config.yml` 파일 생성:
```yaml
tunnel: <터널 ID>
credentials-file: /Users/<맥미니 유저명>/.cloudflared/<터널 ID>.json

ingress:
  - service: http://localhost:8787
```

```bash
# DNS 레코드 등록 (도메인이 있는 경우)
cloudflared tunnel route dns airbnb-tunnel api.yourdomain.com

# 도메인 없는 경우 trycloudflare.com 임시 URL 사용 가능
cloudflared tunnel --url http://localhost:8787
# ⚠️ 이 경우 재실행마다 URL이 바뀌므로 나중에 도메인 연결 권장

# 터널 실행
cloudflared tunnel run airbnb-tunnel

# pm2로 터널도 상시 실행 등록
pm2 start "cloudflared tunnel run airbnb-tunnel" --name cloudflare-tunnel
pm2 save
```

---

## STEP 4 — Vercel 프론트엔드 배포

### 4-1. GitHub에 코드 올리기
```bash
cd [프로젝트 경로]
git init
git add .
git commit -m "initial commit"
# GitHub에 새 repository 만들고 push
git remote add origin https://github.com/<유저명>/<레포이름>.git
git push -u origin main
```

### 4-2. Vercel 배포
1. vercel.com 접속 → 로그인 (GitHub 계정 연동)
2. "New Project" → GitHub 레포 선택
3. Framework: **Vite** 선택
4. 환경변수 입력 (아래 참고)
5. Deploy 클릭

### 4-3. Vercel 환경변수 설정
Vercel 대시보드 → Settings → Environment Variables에 아래 3개 입력:

```
VITE_SUPABASE_URL        = https://turjhleywuqfeezzmezk.supabase.co
VITE_SUPABASE_ANON_KEY   = [.env 파일의 VITE_SUPABASE_ANON_KEY 값]
VITE_API_BASE_URL        = https://[Cloudflare Tunnel에서 발급된 URL]
```

> ⚠️ VITE_API_BASE_URL이 핵심입니다.
> Cloudflare Tunnel URL을 여기에 넣어야 프론트가 맥미니 서버와 통신합니다.

---

## STEP 5 — Supabase RLS 보안 설정 (배포 전 권장)

현재 RLS가 꺼져 있어 민감정보(주민번호, 계좌번호)가 노출될 수 있습니다.
Supabase 대시보드 → SQL Editor에서 아래 실행:

```sql
-- RLS 활성화
ALTER TABLE cleaners ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleanings ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

-- 로그인한 사용자만 접근 허용
CREATE POLICY "authenticated only" ON cleaners
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated only" ON reservations
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated only" ON cleanings
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated only" ON properties
  FOR ALL USING (auth.role() = 'authenticated');
```

---

## STEP 6 — 배포 후 확인

- [ ] Vercel URL 브라우저에서 접속 → 로그인 화면 확인
- [ ] 이메일/비밀번호 로그인 확인
- [ ] 예약 캘린더 정상 로드 확인
- [ ] "지금 동기화" 버튼 → 맥미니 서버 응답 확인
- [ ] 폰(모바일)에서 접속 확인
- [ ] 와이프 계정으로도 로그인 확인

---

## 주의사항 모음

### iCloud 폴더 관련
- 맥미니에서 iCloud 폴더가 완전히 동기화된 상태인지 먼저 확인
- 동기화 안 된 파일은 회색으로 표시됨
- `npm install`은 맥미니에서 따로 실행해야 함 (node_modules는 iCloud 동기화 안 됨)

### .env 파일 관련
- .env 파일은 .gitignore에 포함되어 있어 GitHub에 올라가지 않음
- Vercel 배포 시 환경변수는 Vercel 대시보드에서 직접 입력
- 맥미니의 .env는 iCloud를 통해 공유되므로 별도 작업 불필요

### pm2 관련
- `pm2 startup` 실행 후 출력되는 sudo 명령어를 반드시 실행해야 부팅 자동 실행이 됨
- 로그 확인: `pm2 logs airbnb-server`
- 재시작: `pm2 restart airbnb-server`
- 중지: `pm2 stop airbnb-server`

### Cloudflare Tunnel 관련
- 무료 계정으로 사용 가능
- 도메인이 없으면 trycloudflare.com 임시 URL 사용 가능하지만 재실행 시 URL 변경됨
- 도메인 구입 시 Cloudflare에서 구입하면 Tunnel과 연동이 가장 쉬움 (연 $10~12)
- 터널 URL이 바뀌면 Vercel 환경변수(VITE_API_BASE_URL)도 업데이트 후 재배포 필요

---

## 나중에 추가 예정인 기능

1. **텔레그램 알림** — 네이버 IMAP으로 게스트 메시지 수신 시 알림
   - 네이버 IMAP: imap.naver.com:993
   - 텔레그램 봇 API 키 발급 필요 (t.me/BotFather)

2. **은행 내역 연동** — 수익 정산용 거래내역 파일 업로드 기능

3. **안내 메시지 발송 관리** — 체크인 당일 안내문 발송 여부 추적

---

*작성일: 2026-03-22*
