import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pellum", short_name: "Pellum",
    description: "A little less to carry.", start_url: "/dashboard",
    display: "standalone", background_color: "#f7f6f2", theme_color: "#275c48",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
