import { api, safeUrl, session } from './api'

export const ISSUE_LABELS = {
  MISSING_COVER: '표지 없음', HIDDEN_COVER: '표지 숨김', LOW_RESOLUTION: '해상도 부족', UNKNOWN_RESOLUTION: '해상도 미확인',
  MISSING_ISBN: 'ISBN 누락', MISSING_SOURCE: '출처 URL 누락', MISSING_CREDIT: '크레딧 누락',
  MISSING_YEAR: '출간 연도 누락', MISSING_PUBLISHER: '출판사 누락', UNCLASSIFIED_VARIANT: '표지 변형 미분류',
} as const
export type Issue = keyof typeof ISSUE_LABELS
export const STATUS_LABELS = { DRAFT: '초안', PUBLISHED: '공개', HIDDEN: '숨김', DELETED: '삭제' } as const
export const VARIANT_LABELS = { UNKNOWN: '미분류', INITIAL: '최초 표지', RECOVER: '리커버', SPECIAL: '특별 표지', PRINTING: '쇄별 변경', IMAGE_REPLACEMENT: '이미지 교체' } as const
export const RIBBON_LABELS = { UNKNOWN: '미확인', CLEAN: '띠지 없음', BANDED: '띠지 있음' } as const
export const CREDIT_LABELS = { DESIGN: '북디자인', ART_DIRECTION: '아트디렉션', ILLUSTRATION: '일러스트', PHOTOGRAPHY: '사진', LETTERING: '레터링·캘리그라피' } as const
export type Kind = 'ORIGINAL' | 'TRANSLATED'
export type Cover = {
  id: string; imageUrl: string | null; thumbnailUrl: string | null; width: number | null; height: number | null
  label: string | null; printingFrom: number | null; usedFrom: string | null; hidden: boolean
  variantType: keyof typeof VARIANT_LABELS; ribbonStatus: keyof typeof RIBBON_LABELS
  sourceName: string | null; sourceUrl: string | null; similarGroupId: string | null
  credits: { designerId: string; name: string; role: string }[]
}
export type CatalogItem = {
  id: string; kind: Kind; title: string; author: string | null; publisher: string | null; languageCode: string
  isbn: string | null; edition: string | null; year: number | null; status: keyof typeof STATUS_LABELS; frontCover: Cover | null; issues: Issue[]
}
export type Book = Omit<CatalogItem, 'author' | 'publisher' | 'kind' | 'issues'> & {
  workId?: string | null; originalTitle?: string | null; genre?: string | null; countryCode: string | null; originalBookId?: string
  originalBookTitle?: string; author: { id: string; name: string } | null; publisher: { id: string; name: string } | null
  translator?: { id: string; name: string } | null; covers: Cover[]; createdAt: string; updatedAt: string
}
export type Detail = { kind: Kind; book: Book; relatedBooks: CatalogItem[]; issues: Issue[] }
export const imageOf = (c: Cover | null) => safeUrl(c?.thumbnailUrl || c?.imageUrl)
export const coversOf = (book: Book) => [...new Map([...(book.frontCover ? [book.frontCover] : []), ...(book.covers ?? [])].map(c => [c.id, c])).values()]

export async function loadEditions<T>(originalId: string, signal?: AbortSignal): Promise<T[]> {
  if (session()?.token) return api<T[]>(`/admin/catalog/${originalId}/editions`, { signal })
  const [original, translations] = await Promise.all([
    api<T>(`/books/original/${originalId}`, { signal }),
    api<T[]>(`/books/translated/by-original/${originalId}`, { signal }),
  ])
  return [original, ...translations]
}
