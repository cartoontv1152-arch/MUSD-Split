import { ImageResponse } from "next/og";

export const alt = "MUSD Split: split group costs and settle them in MUSD on Mezo";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OG() {
  const nodes = [
    [860, 160],
    [1050, 260],
    [1010, 460],
    [820, 500],
    [700, 320],
  ];
  const edges = [
    [4, 0],
    [3, 1],
    [2, 1],
    [4, 1],
  ];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#ffffff", color: "#000000", fontFamily: "sans-serif", position: "relative" }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 24, background: "#002fa7", display: "flex" }} />
        <svg width="1200" height="630" style={{ position: "absolute", inset: 0 }}>
          {edges.map(([a, b], i) => (
            <line key={i} x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]} stroke="#002fa7" strokeWidth="6" />
          ))}
          {nodes.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="24" fill="#ffffff" stroke="#000000" strokeWidth="4" />
          ))}
        </svg>
        <div style={{ display: "flex", flexDirection: "column", padding: "80px 96px", width: 700, justifyContent: "center" }}>
          <div style={{ fontSize: 30, color: "#404040", display: "flex" }}>MUSD Split on Mezo</div>
          <div style={{ fontSize: 80, fontWeight: 700, lineHeight: 1.0, marginTop: 24, letterSpacing: -2, display: "flex", flexDirection: "column" }}>
            <span>Split the bill.</span>
            <span>Settle it in MUSD.</span>
          </div>
          <div style={{ fontSize: 28, color: "#404040", marginTop: 28, lineHeight: 1.35, display: "flex" }}>
            Pay with MUSD, swap BTC on Mezo Pools, or borrow against your BTC. Verified on-chain.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
