# 모두의 중간역 MCP

여러 사람의 출발역에서 평균 이동시간이 짧고, 사람별 이동시간 차이도 작은 만남 역을 추천하는 TypeScript 기반 MCP 서버 MVP입니다.

예선용 MVP라 외부 API 없이 실행됩니다. 디스커버서울의 Docker `discoverseoul` DB에서 추출한 수도권 지하철 그래프 스냅샷을 내장해, 동일한 입력에는 항상 동일한 결과를 반환합니다.

## 제공 도구

| 도구 | 역할 |
| --- | --- |
| `find_fair_meeting_areas` | 여러 출발역에서 공평한 후보역을 최대 10개 추천 |
| `compare_meeting_areas` | 사용자가 지정한 후보역을 같은 기준으로 비교·순위화 |
| `explain_fairness_score` | 공정성 점수 산식과 선택적 예시 계산을 설명 |

`find_fair_meeting_areas` 예시:

```json
{
  "origins": ["강남역", "수원역", "일산역"],
  "max_candidates": 3
}
```

후보를 직접 제한할 수도 있습니다.

```json
{
  "origins": ["강남역", "수원역", "일산역"],
  "candidate_stations": ["서울역", "신도림역", "용산역"]
}
```

`compare_meeting_areas`는 후보역을 반드시 지정합니다.

```json
{
  "origins": ["강남역", "수원역", "일산역"],
  "candidate_stations": ["서울역", "신도림역", "영등포역"]
}
```

반환되는 각 후보에는 `station`, `travel_times`, `average_minutes`, `max_difference_minutes`, `fairness_score`가 포함됩니다. `travel_times`는 입력 출발역별 예상 분 단위 소요시간입니다.

## 공정성 점수

점수는 0점에서 100점 사이의 결정론적 값입니다.

```text
efficiency_penalty = min(40, average_minutes / 60 × 40)
imbalance_penalty  = min(60, max_difference_minutes / 45 × 60)
fairness_score     = round(max(0, 100 - raw_efficiency_penalty - raw_imbalance_penalty), 1)
```

- `average_minutes`: 모든 참여자의 예상 이동시간 평균입니다.
- `max_difference_minutes`: 가장 오래 걸리는 참여자와 가장 짧게 걸리는 참여자의 시간 차이입니다.
- 평균 이동시간은 최대 40점, 참여자 간 시간 차이는 최대 60점 감점됩니다. 즉 이 MVP는 단순히 가운데인 곳보다 **누구 한 사람에게 부담이 크게 쏠리지 않는 곳**을 우선합니다.
- 응답의 두 감점 항목과 최종 점수는 표시를 위해 소수점 첫째 자리로 반올림합니다. 최종 점수는 반올림 전 감점값으로 계산합니다.

`explain_fairness_score`에 두 수치를 함께 넣으면 감점 항목과 최종 점수도 계산합니다.

```json
{
  "average_minutes": 30,
  "max_difference_minutes": 15
}
```

이 예시의 점수는 60점입니다.

## 설치

Node.js 22.18 이상이 필요합니다. Node.js 25에서 검증했습니다.

```bash
cd ~/Work/everyones-middle-station
npm install
```

## 실행

### Streamable HTTP 기본 실행

원격 MCP 연결을 위한 기본 방식입니다. `POST /mcp`에 stateless Streamable HTTP(JSON 응답 모드)를 제공합니다.

```bash
npm run build
npm start
```

`dist/`만 따로 복사하지 말고 루트 `data/seoul-subway-network.json`도 함께 배포해야 합니다. 기본 어댑터가 해당 스냅샷을 읽습니다.

기본 주소는 `http://127.0.0.1:3000/mcp`입니다. 포트와 호스트는 CLI 인수 또는 환경 변수로 바꿀 수 있습니다.

```bash
npm start -- --port=3100 --host=127.0.0.1
MCP_PORT=3100 MCP_HOST=127.0.0.1 npm start
```

상태 확인용 엔드포인트:

```bash
curl http://127.0.0.1:3000/health
```

개발 중에는 Node의 TypeScript 실행과 파일 감시를 사용합니다.

```bash
npm run dev
```

### stdio 실행

로컬 MCP 클라이언트가 프로세스를 직접 실행해야 할 때 사용합니다. stdio 프로토콜을 깨뜨리지 않도록 표준 출력에는 별도 로그를 내보내지 않습니다.

```bash
npm run build
node --enable-source-maps dist/index.js --transport=stdio
```

클라이언트 설정 예시는 다음과 같습니다.

```json
{
  "mcpServers": {
    "everyones-middle-station": {
      "command": "node",
      "args": ["/Users/kimuj5090/Work/everyones-middle-station/dist/index.js", "--transport=stdio"]
    }
  }
}
```

