#!/usr/bin/env ts-node
/**
 * schema.prisma (sqlite) ↔ schema.mysql.prisma 漂移检查.
 *
 * Why this exists:
 *   开源版默认 SQLite, 但保留 MySQL 给一部分自部署用户. Prisma 一份 schema
 *   只能编译出一种客户端, 所以两份 schema 必须并排维护. 时间一长肯定有人
 *   只改 sqlite 那份忘了同步 mysql, 这个脚本就是来抓这种漂移的.
 *
 * 算法:
 *   1. 各自归一化 (normalize):
 *      - 把 datasource 块整段抠掉 (provider 必然不同, 不算漂移)
 *      - 把 @db.Text / @db.LongText / @db.MediumText / @db.VarChar(N)
 *        整体擦掉 (这些标注只在 mysql 上有意义, 是允许的差异)
 *      - 把头部说明性注释段 (开头的连续 `//` 块) 整段抠掉 (两份本身写的就
 *        不一样, 那是设计意图)
 *      - 折叠多余空行
 *   2. 直接字符串比, diff 不为空就 exit 1.
 *
 * 用法:
 *   pnpm db:check-schema-parity
 *
 * Exit codes:
 *   0 = 两份归一化后等价
 *   1 = 检测到漂移; 屏幕打印简短 diff (前 80 行) 让人一眼看清在哪
 *   2 = 文件读取失败
 *
 * 不引入额外依赖 (不用 deep-diff / jest-diff): 用最朴素的 line diff,
 * 因为我们关心的是"有没有差异", 不是"差异长什么样的精确分析".
 */
import * as fs from 'fs';
import * as path from 'path';

const PRISMA_DIR = path.resolve(__dirname);
const SQLITE = path.join(PRISMA_DIR, 'schema.prisma');
const MYSQL = path.join(PRISMA_DIR, 'schema.mysql.prisma');

/**
 * 归一化策略 —— 见文件头说明.
 * 列出来的每一条都是"允许的差异", 不是要保留的内容.
 */
function normalize(src: string): string {
  let s = src;

  // 1. 抠掉 datasource 块 (provider 必然不同).
  //    匹配 `datasource <name> { ... }` 整段, 含括号内多行内容.
  s = s.replace(/datasource\s+\w+\s*\{[\s\S]*?\}/g, '');

  // 2. 抠掉 generator 块 (binaryTargets 通常一致, 但 client output 等
  //    将来可能因 provider 调整, 一并归一化掉避免误报).
  s = s.replace(/generator\s+\w+\s*\{[\s\S]*?\}/g, '');

  // 3. 擦掉 mysql-only native type 标注. 必须放在每行尾的多空格 + 注释
  //    之前位置, 但实际生成的 schema 里这些标注总是紧跟字段类型, 用宽松
  //    正则一次擦干净就够.
  s = s.replace(/\s*@db\.(?:Text|LongText|MediumText|VarChar\(\d+\))/g, '');

  // 4. 折叠 3+ 连续空行 → 2 行 (允许 1 个空行作分段).
  s = s.replace(/\n{3,}/g, '\n\n');

  // 5. 去掉头部 (model/enum/type 之前) 的所有注释和空行. 两份 schema
  //    的开头 doc 不一样是有意为之 (一份解释 sqlite, 一份解释 mysql),
  //    不要把它们当漂移.
  const firstBlockMatch = s.match(/^(model|enum|type|view)\s+/m);
  if (firstBlockMatch && firstBlockMatch.index !== undefined) {
    s = s.slice(firstBlockMatch.index);
  }

  // 6. 擦掉所有 // 行注释 + 行尾空白. 一定要一起做, 因为整行注释擦完会
  //    剩下"带缩进的空行" (例如 `  ` 两个空格), 折叠空行的 regex 看不
  //    到它们就不会合并, 两份注释行数差异最终漏出来报漂移.
  //
  //    字段上方的 docstring 在两份里可以各写各的 —— 比如 message 字段,
  //    sqlite 这边写"为啥没限长", mysql 这边写"VARCHAR(1024) 怎么选的",
  //    都对但各对一半. parity 只检查代码骨架是否同步, doc 不强求一致.
  s = s
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').replace(/\s+$/g, ''))
    .join('\n');

  // 7. 折叠所有连续空行 → 1 个空行. 注意这里塌得比 step 4 更狠
  //    (\n{2,} 而不是 \n{3,}), 因为 step 6 之后才看得到全部"裸空行".
  s = s.replace(/\n{2,}/g, '\n\n');

  // 8. 整体 trim
  return s.trim();
}

function lineDiff(a: string, b: string, maxLines = 80): string {
  const A = a.split('\n');
  const B = b.split('\n');
  const out: string[] = [];
  const max = Math.max(A.length, B.length);
  for (let i = 0; i < max && out.length < maxLines; i++) {
    if (A[i] !== B[i]) {
      out.push(`L${i + 1}:`);
      if (A[i] !== undefined) out.push(`  - ${A[i]}`);
      if (B[i] !== undefined) out.push(`  + ${B[i]}`);
    }
  }
  if (out.length === 0 && A.length !== B.length) {
    out.push(`(行数不同: sqlite=${A.length} mysql=${B.length})`);
  }
  return out.join('\n');
}

function main(): never {
  let a: string;
  let b: string;
  try {
    a = fs.readFileSync(SQLITE, 'utf8');
    b = fs.readFileSync(MYSQL, 'utf8');
  } catch (e) {
    console.error('[schema-parity] 读 schema 文件失败:', (e as Error).message);
    process.exit(2);
  }

  const na = normalize(a);
  const nb = normalize(b);

  if (na === nb) {
    console.log('[schema-parity] OK · 两份 schema 归一化后等价');
    process.exit(0);
  }

  console.error('[schema-parity] FAIL · 检测到漂移');
  console.error('  sqlite: prisma/schema.prisma');
  console.error('  mysql : prisma/schema.mysql.prisma');
  console.error('');
  console.error('差异 (- sqlite / + mysql, 最多 80 行):');
  console.error(lineDiff(na, nb));
  console.error('');
  console.error(
    '修复: 改完一份, 把同样的修改 (除了 datasource provider 和 @db.Text/VarChar)\n' +
      '      复制到另一份. 完成后再跑一次本脚本确认.',
  );
  process.exit(1);
}

main();
