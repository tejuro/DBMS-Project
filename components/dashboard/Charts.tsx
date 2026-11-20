"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

/**
 * Legacy placeholder retained for compatibility. Live sensor charts are
 * rendered from MongoDB data on the main dashboard and /monitoring pages.
 */
const ChartComponent = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Analytics Charts</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="py-8 text-center text-sm text-slate-400">
          Live temperature and humidity trends are shown on the{" "}
          <a href="/" className="font-semibold text-teal-700 hover:underline">
            operations dashboard
          </a>
          .
        </p>
      </CardContent>
    </Card>
  );
};

export default ChartComponent;
