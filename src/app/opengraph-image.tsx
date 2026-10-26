import { ImageResponse } from "next/og";

export const alt = "MUSD Split — split group costs, settle them in MUSD on Mezo";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OG() {
  const nodes = [
    [860, 170],
    [1040, 260],
    [1010, 450],
    [820, 500],
    [700, 330],
  ];
  const edges = [
    [4, 0],
    [3, 1],
    [2, 1],
    [4, 1],
  ];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#0a0f22", color: "#eceeff", fontFamily: "sans-serif", position: "relative" }}>
        <svg width="1200" height="630" style={{ position: "absolute", inset: 0 }}>
          {edges.map(([a, b], i) => (
            <path
              key={i}
              d={`M${nodes[a][0]},${nodes[a][1]} Q${(nodes[a][0] + nodes[b][0]) / 2},${(nodes[a][1] + nodes[b][1]) / 2 - 70} ${nodes[b][0]},${nodes[b][1]}`}
              stroke="#46ddeb"
              strokeWidth="5"
              fill="none"
              opacity="0.85"
            />
          ))}
          {nodes.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="22" fill="#8a6cff" />
          ))}
        </svg>
        <div style={{ display: "flex", flexDirection: "column", padding: "80px 80px", width: 680, justifyContent: "center" }}>
          <div style={{ fontSize: 30, color: "#a6acd0", display: "flex" }}>MUSD Split · Mezo testnet</div>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.02, marginTop: 24, letterSpacing: -2, display: "flex", flexDirection: "column" }}>
            <span>Shared costs,</span>
            <span>settled on-chain.</span>
          </div>
          <div style={{ fontSize: 28, color: "#a6acd0", marginTop: 28, lineHeight: 1.35, display: "flex" }}>
            Split expenses, simplify debts, pay in MUSD — verified before balances move.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
