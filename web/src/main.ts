import { cheaperThan, counters, type UnitIndex } from "@rivals/core";

// public/data/ 下的文件由 vite 原样提供，dev 与 build 后路径都是 data/xxx.json
const index: UnitIndex = await fetch("data/index.json").then((r) => {
  if (!r.ok) throw new Error(`加载失败: ${r.status}`);
  return r.json();
});

const antiAir = counters(index, "Aircraft");
const cheap = cheaperThan(index, 30);

const rows = index.units
  .slice(0, 12)
  .map(
    (u) =>
      `<tr><td>${u.unit_id}</td><td>${u.faction}</td><td>${u.health ?? "-"}</td>` +
      `<td>${u.cost ?? "-"}</td><td>${u.damage ?? "-"}</td></tr>`,
  )
  .join("");

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <h1>Rivals 单位数据</h1>
  <p>共 ${index.unit_count} 个单位（GDI ${index.gdi_count} / NOD ${index.nod_count}）</p>
  <p>克制空中：${antiAir.length} 个 · 造价 ≤30：${cheap.length} 个</p>
  <table border="1" cellpadding="6" style="border-collapse:collapse">
    <thead><tr><th>单位</th><th>阵营</th><th>HP</th><th>造价</th><th>伤害</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
`;

console.log("units loaded:", index.unit_count, "| anti-air:", antiAir.length);
