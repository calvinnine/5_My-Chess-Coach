import Link from "next/link";
import { LegalPage, List, Section } from "@/components/LegalPage";

export const metadata = {
  title: "이용약관 · 개인 체스 코치",
};

export default function TermsPage() {
  return (
    <LegalPage title="이용약관" updated="2026-09-05">
      <Section heading="이 서비스가 하는 일">
        <p>
          Chess.com에서 <strong className="font-medium text-ink">본인의</strong> 대국을
          가져와 분석하고, 반복되는 약점과 연습 방향을 한국어로 알려줍니다. 무료이고
          개인 프로젝트로 운영합니다.
        </p>
      </Section>

      <Section heading="본인 계정만 분석할 수 있습니다">
        <p>
          다른 사람의 Chess.com 아이디를 넣어 분석할 수 없습니다. 계정이 본인 것임을
          확인한 뒤에만 데이터를 가져오고, 서버가 모든 요청에서 소유자를 확인합니다.
          공개 데이터라 하더라도 남의 기록을 대신 분석해주는 서비스는 만들지 않습니다.
        </p>
      </Section>

      <Section heading="지켜주셨으면 하는 것">
        <List
          items={[
            <>본인 계정으로만 사용하기.</>,
            <>
              요청 제한을 우회하려 하지 않기. Chess.com API를 함께 쓰는 만큼, 한 사람이
              몰아 쓰면 모두가 막힙니다.
            </>,
            <>서비스나 다른 사용자의 데이터에 무단으로 접근하려 하지 않기.</>,
          ]}
        />
      </Section>

      <Section heading="분석 결과에 대해">
        <p>
          분석은 Stockfish 엔진의 판단과 규칙 기반 해석입니다. 유용한 참고가 되도록
          만들었지만 <strong className="font-medium text-ink">정답을 보장하지는
          않습니다</strong>. 모든 코칭 문장은 근거가 된 대국과 수를 함께 보여주니, 납득이
          안 되면 직접 확인해 보시길 권합니다.
        </p>
      </Section>

      <Section heading="Chess.com과의 관계">
        <p>
          이 서비스는 Chess.com이 만들거나 보증한 것이 아닙니다. Chess.com이 공개한
          API를 사용할 뿐이며, 대국 기록의 원본은 Chess.com에 있습니다.
        </p>
      </Section>

      <Section heading="중단과 변경">
        <p>
          개인이 운영하는 무료 서비스라 중단되거나 기능이 바뀔 수 있습니다. 중요한 데이터는{" "}
          <Link href="/settings" className="text-accent hover:underline">
            설정
          </Link>
          에서 미리 내려받아 두시길 권합니다. 서비스가 멈추더라도 원본 대국 기록은
          Chess.com에 그대로 남아 있습니다.
        </p>
      </Section>

      <Section heading="책임">
        <p>
          무료로 있는 그대로 제공합니다. 이 서비스를 사용해 생긴 결과에 대해 법이 허용하는
          범위에서 책임을 지지 않습니다.
        </p>
      </Section>

      <Section heading="개인정보">
        <p>
          무엇을 저장하고 어떻게 지우는지는{" "}
          <Link href="/privacy" className="text-accent hover:underline">
            개인정보 처리방침
          </Link>
          에 적어두었습니다.
        </p>
      </Section>
    </LegalPage>
  );
}
