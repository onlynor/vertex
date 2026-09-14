/*
 * 班级工具：统一班级写法、排序、按班级分组。规则与后端 internal/classes 一致，
 * 前端只用来即时预览（「将保存为 2年级1班」），真正保存以后端为准。
 */

const GRADE_CLASS = /^([0-9一二两三四五六七八九十〇零]+)年级\(?([0-9一二两三四五六七八九十〇零]+)\)?班$/;

const DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function toHalfWidth(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/　/g, " ");
}

/** 识别阿拉伯数字和 1~99 的中文数字（一、十、十二、二十三）。 */
function parseNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  const chars = [...s];
  const ten = chars.indexOf("十");
  if (ten >= 0) {
    if (ten > 1 || chars.length - ten - 1 > 1) return null;
    const tens = ten === 0 ? 1 : DIGITS[chars[0]];
    const ones = ten === chars.length - 1 ? 0 : DIGITS[chars[ten + 1]];
    if (tens === undefined || ones === undefined) return null;
    return tens * 10 + ones;
  }
  let n = 0;
  for (const c of chars) {
    const d = DIGITS[c];
    if (d === undefined) return null;
    n = n * 10 + d;
  }
  return chars.length ? n : null;
}

/**
 * 把「二年级一班」「2年级(1)班」统一写成「2年级1班」；幼儿园的小班、中班、大班
 * 以及认不出的写法保持原样，只整理多余空格。
 */
export function normalizeClassName(raw: string): string {
  const s = toHalfWidth(raw.trim());
  const match = s.replace(/\s+/g, "").match(GRADE_CLASS);
  if (match) {
    const grade = parseNumber(match[1]);
    const cls = parseNumber(match[2]);
    if (grade !== null && cls !== null && grade >= 1 && grade <= 12 && cls >= 1 && cls <= 99) {
      return `${grade}年级${cls}班`;
    }
  }
  return s.split(/\s+/).filter(Boolean).join(" ");
}

const NORMALIZED = /^(\d+)年级(\d+)班$/;
const KINDERGARTEN = ["托", "小", "中", "大"];

function sortKey(name: string): [number, number, number, string] {
  if (!name.trim()) return [3, 0, 0, ""];
  const m = name.match(NORMALIZED);
  if (m) return [1, Number(m[1]), Number(m[2]), name];
  if (name.includes("班")) {
    const i = KINDERGARTEN.indexOf([...name][0] ?? "");
    if (i >= 0) return [0, i, 0, name];
  }
  return [2, 0, 0, name];
}

/** 班级排序：幼儿园在前，然后按年级、班号从小到大，其余按名称，未分班最后。 */
export function compareClassNames(a: string, b: string): number {
  const ka = sortKey(a);
  const kb = sortKey(b);
  for (const i of [0, 1, 2] as const) {
    if (ka[i] !== kb[i]) return ka[i] - kb[i];
  }
  return ka[3].localeCompare(kb[3], "zh-CN");
}

export const classLabel = (name: string) => name.trim() || "未分班";

export interface ClassGroup {
  name: string;
  count: number;
}

/** 按班级分组计数并排序。 */
export function classGroups(items: { class_name: string }[]): ClassGroup[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.class_name, (counts.get(item.class_name) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => compareClassNames(a.name, b.name));
}
