import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MUSD Split",
    short_name: "MUSD Split",
    description: "Split group costs and settle them in MUSD on Mezo.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#0a0f22",
    theme_color: "#0a0f22",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
