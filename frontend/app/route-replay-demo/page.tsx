import { notFound } from "next/navigation";
import DemoClient from "./DemoClient";

/**
 * Review page for the Route Replay screen, fed with fake data. It only
 * exists when the app is built with NEXT_PUBLIC_ROUTE_DEMO=1, so production
 * builds answer 404 here.
 */
export default function Page() {
  if (process.env.NEXT_PUBLIC_ROUTE_DEMO !== "1") notFound();
  return <DemoClient />;
}
