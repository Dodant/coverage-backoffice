// 언어 코드 → 한국어 이름
export const LANG: Record<string, string> = {
  ko: '한국어', en: '영어', de: '독일어', fr: '프랑스어', es: '스페인어', pl: '폴란드어', pt: '포르투갈어',
  ja: '일본어', ca: '카탈루냐어', ru: '러시아어', zh: '중국어', tr: '튀르키예어', hu: '헝가리어', nl: '네덜란드어',
  bg: '불가리아어', cs: '체코어', gl: '갈리시아어', ro: '루마니아어', it: '이탈리아어', sv: '스웨덴어',
}
export const langName = (c?: string | null) => (c ? LANG[c] ?? c : '')
