/** Vault layout presets in plain words: a name and what it looks like. */
export const PRESET_NAME: Record<string, [string, string]> = {
  "llm-wiki": ["LLM Wiki", "LLM Wiki"],
  para: ["PARA", "PARA (영어 폴더)"],
  "para-ko": ["PARA (Korean folders)", "PARA (한국어 폴더)"],
  zettelkasten: ["Zettelkasten", "제텔카스텐"],
  flat: ["Flat", "한 폴더"],
};

export const PRESET_TEXT: Record<string, [string, string]> = {
  "llm-wiki": ["Sources in raw/, pages Claude writes in wiki/: for a new vault", "원본은 raw/, Claude가 쓰는 페이지는 wiki/: 새 볼트에 추천"],
  para: ["Projects, Areas, Resources, Archives", "Projects, Areas, Resources, Archives (영어 폴더)"],
  "para-ko": ["PARA with Korean folder names", "한국어 폴더 이름의 PARA"],
  zettelkasten: ["One folder of linked notes", "연결된 노트 한 폴더"],
  flat: ["Everything in one folder", "모두 한 폴더에"],
};

export const presetName = (t: (en: string, ko: string) => string, p: string) => (PRESET_NAME[p] ? t(...PRESET_NAME[p]!) : p);
