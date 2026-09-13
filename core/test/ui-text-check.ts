/**
 * **界面文案守卫** —— 用户能看到的地方**不许出现开发者话术**（用户定的三条规则）。
 *
 * ## 为什么要有这个测试
 *
 * 「面向开发者的表述」不是一次清理就能干净的：文案散在 `title` / `label` / `text` /
 * `lines.push()` / `.vue` 模板里，改代码时很容易顺手写回 `**加粗**`、字段名或 `file:line`。
 * 所以把规则写成**可执行的**：扫一遍会渲染出去的字符串，命中就失败，并列出文件与行号。
 *
 * ## 三条规则（用户逐条定的）
 *
 * | # | 规则 | 例 |
 * | --- | --- | --- |
 * | ① | **不出现内部标识与来源** | `unit_gdi_*` · `modifier_*` · `ability_*` · `canAttack` · `burstTiming` · `*.lua:51` · `J81` · `override_vehicle` · `defGaps` · `data/units.def.gen.json` |
 * | ② | **不出现标记与代码体** | `**粗体**`（界面上就是星号）· 反引号包字段/文件名 · 英文兵种名 `Aircraft`/`Infantry`… |
 * | ③ | **不写"计算口径/建模说明"** | 「含在周期里」「时间相加」「只付一次」「从第一发开始算」「窗口与连打重叠」「模型只有一种」「按 1 占位」 |
 *
 * ⚠️ **机制事实要留**（那些不是口径）：伤害/周期/前摇/首发充能/「只打最后一名成员」/
 * 「只对地面生效」/「载具免疫」——它们回答"会发生什么"，不回答"我们怎么算的"。
 *
 * 跑法：`node --experimental-strip-types core/test/ui-text-check.ts`
 */

import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

interface Violation {
  file: string;
  line: number;
  rule: string;
  text: string;
}

