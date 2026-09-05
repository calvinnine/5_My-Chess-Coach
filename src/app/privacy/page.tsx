import Link from "next/link";
import { LegalPage, List, Section } from "@/components/LegalPage";

export const metadata = {
  title: "개인정보 처리방침 · 개인 체스 코치",
};

/*
 * Written from the schema, not from a template: every item below corresponds
 * to a table this app actually writes. A policy that describes something other
 * than what the code does is worse than none.
 */
export default function PrivacyPage() {
  return (
    <LegalPage title="개인정보 처리방침" updated="2026-09-05">
      <Section heading="한 줄 요약">
        <p>
          Chess.com 공개 API로 가져온 <strong className="font-medium text-ink">형의 대국
          기록</strong>과, 형이 직접 쓴 메모를 저장합니다. 비밀번호는 요청하지도 저장하지도
          않습니다. 언제든 전부 삭제할 수 있습니다.
        </p>
      </Section>

      <Section heading="저장하는 것">
        <List
          items={[
            <>
              <strong className="font-medium text-ink">계정</strong> — Chess.com 사용자명,
              표시 이름, 가입 시점, 시간제별 레이팅. 모두 공개 프로필에서 가져옵니다.
            </>,
            <>
              <strong className="font-medium text-ink">대국</strong> — PGN 원본, 상대
              사용자명, 결과, 오프닝, 시간제, 대국 시각.
            </>,
            <>
              <strong className="font-medium text-ink">분석</strong> — 수마다의 평가값,
              최선수, 손실 점수, 등급, 국면, 감지된 약점 태그.
            </>,
            <>
              <strong className="font-medium text-ink">형이 쓴 것</strong> — 대국 복기 메모,
              당시 생각, 퍼즐 시도 기록. 이 앱에서 가장 사적인 데이터입니다.
            </>,
            <>
              <strong className="font-medium text-ink">로그인</strong> — 세션 토큰의
              해시(원문 아님), 만료 시각. 본인 확인 중에는 요청 주소의 해시를 보관하는데,
              요청 횟수를 제한하는 용도로만 쓰고 코드가 만료되면 함께 지웁니다.
            </>,
          ]}
        />
      </Section>

      <Section heading="저장하지 않는 것">
        <List
          items={[
            <>
              <strong className="font-medium text-ink">Chess.com 비밀번호</strong> — 묻지
              않습니다. 이 앱에는 비밀번호를 받을 입력란 자체가 없습니다.
            </>,
            <>결제 정보 — 유료 기능이 없습니다.</>,
            <>광고 식별자나 추적 스크립트 — 넣지 않았습니다.</>,
            <>요청 주소(IP) 원문 — 해시만 잠깐 두고, 그마저 만료 시 지웁니다.</>,
          ]}
        />
      </Section>

      <Section heading="쓰는 곳">
        <p>
          저장한 데이터는 <strong className="font-medium text-ink">형에게 코칭을 보여주는
          데에만</strong> 씁니다. 다른 사용자에게 보여주거나, 팔거나, 광고에 쓰지 않습니다.
          자기 계정의 데이터는 자기만 볼 수 있고, 서버가 모든 요청에서 소유자를 확인합니다.
        </p>
      </Section>

      <Section heading="맡기는 곳">
        <List
          items={[
            <>
              <strong className="font-medium text-ink">Chess.com</strong> — 대국 기록을
              가져오는 출처. 공개 API(<code className="font-mono text-xs">api.chess.com/pub</code>)만
              사용합니다.
            </>,
            <>
              <strong className="font-medium text-ink">Vercel</strong> — 이 사이트를
              띄우는 곳.
            </>,
            <>
              <strong className="font-medium text-ink">Turso</strong> — 데이터베이스가
              놓인 곳(도쿄 리전).
            </>,
          ]}
        />
        <p>이 셋 외의 어디에도 데이터를 보내지 않습니다.</p>
      </Section>

      <Section heading="분석은 형의 브라우저에서 돕니다">
        <p>
          체스 엔진(Stockfish)은 서버가 아니라 <strong className="font-medium text-ink">형의
          브라우저 안에서</strong> 실행됩니다. 서버로 올라오는 것은 엔진이 낸 점수뿐이고,
          그 점수로 손실·등급·약점을 계산하는 일은 서버가 다시 합니다.
        </p>
      </Section>

      <Section heading="보관 기간과 삭제">
        <p>
          계정이 살아 있는 동안 보관합니다.{" "}
          <Link href="/settings" className="text-accent hover:underline">
            설정
          </Link>
          에서 <strong className="font-medium text-ink">계정 삭제</strong>를 누르면 대국,
          분석, 메모, 퍼즐 기록, 로그인 정보가 **즉시 그리고 되돌릴 수 없게** 지워집니다.
          지우기 전에 PGN과 분석 결과를 파일로 내려받을 수 있습니다.
        </p>
      </Section>

      <Section heading="문의">
        <p>
          <code className="font-mono text-xs">hyeokseong.lee@gmail.com</code>
        </p>
      </Section>
    </LegalPage>
  );
}
