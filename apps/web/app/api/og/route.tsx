import { ImageResponse } from "next/og";

export const runtime = "edge";

export async function GET(req: Request): Promise<ImageResponse> {
  const { searchParams } = new URL(req.url);
  const handle = searchParams.get("handle") ?? "A stranger";
  const mult = searchParams.get("mult") ?? "1.4";
  const location = searchParams.get("location") ?? "the Corner Store";
  const amount = searchParams.get("amount") ?? "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#0B0E14",
          backgroundImage: "radial-gradient(circle at 50% 30%, rgba(255,182,39,0.18), transparent 60%)",
          color: "#E8ECF4",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, fontSize: 56, fontWeight: 900, letterSpacing: -1 }}>
          <span>TRASH</span>
          <span style={{ color: "#FFB627" }}>WARS</span>
          <span style={{ fontSize: 28, color: "#FFB627" }}>✦</span>
        </div>
        <div style={{ marginTop: 36, fontSize: 44, fontWeight: 700, display: "flex", textAlign: "center", maxWidth: 1000 }}>
          {handle} hit {mult}× at {location}
        </div>
        {amount && (
          <div style={{ marginTop: 18, fontSize: 38, color: "#FFD56B", display: "flex", alignItems: "center", gap: 10 }}>
            ✦ {amount} $SHINY
          </div>
        )}
        <div
          style={{
            marginTop: 44,
            fontSize: 20,
            color: "#8A94A6",
            border: "1px solid #1F2735",
            borderRadius: 999,
            padding: "8px 24px",
            display: "flex",
          }}
        >
          OPEN BETA — Shorefront City pays out at 60× speed
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
