# Airbnb Auto

Airbnb와 Booking iCal 예약 정보를 읽어 Supabase에 동기화하고, 숙소 운영 현황을 대시보드로 보는 프로젝트입니다.

## 현재 구조

- 프론트엔드: React + Vite
- 백엔드: Express 단일 서버
- 데이터 저장소: Supabase
- 동기화 대상: Airbnb / Booking iCal

## 핵심 기능

- `reservations`와 `cleanings` 테이블 조회
- 수동 동기화 버튼으로 `/sync-now` 호출
- 서버 시작 시 자동 동기화
- `SYNC_INTERVAL_MINUTES` 기준 주기 동기화
- 월간 예약 캘린더와 당일 작업 현황 표시

## 실행 방법

1. 루트의 `.env` 값을 확인합니다.
2. 서버를 실행합니다.

```bash
npm run server
```

3. 다른 터미널에서 프론트를 실행합니다.

```bash
npm run dev:client
```

하나의 터미널에서 둘 다 실행하려면:

```bash
npm run dev:all
```

기본 주소:

- 프론트: `http://localhost:5173`
- 서버: `http://localhost:8787`

## 환경 변수

예시는 `.env.example`에 있습니다.

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE_URL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `AIRBNB_ICAL_URL`
- `PORT`
- `SYNC_INTERVAL_MINUTES`

## 참고

- 복사해온 프로젝트라 절대 경로 의존은 현재 보이지 않았습니다.
- 다만 프론트 API 주소와 Supabase 정보는 이제 `.env` 기준으로 관리합니다.
- 실제 숙소가 여러 개면 `properties` 테이블의 `airbnb_ical_url`, `booking_ical_url` 값을 우선 사용합니다.
