import type { Metadata } from "next";
import { UploadScreen } from "./upload-screen";

export const metadata: Metadata = {
  title: "Add documents",
  description: "Upload, photograph, or forward documents to your household.",
};

export default function UploadPage() {
  return <UploadScreen />;
}
