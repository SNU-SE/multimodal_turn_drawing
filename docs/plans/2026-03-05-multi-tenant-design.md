# Multi-Tenant Admin System Design

## Overview

Turn-based drawing platform을 단일 관리자에서 다계층 멀티테넌트 시스템으로 업그레이드한다.

## Role Hierarchy (3-tier)

```
전체 관리자 (super_admin)
  └── 기관 관리자 (org_admin)  ×N
        └── 교사 (teacher)  ×M
```

## Permission Matrix

| 기능 | super_admin | org_admin | teacher |
|------|:-----------:|:---------:|:-------:|
| 기관 CRUD | O | - | - |
| 기관 관리자 CRUD | O | - | - |
| 교사 CRUD | - | O (자기 기관) | - |
| 세션/방/문제 CRUD | O (자기 기관) | - | O (자기 기관) |
| 전체 기관 모니터링 | O (읽기+다운로드) | - | - |
| 기관 내 데이터 조회 | O | - | O (자기 데이터) |
| 데이터 다운로드 | O (전체) | - | O (자기 기관) |

## Authentication

### Supabase Auth with Email Pattern

모든 관리자/교사를 Supabase Auth 사용자로 등록. 이메일은 자동 생성 패턴 사용.

| 역할 | 이메일 패턴 | 로그인 입력 | 예시 |
|------|-----------|----------|------|
| super_admin | `superadmin@internal.bioclass.kr` | 비밀번호만 | 고정 1개 |
| org_admin | `org-{NEIS코드}@internal.bioclass.kr` | 비밀번호만 | `org-7010057@internal.bioclass.kr` |
| teacher | `t-{teacherId}-{NEIS코드}@internal.bioclass.kr` | ID + PW | `t-kim01-7010057@internal.bioclass.kr` |

- UI에서 이메일은 표시하지 않음. URL의 NEIS 코드 + 입력값으로 이메일을 자동 구성하여 `signInWithPassword` 호출
- `email_confirm: true`로 생성하여 이메일 인증 불필요

### User Creation via Edge Function

service_role_key를 프론트엔드에 노출하지 않기 위해 Supabase Edge Function 사용.

```
프론트엔드 (인증된 super_admin/org_admin)
    ↓
supabase.functions.invoke('manage-users', {
  body: { action, role, orgId, teacherId, password, displayName }
})
    ↓
Edge Function (서버에서 실행)
  1. JWT에서 호출자 확인
  2. profiles에서 역할 검증:
     - super_admin → org + org_admin 생성 가능
     - org_admin → 자기 기관의 teacher만 생성 가능
  3. service_role_key로 Supabase Auth 사용자 생성
  4. profiles INSERT
  5. 결과 반환
```

VPS에서 `supabase/edge-runtime:v1.69.25` 컨테이너가 이미 동작 중 확인됨.

## URL Routing

```
/superadmin/login        → 전체 관리자 로그인 (비밀번호만)
/superadmin              → SuperAdminLayout (AuthGuard: super_admin)
  ├── /superadmin                → 기관 목록 + 요약 대시보드
  ├── /superadmin/orgs/:neisCode → 기관 상세 (교사별 세션, 다운로드)
  ├── /superadmin/groups/:id     → 세션 관리 (재사용: AdminRoomGroup)
  ├── /superadmin/recap/:id      → 방 상세 (재사용: AdminRecap)
  └── /superadmin/questions      → 문제 은행 (재사용: AdminBank)

/:neis/admin/login       → 기관 로그인 (교사 기본 + 기관관리자 전환)
/:neis/admin             → OrgLayout (AuthGuard: org_admin | teacher)
  ├── [org_admin] /:neis/admin              → 교사 관리 대시보드
  ├── [teacher]   /:neis/admin              → 세션 목록 (재사용: AdminDashboard)
  ├── [teacher]   /:neis/admin/groups/:id   → 세션 관리 (재사용: AdminRoomGroup)
  ├── [teacher]   /:neis/admin/recap/:id    → 방 상세 (재사용: AdminRecap)
  └── [teacher]   /:neis/admin/questions    → 문제 은행 (재사용: AdminBank)

/                        → Home (학생 초대 코드 입력)
/room/:code              → 게임 방 (변경 없음)
```