const RULES: Array<{ rule: string; re: RegExp }> = [
  { rule: "① 内部 id", re: /\b(unit|bldg)_[a-z]+_[a-z_]+\b/ },
  { rule: "① 内部名", re: /\b(modifier|ability)_[a-z_]+/ },
  { rule: "① 源码坐标", re: /\.lua\b|:\d{2,4}\b/ },
  { rule: "① findings 编号", re: /\b[JIMK]\d{2,3}\b/ },
  { rule: "① 字段/旗标名", re: /\b(canAttack|descriptors|burstTiming|initialChargeUpMs|selfDestruct|muzzleCount|damageTuning|defGaps|defPatched|storeChargeTimeMs|falloffUnmodeled)\b/ },
  { rule: "① 覆写标签", re: /\boverride_[a-z]+/ },
  { rule: "① 仓库路径/产物名", re: /data\/[\w.-]+\.json|web\/src\/|core\/src\// },
  { rule: "② 粗体标记", re: /\*\*/ },
  { rule: "② 反引号", re: /`/ },
  { rule: "② 英文兵种名", re: /\b(Infantry|Vehicle|Aircraft|Structure|Harvester)\b/ },
  { rule: "③ 计算口径", re: /含在周期|不额外延长|时间相加|只付一次|从第一发|窗口.{0,6}重叠|按名字|模型只有|按 \d+ 占位|占位值|未建模|不假装|锚点/ },
  { rule: "① 武器槽名（源码内部标识）", re: /\b(rifle|cannon|rockets|rocketLauncher|machineGun|laser|flamethrower|gasWeapon|catalystWeapon|targetSelector)\b/ },
  { rule: "① 源码函数名", re: /\b(Get|Take|Set|Is)[A-Z]\w+\(?/ },
  { rule: "① 源码常量", re: /\b[A-Z][A-Z_]{3,}\b/ },
];

/** 去掉注释行（本项目注释极多，直接扫会被淹没） */
function stripComments(text: string): string[] {
  return text.split(/\r?\n/).map((l) => (l.trim().startsWith("*") || l.trim().startsWith("//") || l.trim().startsWith("/*") || l.trim().startsWith("<!--") ? "" : l));
}

interface Candidate {
  line: number;
  text: string;
}

/**
 * **扫描字符串字面量，只保留"文案部分"**（插值整段丢掉）。
 *
 * ⚠️ 正则做不到这件事：`${a ? `x` : y}` 这种**嵌套模板**会让 `` `[^`]*` `` 提前闭合，
 * 于是把语法的反引号当成文案里的反引号（第一版 62 处"违规"全是这么来的）。
 * 这里手写一个小扫描器，按 `${…}` 的**花括号深度**跳过插值（插值里的嵌套模板也一起跳过）。
 */
function scanLiterals(text: string): Array<{ at: number; body: string }> {
  const out: Array<{ at: number; body: string }> = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let body = "";
      while (j < text.length && text[j] !== ch) {
        if (text[j] === "\\") {
          body += text[j + 1] ?? "";
          j += 2;
          continue;
        }
        body += text[j];
        j++;
      }
      out.push({ at: i, body });
      i = j + 1;
      continue;
    }
    if (ch === "`") {
      let j = i + 1;
      let body = "";
      while (j < text.length) {
        if (text[j] === "\\") {
          body += text[j + 1] ?? "";
          j += 2;
          continue;
        }
        if (text[j] === "`") break;
        if (text[j] === "$" && text[j + 1] === "{") {
          let depth = 1;
          j += 2;
          while (j < text.length && depth > 0) {
            if (text[j] === "{") depth++;
            else if (text[j] === "}") depth--;
            else if (text[j] === "`") {
              j++;
              while (j < text.length && text[j] !== "`") {
                if (text[j] === "\\") j++;
                j++;
              }
            }
            j++;
          }
          body += " ";
          continue;
        }
        body += text[j];
        j++;
      }
      out.push({ at: i, body });
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

/**
 * 抽"会渲染出去"的字符串。
 *
 * ⚠️ **不能只匹配 `text: "..."` 这种同一行的写法**：这些文案大量写成
 * `text:\n  \`...\` + \`...\``（跨行拼接），只按行扫会**漏掉**（第一版就漏了
 * `duel-view.ts` 整个日志的措辞）。这里改成"看一个字符串字面量**前面 60 个字符**里
 * 有没有显示字段名"，跨行与拼接都能覆盖。
 */
function candidates(file: string, raw: string): Candidate[] {
  const text = stripComments(raw).join("\n");
  const out: Candidate[] = [];
  const KEYWORD = /(?:title|label|text|headline|axisNote|note|why|parts|lines)\s*:?\s*(?:push\()?[^A-Za-z0-9_]{0,20}$/;
  const lineOf = (at: number): number => text.slice(0, at).split("\n").length;
  const push = (at: number, body: string): void => {
    const s = body.trim();
    if (s.length > 1) out.push({ line: lineOf(at), text: s });
  };

  /** `.vue`：标签内部的**属性表达式**不是文案（只有下面这几个属性例外，它们会显示给用户） */
  const tagSpans: Array<[number, number]> = [];
  if (file.endsWith(".vue")) {
    const start = text.indexOf("<template>");
    const end = text.indexOf("</template>");
    if (start >= 0 && end > start) {
      const tpl = text.slice(start, end);
      for (const m of tpl.matchAll(/>([^<>{}]+)</g)) push(start + m.index!, m[1]!);
      for (const m of tpl.matchAll(/<[^>]*>/g)) tagSpans.push([start + m.index!, start + m.index! + m[0]!.length]);
      /*
       * ⚠️ 会显示的属性只有这几个。值可能是 **Vue 表达式**（`` :data-tip="`前摇 ${x}`" ``）——
       * 直接拿来判会把 Vue 的模板语法算成"文案里的反引号"。所以先过一遍 {@link scanLiterals}：
       * 里面有字面量就只取它的**文案部分**；静态属性（`data-tip="前摇 0.08s"`）就整段当文案。
       */
      for (const m of tpl.matchAll(/(?::)?(?:data-tip|title|alt|placeholder)="([^"]*)"/g)) {
        const at = start + m.index!;
        const lits = scanLiterals(m[1]!);
        if (lits.length === 0) push(at, m[1]!);
        else for (const l of lits) push(at, l.body);
      }
    }
  }
  const inTag = (at: number): boolean => tagSpans.some(([a, b]) => at >= a && at < b);
  for (const lit of scanLiterals(text)) {
    // 标签内部除了上面那几个属性，其余都是绑定表达式/类名/事件，不是给用户看的文案
    if (file.endsWith(".vue") && inTag(lit.at)) continue;
    if (KEYWORD.test(text.slice(Math.max(0, lit.at - 60), lit.at))) push(lit.at, lit.body);
  }
  return out;
}

const files = globSync("web/src/**/*.{vue,ts}", { cwd: process.cwd() }).map((f) => f.replace(/\\/g, "/"));
const violations: Violation[] = [];
for (const f of files) {
  for (const c of candidates(f, readFileSync(f, "utf8"))) {
    for (const r of RULES) {
      const m = r.re.exec(c.text);
      if (m !== null) violations.push({ file: f, line: c.line, rule: r.rule, text: c.text.replace(/\s+/g, " ").trim().slice(0, 100) });
    }
  }
}

const byFile = new Map<string, Violation[]>();
for (const v of violations) {
  const list = byFile.get(v.file) ?? [];
  list.push(v);
  byFile.set(v.file, list);
}

console.log(`扫描 ${files.length} 个文件 · 命中 ${violations.length} 处开发者话术（${byFile.size} 个文件）\n`);
if (violations.length === 0) {
  console.log("✅ 界面文案干净：三条规则全部通过");
  process.exit(0);
}
const top = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [file, list] of top) {
  console.log(`${String(list.length).padStart(3)}  ${file}`);
  for (const v of list.slice(0, 3)) console.log(`       :${v.line}  [${v.rule}]  ${v.text}`);
  if (list.length > 3) console.log(`       … 还有 ${list.length - 3} 处`);
}
const byRule = new Map<string, number>();
for (const v of violations) byRule.set(v.rule, (byRule.get(v.rule) ?? 0) + 1);
console.log("\n按规则统计：");
for (const [rule, n] of [...byRule.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${rule}`);
console.log("\n（第 1 步做完后这个测试必须 0 命中 —— 它就是清理清单）");
process.exitCode = 1;
