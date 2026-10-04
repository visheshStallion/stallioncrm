import { SetupLanding } from "@/components/crm/SetupLayout";
import { SETUP_CATEGORIES } from "./setup-categories";

export const metadata = { title: "Setup" };

export default function SetupHome() {
  return <SetupLanding categories={SETUP_CATEGORIES} />;
}
