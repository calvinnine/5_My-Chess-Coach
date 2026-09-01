export type TagCategory = "tactics" | "strategy" | "habit" | "phase";

export interface TagDefinition {
  tag: string;
  label: string;
  category: TagCategory;
  description: string;
  /** One concrete action, used in checklists and training tasks. */
  coaching: string;
  /** 0–1; how much a single occurrence should count toward severity. */
  weight: number;
}

export const WEAKNESS_TAGS: TagDefinition[] = [
  {
    tag: "allowed_mate",
    label: "메이트 위협 누락",
    category: "tactics",
    description: "상대에게 강제 메이트를 허용한 장면입니다.",
    coaching: "수를 두기 전 상대의 체크 가능한 수를 모두 나열하고 넘어가기",
    weight: 1,
  },
  {
    tag: "missed_mate",
    label: "메이트 기회 상실",
    category: "tactics",
    description: "강제 메이트가 있었지만 다른 수를 두었습니다.",
    coaching: "상대 킹 주변에 기물이 3개 이상 모이면 체크부터 먼저 계산하기",
    weight: 0.9,
  },
  {
    tag: "hanging_piece",
    label: "걸린 기물 미확인",
    category: "tactics",
    description: "충분히 보호되지 않은 기물을 남겼습니다.",
    coaching: "수를 둔 뒤 내 기물 중 보호받지 못하는 기물이 있는지 한 번 훑기",
    weight: 1,
  },
  {
    tag: "missed_opponent_threat",
    label: "상대 위협 미확인",
    category: "tactics",
    description: "상대에게 재료를 얻는 수를 허용했습니다.",
    coaching: "내 수를 정하기 전에 상대의 체크·잡기·위협 세 가지를 순서대로 확인하기",
    weight: 1,
  },
  {
    tag: "allowed_fork",
    label: "포크 허용",
    category: "tactics",
    description: "두 기물이 동시에 공격받는 수를 허용했습니다.",
    coaching: "나이트가 닿을 수 있는 칸과 내 기물의 배치를 함께 확인하기",
    weight: 0.9,
  },
  {
    tag: "missed_material",
    label: "재료 획득 기회 상실",
    category: "tactics",
    description: "재료를 얻을 수 있는 수를 놓쳤습니다.",
    coaching: "모든 잡는 수를 먼저 나열한 뒤 조용한 수를 검토하기",
    weight: 0.8,
  },
  {
    tag: "back_rank",
    label: "백랭크 약점",
    category: "tactics",
    description: "킹의 백랭크 탈출로가 막혔습니다.",
    coaching: "룩·퀸이 교환되기 전에 킹의 탈출 칸을 미리 만들어 두기",
    weight: 0.8,
  },
  {
    tag: "king_safety",
    label: "킹 안전 훼손",
    category: "strategy",
    description: "킹이 직접 노출되는 수를 두었습니다.",
    coaching: "킹 앞 폰을 움직이기 전에 상대의 공격 기물 수를 세어보기",
    weight: 0.9,
  },
  {
    tag: "squandered_advantage",
    label: "이긴 포지션에서 성급함",
    category: "habit",
    description: "유리한 흐름을 한 수로 넘겨주었습니다.",
    coaching: "유리할 때는 복잡화 대신 가장 단순한 수를 우선 검토하기",
    weight: 1,
  },
  {
    tag: "passive_when_worse",
    label: "불리할 때 수동적 대응",
    category: "habit",
    description: "불리한 상황에서 버티는 수를 찾지 못했습니다.",
    coaching: "불리하면 교환보다 상대에게 문제를 만드는 수를 먼저 찾기",
    weight: 0.7,
  },
  {
    tag: "only_move_position",
    label: "유일수 장면 계산 부족",
    category: "habit",
    description: "정확한 한 수가 필요한 장면에서 다른 수를 두었습니다.",
    coaching: "후보수를 최소 두 개 비교한 뒤 두기",
    weight: 0.8,
  },
  {
    tag: "time_trouble",
    label: "시간 부족 중 오류",
    category: "habit",
    description: "남은 시간이 30초 이하일 때 발생한 오류입니다.",
    coaching: "남은 시간이 3분 아래로 내려가면 한 수에 15초를 넘기지 않기",
    weight: 0.7,
  },
  {
    tag: "instant_blunder",
    label: "즉답 중대 실수",
    category: "habit",
    description: "시간이 충분한데 즉시 두어 크게 손해 봤습니다.",
    coaching: "모든 수 전에 최소 3초는 상대의 응수를 떠올리고 두기",
    weight: 1,
  },
  {
    tag: "clock_mismanagement",
    label: "시간 배분 실패",
    category: "habit",
    description: "한 수에 시간을 크게 쓰고 이후 시간이 부족해졌습니다.",
    coaching: "한 수에 전체 시간의 15%를 넘겨 쓰지 않기",
    weight: 0.6,
  },
  {
    tag: "development_delay",
    label: "전개 지연",
    category: "strategy",
    description: "오프닝에서 마이너 기물이 초기 위치에 남아 있습니다.",
    coaching: "10수 이내에 마이너 기물 네 개를 모두 전개하고 캐슬링 마치기",
    weight: 0.6,
  },
  {
    tag: "repeated_piece_move",
    label: "같은 기물 반복 이동",
    category: "strategy",
    description: "오프닝에서 같은 기물을 여러 번 움직였습니다.",
    coaching: "오프닝에서 같은 기물을 두 번 움직이기 전에 미전개 기물부터 확인하기",
    weight: 0.5,
  },
  {
    tag: "out_of_repertoire",
    label: "준비 범위 이탈 후 계획 부재",
    category: "phase",
    description:
      "자주 두지 않는 오프닝에 들어갔을 때 성적과 정확도가 뚜렷하게 나빠집니다.",
    coaching:
      "주력 오프닝 밖으로 나갔다고 느끼면, 외운 수를 찾지 말고 전개·킹 안전·중앙 세 가지만 기준으로 두기",
    weight: 1,
  },
  {
    tag: "endgame_technique",
    label: "엔드게임 기술 부족",
    category: "phase",
    description: "엔드게임 전환 과정에서 큰 손실이 났습니다.",
    coaching: "킹·폰 엔드게임의 기본 원칙(오포지션, 룰 오브 스퀘어) 복습하기",
    weight: 0.8,
  },
];