## 개발 명령

```bash
npm run dev
npm run build
npm test
npm run typecheck
npm run lint
npm start
```

## 로컬 컨테이너 테스트

Docker Desktop을 실행한 뒤 아래 명령으로 PlayMCP와 같은 `linux/amd64` 이미지로 빌드하고 백그라운드에서 실행합니다. Apple Silicon Mac에서는 x86 이미지 에뮬레이션 때문에 첫 빌드가 몇 분 걸릴 수 있습니다.

```bash
cd ~/Work/everyones-middle-station
docker compose up -d --build
```

먼저 컨테이너 상태를 확인합니다.

```bash
curl --fail http://127.0.0.1:3000/health
docker compose ps
```

MCP 초기화와 실제 `find_fair_meeting_areas` 호출은 SDK 기반 스모크 테스트로 확인합니다. 컨테이너를 먼저 실행한 상태에서 다음을 실행하세요.

```bash
npm run test:mcp
```

성공하면 `강남역`, `수원역`, `일산역`을 기준으로 계산한 후보 3개의 JSON이 출력됩니다. 기본 주소가 아닌 서버를 확인하려면 `MCP_SMOKE_TEST_URL`을 지정합니다.

```bash
MCP_SMOKE_TEST_URL=http://127.0.0.1:3100/mcp npm run test:mcp
```

실행 로그와 종료 명령은 다음과 같습니다.

```bash
docker compose logs -f mcp
npm run docker:down
```

이미지만 따로 확인하려면 `npm run docker:build`를 사용할 수 있습니다. `npm run docker:up`은 포그라운드에서 실행하므로 로그를 계속 볼 때 적합합니다.

## HTTP 보안 기본값과 배포

서버는 기본적으로 `127.0.0.1`에 바인딩됩니다. `/mcp` 요청에는 Host 검증, Origin 검증, DNS rebinding 방지, 256 KiB 본문 제한, JSON-RPC batch 거부, 최대 20개 동시 요청, 30초 요청 제한이 적용됩니다. 허용된 브라우저 Origin에는 preflight와 실제 MCP 응답 모두에 CORS 헤더를 반환합니다.

- `MCP_ALLOWED_HOSTS`: 쉼표로 구분한 허용 Host 이름입니다. 기본값은 `MCP_HOST`입니다. TLS reverse proxy 뒤에서 공개 도메인을 쓸 경우 반드시 실제 도메인을 설정합니다. `*`는 유효한 모든 Host를 허용하며, Host를 사전에 알 수 없는 PlayMCP in KC 관리형 게이트웨이 컨테이너에서만 사용합니다.
- `MCP_ALLOWED_ORIGINS`: 쉼표로 구분한 브라우저 Origin 목록입니다. 기본값은 비어 있으며, Origin 헤더가 있는 요청은 모두 거부합니다. 일반 MCP 클라이언트는 Origin 헤더를 보내지 않습니다.
- `MCP_MAX_BODY_BYTES`, `MCP_MAX_CONCURRENT_REQUESTS`, `MCP_REQUEST_TIMEOUT_MS`: 각각 본문·동시 요청·요청 시간 상한입니다. 시간 상한이 지나면 `TravelTimeAdapter.estimateMinutes`에 전달한 `AbortSignal`이 취소됩니다. 이후 연동 어댑터는 이 신호를 반드시 준수해 HTTP 요청·조회 작업을 정리해야 합니다.

공개 배포는 이 프로세스를 직접 노출하지 않고, TLS·IP/토큰 기반 인증·rate limit을 적용한 신뢰 가능한 reverse proxy 뒤에서 운영해야 합니다. 외부 API와 사용자 인증을 추가하기 전에는 해당 경계에서 비밀 관리와 egress 정책도 구성해야 합니다.

## PlayMCP in KC 컨테이너 배포

노션 가이드의 이미지 등록 방식에 맞춰 [Dockerfile](/Users/kimuj5090/Work/everyones-middle-station/Dockerfile)을 추가했습니다. 이미지는 반드시 `linux/amd64`로 빌드해야 합니다. Apple Silicon 환경에서 `arm64` 이미지를 등록하면 PlayMCP in KC에서 활성화되지 않습니다.

```bash
docker build --platform linux/amd64 \
  -t ghcr.io/<OWNER>/everyones-middle-station:<TAG> .

docker run --rm -p 3000:3000 \
  ghcr.io/<OWNER>/everyones-middle-station:<TAG>

curl http://127.0.0.1:3000/health
```

로컬 확인 후 사용하는 레지스트리에 로그인하고 이미지를 push합니다. 예를 들어 GHCR은 다음과 같습니다.

```bash
docker push ghcr.io/<OWNER>/everyones-middle-station:<TAG>
```