## Database Schema Changes

### New Tables

```sql
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  neis_code TEXT UNIQUE NOT NULL,       -- 행정표준코드 7자리
  name TEXT NOT NULL,                    -- 학교/기관명
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'org_admin', 'teacher')),
  org_id UUID NOT NULL REFERENCES organizations(id),
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Altered Tables

```sql
-- room_groups: 기관 격리
ALTER TABLE room_groups ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE room_groups ADD COLUMN created_by UUID REFERENCES auth.users(id);

-- questions: 문제 은행 격리
ALTER TABLE questions ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE questions ADD COLUMN created_by UUID REFERENCES auth.users(id);
```

### Data Isolation via RLS

```sql
-- 교사: 자기 기관 데이터만
CREATE POLICY "teacher_org_isolation" ON room_groups
  FOR ALL USING (
    org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
  );

-- 전체 관리자: 모든 데이터
CREATE POLICY "super_admin_all_access" ON room_groups
  FOR ALL USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'super_admin'
  );
```

동일한 패턴을 questions, rooms (via room_groups.org_id), room_questions, canvas_logs, turns_log에 적용.

## Invite Code Expansion

```
기존: 6자리 숫자 (0-9) → 1,000,000 조합
변경: 7자리 알파벳(대문자)+숫자, 헷갈리는 문자 제외

사용 가능 문자 (31개):
  A B C D E F G H J K M N P Q R S T U V W X Y Z
  2 3 4 5 6 7 8 9

제외 문자: O(영문) ↔ 0(숫자), I(영문) ↔ 1(숫자), L(영문)

조합 수: 31^7 = 27,512,614,111 (약 275억)
```

## Login Page UI

### /{neis}/admin/login

- **기본 탭: 교사 로그인**
  - ID 필드 (알파벳+숫자, 예: kim01)
  - 비밀번호 필드
  - 로그인 버튼
  - 하단 텍스트: "기관 관리자이신가요?" (클릭 시 전환)

- **기관관리자 모드**
  - 비밀번호 필드만
  - 로그인 버튼
  - 하단 텍스트: "교사 로그인으로 돌아가기" (클릭 시 전환)

### /superadmin/login

- 비밀번호 필드만
- 로그인 버튼

## Migration Strategy

### Migration Files

```
supabase/migrations/
  20260305000005_multi_tenant_tables.sql   ← organizations, profiles
  20260305000006_add_org_columns.sql       ← org_id, created_by on existing tables
  20260305000007_multi_tenant_rls.sql      ← new RLS policies, remove old anon policies
```

### Migration Steps

1. organizations, profiles 테이블 생성
2. "전체관리자" 전용 기관 자동 INSERT
3. room_groups, questions에 org_id 컬럼 추가 (nullable)
4. 기존 데이터에 전체관리자 기관의 org_id 할당
5. org_id를 NOT NULL로 변경
6. 새 RLS 정책 추가
7. 기존 anon 허용 정책 제거

### Edge Function Deployment

```
supabase/functions/manage-users/index.ts
```

VPS의 Supabase functions volume에 배포.

## Existing Code Reuse

기존 admin 컴포넌트를 최대한 재사용:

| 기존 컴포넌트 | 변경 사항 |
|-------------|----------|
| AdminDashboard | org_id 필터 추가, teacher/super_admin 공용 |
| AdminRoomGroup | org_id 필터 추가, created_by 설정 |
| AdminRecap | 변경 미미 (방 데이터는 room_groups를 통해 격리) |
| AdminBank | org_id 필터 추가 |
| AuthGuard | Supabase Auth 세션 + 역할 확인으로 변경 |

### New Components

| 컴포넌트 | 역할 |
|---------|------|
| SuperAdminLogin | /superadmin 로그인 (비밀번호만) |
| SuperAdminLayout | 전체 관리자 레이아웃 (사이드바) |
| SuperAdminDashboard | 기관 목록 + 요약 통계 |
| OrgDetail | 기관 상세 (교사별 세션, 다운로드) |
| OrgLogin | /{neis}/admin 로그인 (교사 + 기관관리자 탭) |
| OrgAdminDashboard | 기관 관리자 대시보드 (교사 CRUD) |
| OrgLayout | 기관 레이아웃 (역할 기반 사이드바) |