export const STRENGTH_TAGS: TagDefinition[] = [
  {
    tag: "found_only_move",
    label: "정확한 유일수 발견",
    category: "tactics",
    description: "다른 수로는 흐름이 나빠지는 장면에서 정확한 수를 찾았습니다.",
    coaching: "",
    weight: 1,
  },
  {
    tag: "tactical_alertness",
    label: "전술 기회 포착",
    category: "tactics",
    description: "흐름을 확실히 가져오는 전술을 찾았습니다.",
    coaching: "",
    weight: 1,
  },
  {
    tag: "resilient_defense",
    label: "위기 방어와 버티기",
    category: "habit",
    description: "불리한 상황에서 최선의 방어를 이어갔습니다.",
    coaching: "",
    weight: 0.9,
  },
  {
    tag: "endgame_conversion",
    label: "엔드게임 전환",
    category: "phase",
    description: "엔드게임에서 우위를 정확히 유지했습니다.",
    coaching: "",
    weight: 0.9,
  },
  {
    tag: "time_pressure_composure",
    label: "시간 압박 대응",
    category: "habit",
    description: "시간 압박 속에서도 정확하게 두었습니다.",
    coaching: "",
    weight: 0.8,
  },
];

export const ALL_TAGS = [...WEAKNESS_TAGS, ...STRENGTH_TAGS];

export const TAG_BY_ID: Record<string, TagDefinition> = Object.fromEntries(
  ALL_TAGS.map((t) => [t.tag, t]),
);

export const THEME_LABELS: Record<string, string> = Object.fromEntries(
  ALL_TAGS.map((t) => [t.tag, t.label]),
);

export const THEME_COACHING: Record<string, string> = Object.fromEntries(
  WEAKNESS_TAGS.map((t) => [t.tag, t.coaching]),
);