PlayMCP in KC에서 **새 MCP 서버 등록 → 이미지 등록**을 선택한 뒤 다음을 입력합니다.

- MCP 서버 이름과 설명
- 레지스트리 Host: 예) `ghcr.io`
- private 이미지일 때만 레지스트리 사용자·비밀번호
- `image_name`: 예) `<OWNER>/everyones-middle-station`
- `image_tag`: 예) `<TAG>`

상태가 **Active**가 되면 상세 화면의 Endpoint URL을 사용합니다. Dockerfile은 컨테이너에서 `0.0.0.0:3000`으로 수신하며, 관리형 게이트웨이의 Host를 허용하도록 `MCP_ALLOWED_HOSTS=*`를 기본 설정합니다. 이 이미지를 다른 공개 환경에 직접 노출할 때는 해당 환경의 실제 도메인으로 `MCP_ALLOWED_HOSTS`를 반드시 재정의하세요.

## 구조와 카카오맵 연동 지점

`src/domain.ts`의 `TravelTimeAdapter`가 경로 데이터 경계입니다. 기본 구현은 디스커버서울 DB 스냅샷 어댑터를 사용합니다.

- `data/seoul-subway-network.json`: 디스커버서울의 `graph_nodes`와 `graph_edges`에서 추출한 정적 스냅샷
- `src/seoul-subway-data.ts`: 스냅샷의 Zod 검증과 파일 로드
- `src/seoul-subway-index.ts`: 노선별 역 노드를 실제 환승 간선으로 묶어 사용자용 물리 역으로 정규화
- `src/seoul-subway-network.ts`: 환승 가중치를 반영한 다익스트라 이동시간 계산과 캐시
- `src/sample-network.ts`: 기본 DB 스냅샷 어댑터와 테스트 전용 소형 그래프 생성
- `src/meeting-service.ts`: 후보 평가, 점수 계산, 정렬

스냅샷은 `station_line` 노드 799개와 방향성 `ride`·`transfer` 간선 1,892개로 구성됩니다. 환승 간선으로 연결된 노선별 노드를 하나의 물리 역으로 묶어, MCP에는 657개 역을 노출합니다. `ride`는 역 사이 2분, `transfer`는 5분이라는 디스커버서울 그래프의 모델 가중치를 그대로 사용합니다. 서버 실행 중에는 Docker DB를 조회하지 않습니다.

본선 또는 실제 서비스에서는 `TravelTimeAdapter`를 구현한 `KakaoMapTravelTimeAdapter`로 교체하면 됩니다.

1. 카카오맵 장소 검색으로 사용자 입력을 출발 좌표·역으로 정규화합니다.
2. 후보역마다 카카오맵 길찾기 결과를 조회해 참여자별 실제 대중교통 이동시간을 가져옵니다.
3. `estimateMinutes`만 실제 시간으로 바꾸고, 공정성 산식·MCP 도구 입출력은 그대로 유지합니다.
4. 요일·시간대·교통수단을 입력 스키마에 추가하고, 비동기 경로 API 응답 캐시와 오류 정책을 운영 환경에 맞게 넣습니다.

## 현재 한계

- 수도권 지하철 그래프의 657개 물리 역을 지원합니다. 환승으로 연결되지 않은 동명역은 노선 표기를 반드시 붙여야 합니다. 예를 들어 `양평역`은 `AmbiguousStationError`를 반환하며, `양평역 (5호선)` 또는 `양평역 (경의중앙선)`으로 지정합니다. `서울 (GTX-A)`처럼 원래 역명에 노선을 붙인 별칭도 지원합니다.
- 자동 후보 추천은 모든 출발역에서 경로가 없는 DB 그래프 노드를 제외합니다. 사용자가 해당 역을 직접 비교 후보로 지정하면 `RouteUnavailableError`로 알려줍니다.
- 이동시간은 역간 2분·환승 5분의 고정 가중치입니다. 실제 시간표·도보·환승 대기·교통 상황을 반영하지 않는 노선도 기반 추정치입니다.
- 그래프는 디스커버서울 DB의 특정 시점 스냅샷입니다. DB가 갱신되면 `station_line`, `ride`, `transfer` 데이터만 다시 내보내고 Zod 검증·테스트를 거쳐 교체해야 합니다.
- 실시간 카카오맵·공공데이터 연동과 사용자 인증은 포함하지 않았습니다. HTTP 요청의 기본 방어는 구현했지만, 공개 배포의 TLS·edge rate limit·인증은 reverse proxy 또는 API gateway에서 별도로 구성해야 합니다.
- HTTP 전송은 가벼운 stateless MVP입니다. 장기 작업, 알림, 세션 재개가 필요하면 stateful Streamable HTTP 구성으로 확장해야 합니다.
