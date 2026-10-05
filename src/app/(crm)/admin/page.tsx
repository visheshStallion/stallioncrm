import { redirect } from "next/navigation";

/** The Setup home moved to /setup (prompt 19); old links keep working. */
export default function AdminHome() {
  redirect("/setup");
}
