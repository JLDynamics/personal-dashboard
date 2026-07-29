import type { Metadata } from "next";
import { Dashboard } from "./dashboard";

export const metadata: Metadata = {
  title: "Local Daily Dashboard",
  description: "A calm, local-first dashboard for the things worth knowing today.",
};

export default function Home() {
  return <Dashboard />;
}
